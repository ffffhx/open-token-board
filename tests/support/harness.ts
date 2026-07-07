import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createAgentSessionToken,
  createWebSessionToken,
  type TokenBoardIdentity,
} from "../../packages/token-board-core/src/token-board-auth";

import {
  createTokenBoardTestFixture,
  SESSION_COOKIE_NAME,
  TEST_AUTH_SECRET,
  type FixtureUserKey,
  type TokenBoardTestFixture,
} from "./fixtures";

const supportDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(supportDir, "../..");

export type TokenBoardHarness = {
  agentToken: string;
  agentTokens: Record<FixtureUserKey, string>;
  apiUrl: string;
  close: () => Promise<void>;
  dataFile: string;
  fixture: TokenBoardTestFixture;
  identities: Record<FixtureUserKey, TokenBoardIdentity>;
  sessionCookie: string;
  tmpDir: string;
  webSessionToken: string;
};

export async function startTokenBoardHarness(options: { allowedOrigins?: string[]; apiPort?: number } = {}): Promise<TokenBoardHarness> {
  const fixture = createTokenBoardTestFixture();
  const apiPort = options.apiPort ?? (await getAvailablePort());
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), "otb-e2e-"));
  const dataFile = path.join(tmpDir, "usage-events.json");
  const snapshotsFile = path.join(tmpDir, "leaderboard-snapshots.json");
  const sharesFile = path.join(tmpDir, "snapshot-shares.json");
  await fs.writeFile(
    dataFile,
    `${JSON.stringify({ schemaVersion: 1, updatedAt: fixture.now.toISOString(), entries: fixture.events }, null, 2)}\n`
  );

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
      TOKEN_BOARD_ALLOWED_ORIGINS: options.allowedOrigins?.join(",") || "*",
      TOKEN_BOARD_USERS_JSON: fixture.usersJson,
      TOKEN_BOARD_MAX_EVENT_TOTAL_TOKENS: "1000000",
      TOKEN_BOARD_MAX_USER_DAILY_TOTAL_TOKENS: "1200000",
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
    const agentTokens = Object.fromEntries(
      Object.entries(fixture.identities).map(([key, identity]) => [
        key,
        createAgentSessionToken(identity, TEST_AUTH_SECRET, 24 * 60 * 60),
      ])
    ) as Record<FixtureUserKey, string>;
    const webSessionToken = createWebSessionToken(fixture.identities.alice, TEST_AUTH_SECRET, 24 * 60 * 60);

    await seedRateLimitConfigs(apiUrl, fixture, agentTokens);

    return {
      agentToken: agentTokens.alice,
      agentTokens,
      apiUrl,
      close,
      dataFile,
      fixture,
      identities: fixture.identities,
      sessionCookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(webSessionToken)}`,
      tmpDir,
      webSessionToken,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function getAvailablePort() {
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

async function seedRateLimitConfigs(
  apiUrl: string,
  fixture: TokenBoardTestFixture,
  agentTokens: Record<FixtureUserKey, string>
) {
  for (const key of Object.keys(fixture.rateLimitConfigs) as FixtureUserKey[]) {
    const rateLimits = fixture.rateLimitConfigs[key];
    if (!rateLimits) {
      continue;
    }
    const response = await fetch(`${apiUrl}/api/usage/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agentTokens[key]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client: { name: "open-token-board-e2e", version: "0.1.0", platform: "darwin" },
        userConfig: {
          updatedAt: fixture.now.toISOString(),
          rateLimits,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to seed rate limit config for ${key}: HTTP ${response.status} ${await response.text()}`);
    }
  }
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
