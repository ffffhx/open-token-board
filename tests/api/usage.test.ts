import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  evaluateTokenGoals,
  type TokenGoal,
} from "../../packages/token-board-core/src/token-goals";
import {
  buildTokenLeaderboard,
  type TokenUsageEvent,
} from "../../packages/token-board-core/src/token-leaderboard";
import { parseUsageFile } from "../../packages/token-board-core/src/token-usage-collector";
import { startTokenBoardHarness, type TokenBoardHarness } from "../support/harness";

let harness: TokenBoardHarness;
let ingestSequence = 0;

before(async () => {
  harness = await startTokenBoardHarness();
});

after(async () => {
  await harness?.close();
});

describe("usage stats", () => {
  it("covers rolling range with trends and honor fields", async () => {
    const payload = await getJson(`/api/usage/stats?range=7D&metric=tokens&now=${nowParam()}`);

    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.records, harness.fixture.events.length);
    assert.equal(payload.summary.range, "7D");
    assert.ok(payload.summary.totalTokens > 0);
    assert.ok(Array.isArray(payload.summary.trends.model.daily));
    assert.ok(payload.summary.trends.model.segments.length >= 2);

    const leader = payload.summary.users[0];
    assert.equal(typeof leader.level.current.name, "string");
    assert.ok(Array.isArray(leader.badges));
    assert.equal(typeof leader.personalBests.singleDay.tokens, "number");
    assert.equal(typeof payload.summary.efficiency.qualifiedUsers.errorRate, "number");
    assert.equal(typeof leader.efficiency.errorRate.status, "string");
  });

  it("covers calendar month range", async () => {
    const payload = await getJson(`/api/usage/stats?range=month&metric=sessions&now=${nowParam()}`);

    assert.equal(payload.summary.range, "month");
    assert.ok(payload.summary.users.length >= 3);
    assert.ok(payload.summary.daily.length >= 1);
  });

  it("covers explicit from/to range", async () => {
    const { customFrom, customTo } = harness.fixture;
    const payload = await getJson(`/api/usage/stats?from=${customFrom}&to=${customTo}&metric=cost&now=${nowParam()}`);

    assert.equal(payload.summary.range, "custom");
    assert.equal(payload.summary.daily[0].date, customFrom);
    assert.ok(payload.summary.totalCostUsd >= 0);
  });
});

