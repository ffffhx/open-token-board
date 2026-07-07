import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { chromium, type Browser } from "@playwright/test";

import type { TokenUsageEvent } from "../packages/token-board-core/src/token-leaderboard";
import { repoRoot } from "../tests/support/harness";
import { startStaticServer, type StaticServer } from "../tests/support/static-server";

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_AUTH_SECRET = "open-token-board-audit-stress-secret";

type StressServer = {
  apiUrl: string;
  close: () => Promise<void>;
  events: TokenUsageEvent[];
  tmpDir: string;
};

async function main() {
  let api: StressServer | undefined;
  let staticServer: StaticServer | undefined;
  let browser: Browser | undefined;

  try {
    const webPort = await getAvailablePort();
    const webUrl = `http://127.0.0.1:${webPort}`;
    api = await startStressApi({ allowedOrigins: [webUrl] });
    await probeStatsApi(api.apiUrl);
    await buildWeb(api.apiUrl);
    staticServer = await startStaticServer(path.join(repoRoot, "apps", "web", "out"), webPort);
    browser = await chromium.launch();

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "light");
      window.localStorage.setItem("open-token-board:language", "zh");
      window.__otbLongTasks = [];
      new PerformanceObserver((list) => {
        window.__otbLongTasks.push(
          ...list.getEntries().map((entry) => ({
            duration: entry.duration,
            name: entry.name,
            startTime: entry.startTime,
          }))
        );
      }).observe({ entryTypes: ["longtask"] });
    });

    const statsTraffic: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/usage/stats")) {
        statsTraffic.push(`request ${request.url()}`);
      }
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/usage/stats")) {
        statsTraffic.push(`response ${response.status()} ${response.url()}`);
      }
    });

    const startedAt = Date.now();
    await page.goto(`${staticServer.url}/board/`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const rangeResponse = page.waitForResponse((response) => response.url().includes("/api/usage/stats") && response.url().includes("range=90D") && response.ok());
    await page.getByRole("radio", { name: "90D" }).click();
    await rangeResponse.catch((error) => {
      console.log("[stress] stats traffic before timeout:");
      for (const item of statsTraffic) {
        console.log(`[stress] ${item}`);
      }
      throw error;
    });
    await page.locator("#token-leaderboard-rankings tbody tr").first().waitFor({ state: "visible", timeout: 20_000 });
    const readyMs = Date.now() - startedAt;

    const rowCount = await page.locator("#token-leaderboard-rankings tbody tr").count();
    await page.getByRole("button", { name: /估算费用/ }).click();
    await page.getByRole("button", { name: /总消耗/ }).click();
    await page.evaluate(() => {
      const tbody = document.querySelector("#token-leaderboard-rankings tbody");
      window.__otbLeaderboardMutations = 0;
      if (!tbody) {
        return;
      }
      new MutationObserver((mutations) => {
        window.__otbLeaderboardMutations += mutations.length;
      }).observe(tbody, { attributes: true, childList: true, subtree: true, characterData: true });
    });

    const interactionsStartedAt = Date.now();
    await page.getByRole("button", { name: /^重置$|^Reset$/ }).click({ timeout: 1_000 }).catch(() => undefined);
    const trendPoint = page.locator("[data-token-trend-point]").last();
    await trendPoint.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await trendPoint.click({ force: true });
    const interactionMs = Date.now() - interactionsStartedAt;

    const metrics = await page.evaluate(() => {
      const longTasks = window.__otbLongTasks || [];
      return {
        longTasks: longTasks.length,
        maxLongTaskMs: Math.round(Math.max(0, ...longTasks.map((entry) => entry.duration))),
        leaderboardMutations: window.__otbLeaderboardMutations || 0,
      };
    });

    console.log("[stress] generated users=50 days=90 events=" + api.events.length);
    console.log(`[stress] board ready=${readyMs}ms rows=${rowCount}`);
    console.log(`[stress] chart interactions=${interactionMs}ms longTasks=${metrics.longTasks} maxLongTask=${metrics.maxLongTaskMs}ms leaderboardMutations=${metrics.leaderboardMutations}`);

    if (rowCount < 50) {
      throw new Error(`Expected 50 leaderboard rows, got ${rowCount}`);
    }
    if (metrics.leaderboardMutations > 4) {
      throw new Error(`Chart interactions mutated leaderboard too much: ${metrics.leaderboardMutations}`);
    }
    if (metrics.maxLongTaskMs > 250) {
      throw new Error(`Long task exceeded stress budget: ${metrics.maxLongTaskMs}ms`);
    }

    console.log("[stress] PASS: 50 users x 90 days rendered and chart interactions did not re-render the leaderboard.");
    await context.close();
  } finally {
    await browser?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    await api?.close().catch(() => undefined);
  }
}

