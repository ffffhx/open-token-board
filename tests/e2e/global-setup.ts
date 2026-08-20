import { once } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { getAvailablePort, repoRoot, startTokenBoardHarness, type TokenBoardHarness } from "../support/harness";
import { startStaticServer, type StaticServer } from "../support/static-server";
import { e2eStatePath, type E2eState } from "./state";

export default async function globalSetup() {
  await fs.mkdir(path.dirname(e2eStatePath), { recursive: true });
  const webPort = await getAvailablePort();
  let harness: TokenBoardHarness | undefined;
  let staticServer: StaticServer | undefined;

  try {
    const webUrl = `http://127.0.0.1:${webPort}`;
    harness = await startTokenBoardHarness({ allowedOrigins: [webUrl] });
    await seedAgentSpeedHistory(harness);
    await buildWeb(harness.apiUrl);
    staticServer = await startStaticServer(path.join(repoRoot, "apps", "web", "out"), webPort);

    const state: E2eState = {
      apiUrl: harness.apiUrl,
      currentMonthPeriod: harness.fixture.currentMonthPeriod,
      primaryLogin: harness.fixture.primaryLogin,
      webSessionToken: harness.webSessionToken,
      webUrl: staticServer.url,
    };
    await fs.writeFile(e2eStatePath, `${JSON.stringify(state, null, 2)}\n`);

    return async () => {
      await staticServer?.close();
      await harness?.close();
      await fs.rm(path.dirname(e2eStatePath), { recursive: true, force: true });
    };
  } catch (error) {
    await staticServer?.close().catch(() => undefined);
    await harness?.close().catch(() => undefined);
    await fs.rm(path.dirname(e2eStatePath), { recursive: true, force: true });
    throw error;
  }
}

async function seedAgentSpeedHistory(harness: TokenBoardHarness) {
  const now = new Date();
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  const date = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const response = await fetch(`${harness.apiUrl}/api/agent-speed/history`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${harness.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      snapshots: [{
        date,
        capturedAt: now.toISOString(),
        requestSampleCount: 80,
        closedTurnCount: 24,
        modelSpeed: [{
          engine: "codex",
          model: "gpt-e2e",
          sampleCount: 80,
          outputSpreadRatio: 5.2,
          available: true,
          decodeTokensPerSecond: 64.5,
          fixedOverheadSeconds: 2.4,
          jitterP90: 1.4,
          jitterP99: 2.1,
          rSquared: 0.72,
          confidence: "medium",
        }],
        timeComposition: [{
          engine: "all",
          turnCount: 24,
          wallMs: 120_000,
          toolMs: 30_000,
          nonToolMs: 90_000,
          toolPercent: 25,
          nonToolPercent: 75,
        }],
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`agent speed seed failed: HTTP ${response.status} ${await response.text()}`);
  }
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
