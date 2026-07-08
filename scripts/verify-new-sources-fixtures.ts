import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenUsageEvent } from "../packages/token-board-core/src/token-leaderboard";
import { parseUsageFile } from "../packages/token-board-core/src/token-usage-collector";

type ExpectedSummary = {
  records: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  models?: string[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const fixtureRoot = path.join(repoRoot, "fixtures", "token-usage");

const expected = {
  "gemini-cli": {
    records: 3,
    inputTokens: 15659,
    outputTokens: 1062,
    totalTokens: 16721,
    cachedInputTokens: 11586,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 959,
    models: ["gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview"],
  },
  opencode: {
    records: 2,
    inputTokens: 286,
    outputTokens: 110,
    totalTokens: 396,
    cachedInputTokens: 22,
    cacheCreationInputTokens: 44,
    reasoningOutputTokens: 5,
    models: ["claude-sonnet-4.5", "gemini-3-pro-preview"],
  },
} satisfies Record<string, ExpectedSummary>;

const tempRoot = mkdtempSync(path.join(tmpdir(), "otb-new-sources-"));

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

async function main() {
  const homeDir = path.join(tempRoot, "home");
  const geminiDir = path.join(homeDir, ".gemini", "tmp");
  const opencodeDir = path.join(homeDir, ".local", "share", "opencode");
  mkdirSync(geminiDir, { recursive: true });
  mkdirSync(opencodeDir, { recursive: true });

  cpSync(path.join(fixtureRoot, "gemini-cli"), geminiDir, { recursive: true });
  cpSync(path.join(fixtureRoot, "opencode"), opencodeDir, { recursive: true });
  createOpencodeSqliteFixture(path.join(opencodeDir, "opencode.db"));

  const coreEvents = [
    ...(await parseFixtureFile(path.join(geminiDir, "gemini-fixture", "chats", "session-a.jsonl"), "gemini-cli", "Gemini CLI")),
    ...(await parseFixtureFile(path.join(geminiDir, "gemini-fixture", "logs.json"), "gemini-cli", "Gemini CLI")),
    ...(await parseFixtureFile(
      path.join(opencodeDir, "storage", "message", "session-a", "msg-json-1.json"),
      "opencode",
      "opencode"
    )),
    ...(await parseFixtureFile(path.join(opencodeDir, "opencode.db"), "opencode", "opencode")),
  ];

  assertSummary("core gemini-cli", coreEvents, "gemini-cli", expected["gemini-cli"]);
  assertSummary("core opencode", coreEvents, "opencode", expected.opencode);

  const agentPayload = runAgentCollect(homeDir);
  assert.ok(Array.isArray(agentPayload.events), "agent collect payload should include events array");
  assertSummary("agent gemini-cli", agentPayload.events, "gemini-cli", expected["gemini-cli"]);
  assertSummary("agent opencode", agentPayload.events, "opencode", expected.opencode);

  console.log("new source fixture verification passed");
  console.log(JSON.stringify({ core: summarizeBySource(coreEvents), agent: summarizeBySource(agentPayload.events) }, null, 2));
}

async function parseFixtureFile(filePath: string, source: string, tool: string) {
  return parseUsageFile(filePath, {
    source,
    tool,
    filePath,
    userId: "fixture-user",
    displayName: "Fixture User",
    team: "Fixtures",
    project: "fixtures",
  } as Parameters<typeof parseUsageFile>[1]);
}

function createOpencodeSqliteFixture(dbPath: string) {
  const message = {
    providerID: "anthropic",
    modelID: "claude-sonnet-4.5",
    time: {
      created: 1779019501000,
    },
    tokens: {
      input: 120,
      output: 60,
      cache: {
        read: 12,
        write: 24,
      },
    },
    cost: 0,
  };
  const data = JSON.stringify(message).replace(/'/g, "''");
  const sql = [
    "create table message (id text primary key, session_id text not null, data text not null);",
    `insert into message (id, session_id, data) values ('db-msg-1', 'db-session-a', '${data}');`,
  ].join("\n");
  const result = spawnSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });

  assert.equal(result.status, 0, `sqlite3 fixture creation failed: ${result.stderr || result.stdout}`);
  assert.ok(existsSync(dbPath), "opencode sqlite fixture was not created");
}

function runAgentCollect(homeDir: string) {
  const configPath = path.join(tempRoot, "agent-config.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        userId: "fixture-user",
        displayName: "Fixture User",
        team: "Fixtures",
        includeDefaultSources: true,
      },
      null,
      2
    )
  );

  const result = spawnSync(process.execPath, [path.join(repoRoot, "tools", "token-board-agent-npx", "bin", "token-board-agent.mjs"), "collect"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      APPDATA: path.join(homeDir, "AppData", "Roaming"),
      CLAUDE_CONFIG_DIR: path.join(homeDir, ".claude"),
      CODEX_HOME: path.join(homeDir, ".codex"),
      GEMINI_DATA_DIR: path.join(homeDir, ".gemini", "tmp"),
      OPENCODE_DATA_DIR: path.join(homeDir, ".local", "share", "opencode"),
      TOKEN_BOARD_AGENT_CONFIG: configPath,
      TOKEN_BOARD_AGENT_STATE_FILE: path.join(tempRoot, "agent-state.json"),
      TOKEN_BOARD_INCLUDE_SESSION_TITLE: "false",
      TOKEN_BOARD_SINCE_HOURS: "87600",
      TOKEN_BOARD_MAX_FILES: "200",
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  assert.equal(result.status, 0, `agent collect failed:\n${result.stderr}\n${result.stdout}`);
  const jsonStart = result.stdout.indexOf("{");
  assert.ok(jsonStart >= 0, `agent collect did not print JSON:\n${result.stdout}`);
  return JSON.parse(result.stdout.slice(jsonStart));
}

function assertSummary(label: string, events: TokenUsageEvent[], source: string, expectedSummary: ExpectedSummary) {
  const actualEvents = events.filter((event) => event.source === source);
  const actual = summarize(actualEvents);

  assert.deepEqual(actual, expectedSummary, `${label} token summary mismatch`);
  assert.equal(new Set(actualEvents.map((event) => event.id)).size, actualEvents.length, `${label} emitted duplicate ids`);
}

function summarizeBySource(events: TokenUsageEvent[]) {
  return Object.fromEntries([...new Set(events.map((event) => event.source))].map((source) => [source, summarize(events.filter((event) => event.source === source))]));
}

function summarize(events: TokenUsageEvent[]): ExpectedSummary {
  return {
    records: events.length,
    inputTokens: sum(events, "inputTokens"),
    outputTokens: sum(events, "outputTokens"),
    totalTokens: sum(events, "totalTokens"),
    cachedInputTokens: sum(events, "cachedInputTokens"),
    cacheCreationInputTokens: sum(events, "cacheCreationInputTokens"),
    reasoningOutputTokens: sum(events, "reasoningOutputTokens"),
    models: [...new Set(events.map((event) => event.model))].sort(),
  };
}

function sum(events: TokenUsageEvent[], field: keyof TokenUsageEvent) {
  return events.reduce((total, event) => total + Number(event[field] || 0), 0);
}