async function probeStatsApi(apiUrl: string) {
  const now = encodeURIComponent(new Date().toISOString());
  const liveStartedAt = Date.now();
  const live = await fetch(`${apiUrl}/api/usage/stats?metric=tokens&range=90D&now=${now}`);
  await live.arrayBuffer();
  console.log(`[stress] api live 90D=${Date.now() - liveStartedAt}ms status=${live.status}`);

  const snapshotStartedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const snapshot = await fetch(`${apiUrl}/api/usage/stats?metric=tokens&range=90D`, { signal: controller.signal });
    await snapshot.arrayBuffer();
    console.log(`[stress] api snapshot 90D=${Date.now() - snapshotStartedAt}ms status=${snapshot.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function startStressApi({ allowedOrigins }: { allowedOrigins: string[] }): Promise<StressServer> {
  const apiPort = await getAvailablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), "otb-stress-"));
  const dataFile = path.join(tmpDir, "usage-events.json");
  const snapshotsFile = path.join(tmpDir, "leaderboard-snapshots.json");
  const sharesFile = path.join(tmpDir, "snapshot-shares.json");
  const { events, usersJson } = generateStressDataset();

  await fs.writeFile(dataFile, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: events }, null, 2)}\n`);

  const child = spawn("pnpm", ["token:server"], {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      DATABASE_URL: "",
      TOKEN_BOARD_DATABASE_URL: "",
      TOKEN_BOARD_HOST: "127.0.0.1",
      TOKEN_BOARD_PORT: String(apiPort),
      TOKEN_BOARD_AUTH_SECRET: TEST_AUTH_SECRET,
      TOKEN_BOARD_DATA_FILE: dataFile,
      TOKEN_BOARD_LEADERBOARD_SNAPSHOT_FILE: snapshotsFile,
      TOKEN_BOARD_LEADERBOARD_SNAPSHOT_REFRESH_MS: "600000",
      TOKEN_BOARD_LEADERBOARD_SNAPSHOT_WRITE_DELAY_MS: "50",
      SNAPSHOT_SHARE_DATA_FILE: sharesFile,
      TOKEN_BOARD_ALLOWED_ORIGINS: allowedOrigins.join(","),
      TOKEN_BOARD_USERS_JSON: usersJson,
      TOKEN_BOARD_MAX_EVENT_TOTAL_TOKENS: "1000000",
      TOKEN_BOARD_MAX_USER_DAILY_TOTAL_TOKENS: "10000000",
      TOKEN_BOARD_MAX_EVENT_AGE_DAYS: "400",
      TOKEN_BOARD_DAILY_REPORT_ENABLED: "false",
      TOKEN_BOARD_WEEKLY_REPORT_ENABLED: "false",
      TOKEN_BOARD_COOKIE_SECURE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await terminate(child);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(`${apiUrl}/api/usage/health`, () => logs.join(""));
    return { apiUrl, close, events, tmpDir };
  } catch (error) {
    await close();
    throw error;
  }
}

function generateStressDataset() {
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  const models = ["gpt-5-codex", "claude-sonnet-4.5", "gemini-2.5-pro", "o4-mini"];
  const tools = ["Codex CLI", "Claude Code", "Gemini CLI", "opencode"];
  const teams = ["Platform", "Infra", "Design", "Research", "Apps"];
  const projects = ["open-token-board", "api-hub", "design-system", "migration", "quality"];
  const users = Array.from({ length: 50 }, (_, index) => ({
    userId: `github:audit-user-${String(index + 1).padStart(2, "0")}`,
    displayName: `audit-user-${String(index + 1).padStart(2, "0")}`,
    team: teams[index % teams.length],
  }));
  const events: TokenUsageEvent[] = [];

  for (const [userIndex, user] of users.entries()) {
    for (let day = 0; day < 90; day += 1) {
      const timestamp = new Date(todayStart - day * DAY_MS + ((userIndex + day) % 11) * 60 * 60 * 1000);
      const inputTokens = 18_000 + userIndex * 1_300 + (day % 13) * 1_700;
      const outputTokens = 3_200 + (userIndex % 7) * 650 + (day % 5) * 800;
      const cacheCreationInputTokens = Math.round(inputTokens * 0.08);
      const cachedInputTokens = Math.round(inputTokens * 0.22);
      const model = models[(userIndex + day) % models.length];
      const tool = tools[(userIndex + day * 2) % tools.length];
      const project = projects[(userIndex * 3 + day) % projects.length];

      events.push({
        id: `${user.displayName}-${day}`,
        userId: user.userId,
        displayName: user.displayName,
        team: user.team,
        source: tool.toLowerCase().replace(/\s+/g, "-"),
        model,
        project,
        tool,
        timestamp: timestamp.toISOString(),
        inputTokens,
        cacheCreationInputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens: Math.round(outputTokens * 0.2),
        totalTokens: inputTokens + outputTokens,
        messages: 4 + ((userIndex + day) % 18),
        sessionId: `${user.displayName}-session-${Math.floor(day / 3)}`,
        sessionTitle: `${project} audit ${day}`,
      });
    }
  }

  return {
    events,
    usersJson: JSON.stringify({ users }),
  };
}

async function buildWeb(apiUrl: string) {
  const child = spawn("pnpm", ["--filter", "@open-token-board/web", "build"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_TOKEN_BOARD_API_URL: apiUrl,
      PAGES_BASE_PATH: "",
    },
    stdio: "inherit",
  });
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  if (code !== 0) {
    throw new Error(`web build failed with ${signal || `exit code ${code}`}`);
  }
}

async function getAvailablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) {
    throw new Error("Failed to allocate an available port");
  }
  return port;
}

async function waitForHealth(url: string, logs: () => string) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }

  throw new Error(`token:server did not become healthy: ${lastError}\n${logs()}`);
}

async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exitPromise = once(child, "exit").then(() => undefined);
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }

  const exited = await Promise.race([exitPromise.then(() => true), delay(5_000).then(() => false)]);
  if (!exited) {
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // Process may have exited between timeout and kill.
    }
    await Promise.race([exitPromise, delay(1_000)]);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

declare global {
  interface Window {
    __otbLeaderboardMutations?: number;
    __otbLongTasks?: Array<{ duration: number; name: string; startTime: number }>;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