describe("account, public profile, and wrapped", () => {
  it("returns 401 for /api/usage/me without login", async () => {
    const response = await request("/api/usage/me");
    assert.equal(response.status, 401);
  });

  it("returns /api/usage/me for a web session", async () => {
    const payload = await getJson(`/api/usage/me?range=7D&now=${nowParam()}`, {
      headers: { cookie: harness.sessionCookie },
    });

    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.user.githubLogin, harness.fixture.primaryLogin);
    assert.ok(payload.profile.records > 0);
    assert.ok(payload.profile.config.rateLimits.available);
    assert.ok(Array.isArray(payload.profile.goals));
    assert.equal(typeof payload.profile.efficiency.errorRate.status, "string");
    assert.equal(typeof payload.profile.user.efficiency.tokensPerSession.status, "string");
  });

  it("guards /api/usage/goals and rejects invalid goals", async () => {
    const unauthorized = await request("/api/usage/goals");
    assert.equal(unauthorized.status, 401);

    const invalid = await request(`/api/usage/goals?now=${nowParam()}`, {
      method: "PUT",
      headers: {
        cookie: harness.sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goals: [
          { type: "daily_tokens", target: 1000 },
          { type: "weekly_tokens", target: 2000 },
          { type: "weekly_cost_cap", target: 10 },
          { type: "daily_streak", target: 3 },
        ],
      }),
    });
    const payload = await invalid.json();
    assert.equal(invalid.status, 400);
    assert.equal(payload.error, "Invalid goals");
  });

  it("saves goals and includes evaluated goals in /api/usage/me", async () => {
    const saved = await getJson(`/api/usage/goals?now=${nowParam()}`, {
      method: "PUT",
      headers: {
        cookie: harness.sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goals: [
          { type: "daily_tokens", target: 1_000 },
          { type: "weekly_tokens", target: 1_000 },
          { type: "weekly_cost_cap", target: 100 },
        ],
      }),
    });

    assert.equal(saved.goals.length, 3);
    assert.equal(saved.evaluations[0].goal.type, "daily_tokens");
    assert.equal(saved.evaluations[1].goal.type, "weekly_tokens");
    assert.equal(saved.evaluations[2].status, "in_progress");

    const goals = await getJson(`/api/usage/goals?now=${nowParam()}`, {
      headers: { cookie: harness.sessionCookie },
    });
    assert.equal(goals.evaluations.length, 3);

    const me = await getJson(`/api/usage/me?range=7D&now=${nowParam()}`, {
      headers: { cookie: harness.sessionCookie },
    });
    assert.equal(me.profile.goals.length, 3);
    assert.equal(me.profile.goals[0].goal.type, "daily_tokens");
  });

  it("returns public user 200 and 404", async () => {
    const ok = await getJson(`/api/usage/user?login=${harness.fixture.primaryLogin}&now=${nowParam()}`);
    assert.equal(ok.user.login, harness.fixture.primaryLogin);
    assert.equal(ok.profile.daily365.length, 365);

    const missing = await request("/api/usage/user?login=missing-token-user");
    assert.equal(missing.status, 404);
  });

  it("returns wrapped month, year, and 404", async () => {
    const month = await getJson(
      `/api/usage/wrapped?login=${harness.fixture.primaryLogin}&period=${harness.fixture.currentMonthPeriod}&now=${nowParam()}`
    );
    assert.equal(month.period.type, "month");
    assert.ok(month.totals.tokens > 0);

    const year = await getJson(
      `/api/usage/wrapped?login=${harness.fixture.primaryLogin}&period=${harness.fixture.currentYearPeriod}&now=${nowParam()}`
    );
    assert.equal(year.period.type, "year");
    assert.ok(year.totals.tokens >= month.totals.tokens);

    const missing = await request(`/api/usage/wrapped?login=missing-token-user&period=${harness.fixture.currentMonthPeriod}`);
    assert.equal(missing.status, 404);
  });
});

describe("goal evaluation", () => {
  it("evaluates daily token and active streak chains in Asia/Shanghai", () => {
    const now = new Date("2026-07-08T04:00:00.000Z");
    const goals: TokenGoal[] = [
      goal("daily_tokens", 1_000, "2026-07-06T00:00:00.000Z"),
      goal("daily_streak", 3, "2026-07-06T00:00:00.000Z"),
    ];
    const events = [
      usage("u-1", "2026-07-06T02:00:00.000Z", 1_200),
      usage("u-2", "2026-07-07T02:00:00.000Z", 1_300),
      usage("u-3", "2026-07-08T02:00:00.000Z", 1_400),
    ];

    const [daily, streak] = evaluateTokenGoals(goals, events, { now });

    assert.equal(daily.status, "achieved");
    assert.equal(daily.consecutiveSuccessCount, 3);
    assert.equal(streak.status, "achieved");
    assert.equal(streak.progress, 3);
  });

  it("fails weekly cost caps immediately after the cap is exceeded", () => {
    const now = new Date("2026-07-08T04:00:00.000Z");
    const [cap] = evaluateTokenGoals(
      [goal("weekly_cost_cap", 10, "2026-07-06T00:00:00.000Z")],
      [usage("cost-1", "2026-07-08T02:00:00.000Z", 1_000, 12)],
      { now }
    );

    assert.equal(cap.status, "failed");
    assert.equal(cap.progress, 12);
    assert.equal(cap.unit, "week");
  });
});

