import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

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
    assert.equal(payload.storage, "file");
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