describe("efficiency metrics", () => {
  it("aggregates ready, insufficient, and legacy quality signals", () => {
    const now = new Date("2026-07-08T04:00:00.000Z");
    const events = [
      ...qualitySessions("alice", now, { errorCount: 1, interruptedCount: 0, toolCallCount: 10 }),
      ...qualitySessions("bob", now, { errorCount: 2, interruptedCount: (index) => (index < 2 ? 1 : 0), toolCallCount: 10 }),
      qualityUsage("small", now, { errorCount: 1, interruptedCount: 0, toolCallCount: 20 }),
      qualityUsage("legacy", now, {}),
    ];
    const summary = buildTokenLeaderboard(events, { range: "7D", metric: "tokens", now });
    const alice = leaderboardUser(summary.users, "alice");
    const bob = leaderboardUser(summary.users, "bob");
    const small = leaderboardUser(summary.users, "small");
    const legacy = leaderboardUser(summary.users, "legacy");

    assert.equal(alice.efficiency.errorRate.status, "ready");
    assert.equal(alice.efficiency.errorRate.value, 0.1);
    assert.equal(alice.efficiency.errorRate.comparison, "lower");
    assert.equal(bob.efficiency.errorRate.value, 0.2);
    assert.ok(summary.efficiency.errorRateMedian !== null);
    assert.ok(Math.abs(summary.efficiency.errorRateMedian - 0.15) < 1e-9);
    assert.equal(alice.efficiency.interruptionRate.value, 0);
    assert.equal(bob.efficiency.interruptionRate.value, 0.2);
    assert.equal(small.efficiency.errorRate.status, "insufficient");
    assert.equal(legacy.efficiency.errorRate.status, "no_data");
  });

  it("extracts Claude and Codex quality counters from transcript fixtures", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "open-token-board-quality-"));

    try {
      const claudePath = path.join(dir, "claude.jsonl");
      await writeJsonl(claudePath, [
        {
          type: "assistant",
          timestamp: "2026-07-08T01:00:00.000Z",
          message: {
            role: "assistant",
            usage: { input_tokens: 100, output_tokens: 20 },
            content: [{ type: "tool_result", is_error: true }],
          },
        },
        {
          type: "user",
          timestamp: "2026-07-08T01:01:00.000Z",
          message: { role: "user", content: "[Request interrupted by user]" },
        },
      ]);

      const codexPath = path.join(dir, "codex.jsonl");
      await writeJsonl(codexPath, [
        {
          type: "session_meta",
          timestamp: "2026-07-08T02:00:00.000Z",
          payload: { model: "gpt-5-codex", cwd: "/tmp/open-token-board" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-08T02:01:00.000Z",
          payload: { type: "mcp_tool_call_end", result: { Ok: { isError: true } } },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-08T02:02:00.000Z",
          payload: { type: "turn_aborted" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-08T02:03:00.000Z",
          payload: {
            type: "token_count",
            id: "codex-quality-session",
            info: { last_token_usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 } },
          },
        },
      ]);

      const [claude] = await parseUsageFile(claudePath, {
        displayName: "fixture-user",
        filePath: claudePath,
        source: "claude-code",
        team: "Test",
        tool: "Claude Code",
        userId: "github:fixture-user",
      });
      const [codex] = await parseUsageFile(codexPath, {
        displayName: "fixture-user",
        filePath: codexPath,
        source: "codex",
        team: "Test",
        tool: "Codex CLI",
        userId: "github:fixture-user",
      });

      assert.equal(claude.errorCount, 1);
      assert.equal(claude.toolCallCount, 1);
      assert.equal(claude.interruptedCount, 1);
      assert.equal(codex.errorCount, 1);
      assert.equal(codex.toolCallCount, 1);
      assert.equal(codex.interruptedCount, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("export and badge", () => {
  it("exports leaderboard csv with BOM and expected row count", async () => {
    const stats = await getJson(`/api/usage/stats?range=7D&metric=tokens&now=${nowParam()}`);
    const response = await request(`/api/usage/export?format=csv&range=7D&metric=tokens&now=${nowParam()}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/csv/);
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(csv.trimEnd().split("\r\n").length, stats.summary.users.length + 1);
  });

  it("exports leaderboard json", async () => {
    const payload = await getJson(`/api/usage/export?format=json&range=7D&metric=tokens&now=${nowParam()}`);

    assert.equal(payload.scope, "leaderboard");
    assert.equal(payload.range, "7D");
    assert.ok(Array.isArray(payload.users));
  });

  it("returns parseable flat, weekly, and unknown badge SVGs", async () => {
    for (const path of [
      `/api/badge?login=${harness.fixture.primaryLogin}&style=flat&now=${nowParam()}`,
      `/api/badge?login=${harness.fixture.primaryLogin}&style=weekly&now=${nowParam()}`,
      "/api/badge?login=missing-token-user&style=weekly",
    ]) {
      const response = await request(path);
      const svg = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /image\/svg\+xml/);
      assertValidSvg(svg);
    }
  });
});

describe("rate limit and health", () => {
  it("guards and returns sorted team rate limits", async () => {
    const unauthorized = await request("/api/usage/rate-limits/team");
    assert.equal(unauthorized.status, 401);

    const payload = await getJson("/api/usage/rate-limits/team", {
      headers: { cookie: harness.sessionCookie },
    });
    const weekly = payload.users.map((user: { weeklyRemainingPercent: number | null }) => user.weeklyRemainingPercent);

    assert.equal(payload.schemaVersion, 1);
    assert.ok(payload.users.length >= 3);
    assert.deepEqual(weekly, [...weekly].sort((left, right) => Number(left) - Number(right)));
    assert.equal(payload.users[0].login, harness.fixture.primaryLogin);
  });

  it("returns usage health structure", async () => {
    const payload = await getJson("/api/usage/health");

    assert.equal(payload.ok, true);
    assert.equal(payload.records, harness.fixture.events.length);
    assert.equal(payload.eventsTotal, harness.fixture.events.length);
    assert.equal(payload.storage, "file");
    assert.equal(payload.storageBackend.type, "file");
    assert.equal(payload.storageBackend.eventCount, harness.fixture.events.length);
    assert.equal(typeof payload.storageBackend.lastWriteAt, "string");
    assert.equal(payload.storageBackend.backups.enabled, true);
    assert.equal(typeof payload.storageBackend.backups.retained, "number");
    assert.equal(payload.snapshotShareStorage, "file");
    assert.equal(typeof payload.pricing.unmatchedModels.length, "number");
    assert.equal(typeof payload.leaderboardSnapshots.refreshing, "boolean");
  });
});

describe("ingest validation", () => {
  it("accepts a valid event", async () => {
    const payload = await postIngest([ingestEvent()]);

    assert.equal(payload.ok, true);
    assert.equal(payload.accepted, 1);
  });

  it("rejects negative token counts", async () => {
    await assertIngestRejected([ingestEvent({ inputTokens: -1, outputTokens: 20, totalTokens: 19 })]);
  });

  it("rejects mismatched totals", async () => {
    await assertIngestRejected([ingestEvent({ inputTokens: 100, outputTokens: 20, totalTokens: 999 })]);
  });

  it("rejects future dates", async () => {
    await assertIngestRejected([ingestEvent({ timestamp: new Date(harness.fixture.now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() })]);
  });

  it("rejects single events over the configured cap", async () => {
    await assertIngestRejected([ingestEvent({ inputTokens: 1_000_001, outputTokens: 1, totalTokens: 1_000_002 })]);
  });

  it("accepts legacy events without cache split fields", async () => {
    const payload = await postIngest([
      {
        source: "legacy-agent",
        model: "legacy-model",
        project: "legacy",
        timestamp: new Date(harness.fixture.now.getTime() - 40 * 60_000).toISOString(),
        input_tokens: 500,
        output_tokens: 150,
        total_tokens: 650,
        messages: 1,
        sessionId: `legacy-${ingestSequence++}`,
      },
    ]);

    assert.equal(payload.ok, true);
    assert.equal(payload.accepted, 1);
  });

  it("rejects invalid quality counters", async () => {
    await assertIngestRejected([ingestEvent({ errorCount: 3, toolCallCount: 2 })]);
    await assertIngestRejected([ingestEvent({ interruptedCount: 2 })]);
  });
});

async function assertIngestRejected(events: unknown[]) {
  const response = await request("/api/usage/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${harness.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ events }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "Token usage batch rejected");
  assert.ok(Array.isArray(payload.errors));
  assert.ok(payload.errors.length > 0);
}

async function postIngest(events: unknown[]) {
  const response = await request("/api/usage/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${harness.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ events }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

function ingestEvent(overrides: Record<string, unknown> = {}) {
  const inputTokens = Number(overrides.inputTokens ?? 1_200);
  const outputTokens = Number(overrides.outputTokens ?? 320);
  return {
    source: "codex",
    model: "gpt-5-codex",
    project: "e2e-ingest",
    timestamp: new Date(harness.fixture.now.getTime() - (10 + ingestSequence++) * 60_000).toISOString(),
    inputTokens,
    cacheCreationInputTokens: 100,
    cachedInputTokens: 400,
    outputTokens,
    reasoningOutputTokens: Math.min(80, Math.max(0, outputTokens)),
    totalTokens: inputTokens + outputTokens,
    messages: 2,
    sessionId: `ingest-${ingestSequence}`,
    ...overrides,
  };
}

function goal(type: TokenGoal["type"], target: number, createdAt: string): TokenGoal {
  return {
    id: `${type}-${target}`,
    type,
    target,
    createdAt,
    updatedAt: createdAt,
  };
}

function usage(id: string, timestamp: string, tokens: number, costUsd = 0): TokenUsageEvent {
  return {
    id,
    userId: "github:test-goals",
    displayName: "test-goals",
    team: "Test",
    source: "codex",
    model: "gpt-5-codex",
    project: "goals",
    tool: "Codex CLI",
    timestamp,
    inputTokens: tokens,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
    costUsd,
    messages: 1,
  };
}

function qualitySessions(
  user: string,
  now: Date,
  counts: {
    errorCount: number | ((index: number) => number);
    interruptedCount: number | ((index: number) => number);
    toolCallCount: number | ((index: number) => number);
  }
) {
  return Array.from({ length: 10 }, (_, index) =>
    qualityUsage(user, new Date(now.getTime() - (index + 1) * 60_000), {
      errorCount: valueAt(counts.errorCount, index),
      interruptedCount: valueAt(counts.interruptedCount, index),
      toolCallCount: valueAt(counts.toolCallCount, index),
    })
  );
}

function qualityUsage(
  user: string,
  timestamp: Date,
  counts: Partial<Pick<TokenUsageEvent, "errorCount" | "interruptedCount" | "toolCallCount">>
): TokenUsageEvent {
  const tokens = 1_000;

  return {
    id: `${user}-${timestamp.getTime()}-${counts.toolCallCount ?? "legacy"}`,
    userId: `github:${user}`,
    displayName: user,
    team: "Quality",
    source: "codex",
    model: "gpt-5-codex",
    project: "quality",
    tool: "Codex CLI",
    timestamp: timestamp.toISOString(),
    inputTokens: tokens,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
    costUsd: 0,
    messages: 1,
    sessionId: `${user}-${timestamp.getTime()}`,
    ...counts,
  };
}

function valueAt(value: number | ((index: number) => number), index: number) {
  return typeof value === "function" ? value(index) : value;
}

function leaderboardUser(users: ReturnType<typeof buildTokenLeaderboard>["users"], name: string) {
  const user = users.find((item) => item.displayName === name);
  assert.ok(user, `Expected leaderboard user ${name}`);
  return user;
}

async function writeJsonl(filePath: string, records: unknown[]) {
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function getJson(path: string, init?: RequestInit) {
  const response = await request(path, init);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

function request(path: string, init?: RequestInit) {
  return fetch(`${harness.apiUrl}${path}`, init);
}

function nowParam() {
  return encodeURIComponent(harness.fixture.now.toISOString());
}

function assertValidSvg(svg: string) {
  assert.match(svg, /^<svg\b[\s\S]*<\/svg>$/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  const stack: string[] = [];
  for (const match of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g)) {
    const tag = match[1];
    const source = match[0];
    if (source.startsWith("</")) {
      assert.equal(stack.pop(), tag);
    } else if (!source.endsWith("/>")) {
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, []);
}
