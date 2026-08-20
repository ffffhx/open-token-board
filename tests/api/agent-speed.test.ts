import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Engine, NormalizedEvent, NormalizedSession } from "agent-session-core";

import {
  analyzeAgentSpeedSamples,
  buildAgentSpeedDailySnapshots,
  extractAgentSpeedSamples,
  extractGrokSpeedSamplesFromText,
  extractKimiSpeedSamplesFromText,
  sanitizeAgentSpeedDailySnapshots,
  type AgentSpeedRequestSample,
} from "../../packages/token-board-core/src/agent-speed";
import {
  analyzeAgentSpeedSamples as analyzeStandaloneAgentSpeedSamples,
  buildAgentSpeedDailySnapshots as buildStandaloneAgentSpeedDailySnapshots,
  createAgentSpeedAnalyzer,
  extractAgentSpeedSamples as extractStandaloneAgentSpeedSamples,
  extractGrokSpeedSamplesFromText as extractStandaloneGrokSpeedSamplesFromText,
  extractKimiSpeedSamplesFromText as extractStandaloneKimiSpeedSamplesFromText,
} from "../../tools/token-board-agent-npx/bin/agent-speed.mjs";
import { startTokenBoardHarness } from "../support/harness";

test("Huber regression recovers decode speed and fixed overhead despite outliers", () => {
  const samples: AgentSpeedRequestSample[] = Array.from({ length: 120 }, (_, index) => {
    const outputTokens = 20 + ((index * 173) % 1_980);
    const missTokens = (index * 7_919) % 80_000;
    const followedByTool = index % 3 !== 0;
    const noiseSeconds = ((index % 9) - 4) * 0.025;
    const outlierSeconds = index % 31 === 0 ? 35 : 0;
    const latencySeconds =
      3 + outputTokens / 100 + missTokens * 0.00002 + (followedByTool ? 0.8 : 0) + noiseSeconds + outlierSeconds;
    return {
      engine: "claude" as const,
      model: "test-model",
      latencyMs: latencySeconds * 1_000,
      outputTokens,
      missTokens,
      followedByTool,
    };
  });

  const summary = analyzeAgentSpeedSamples(samples, []).modelSpeed[0];
  const standaloneSummary = analyzeStandaloneAgentSpeedSamples(samples, []).modelSpeed[0];
  assert.equal(summary.available, true);
  assert.ok(summary.decodeTokensPerSecond);
  assert.ok(summary.fixedOverheadSeconds);
  assert.ok(Math.abs(summary.decodeTokensPerSecond - 100) < 3, String(summary.decodeTokensPerSecond));
  assert.ok(Math.abs(summary.fixedOverheadSeconds - 3) < 0.4, String(summary.fixedOverheadSeconds));
  assert.ok((summary.jitterP99 ?? 0) > (summary.jitterP90 ?? 0));
  assert.deepEqual(standaloneSummary, summary);
});

test("aggregate request counts preserve per-call fixed overhead", () => {
  const samples: AgentSpeedRequestSample[] = Array.from({ length: 120 }, (_, index) => {
    const requestCount = 1 + (index % 7);
    const outputTokens = 30 + ((index * 277) % 2_970);
    return {
      engine: "grok",
      model: "grok-test",
      latencyMs: (requestCount * 2 + outputTokens / 50) * 1_000,
      outputTokens,
      missTokens: 0,
      followedByTool: false,
      requestCount,
    };
  });

  const summary = analyzeAgentSpeedSamples(samples, []).modelSpeed[0];
  const standaloneSummary = analyzeStandaloneAgentSpeedSamples(samples, []).modelSpeed[0];
  assert.equal(summary.available, true);
  assert.ok(Math.abs((summary.decodeTokensPerSecond ?? 0) - 50) < 0.1);
  assert.ok(Math.abs((summary.fixedOverheadSeconds ?? 0) - 2) < 0.01);
  assert.deepEqual(standaloneSummary, summary);
});

test("Kimi and Grok native logs produce private request-speed samples", () => {
  const kimiText = [
    { type: "llm.request", time: 1_780_000_000_000, model: "k3", modelAlias: "kimi-code/k3" },
    {
      type: "usage.record",
      time: 1_780_000_012_000,
      model: "kimi-code/k3",
      usage: { inputOther: 800, inputCacheRead: 10_000, output: 500 },
    },
  ].map((row) => JSON.stringify(row)).join("\n");
  const kimi = extractKimiSpeedSamplesFromText(kimiText);
  assert.deepEqual(extractStandaloneKimiSpeedSamplesFromText(kimiText), kimi);
  assert.deepEqual(kimi, [{
    engine: "kimi",
    model: "kimi-code/k3",
    latencyMs: 12_000,
    outputTokens: 500,
    missTokens: 800,
    followedByTool: false,
    requestCount: 1,
    observedAt: "2026-05-28T20:26:52.000Z",
  }]);

  const grokText = JSON.stringify({
    timestamp: 1_780_000_020,
    params: {
      _meta: { agentTimestampMs: 1_780_000_020_000 },
      update: {
        usage: {
          modelUsage: {
            "grok-4.6-build": {
              inputTokens: 40_000,
              cachedReadTokens: 30_000,
              outputTokens: 1_200,
              modelCalls: 4,
              apiDurationMs: 28_000,
            },
          },
        },
      },
    },
  });
  const grok = extractGrokSpeedSamplesFromText(grokText);
  assert.deepEqual(extractStandaloneGrokSpeedSamplesFromText(grokText), grok);
  assert.deepEqual(grok, [{
    engine: "grok",
    model: "grok-4.6-build",
    latencyMs: 28_000,
    outputTokens: 1_200,
    missTokens: 10_000,
    followedByTool: false,
    requestCount: 4,
    observedAt: "2026-05-28T20:27:00.000Z",
  }]);
});

test("model summaries reject too few or too narrowly distributed samples", () => {
  const base = (count: number, model: string, output: (index: number) => number): AgentSpeedRequestSample[] =>
    Array.from({ length: count }, (_, index) => ({
      engine: "codex",
      model,
      latencyMs: 2_000 + output(index) * 10,
      outputTokens: output(index),
      missTokens: index * 101,
      followedByTool: index % 2 === 0,
    }));

  const summaries = analyzeAgentSpeedSamples(
    [...base(29, "small", (index) => 10 + index * 20), ...base(40, "narrow", (index) => 1_000 + index)],
    []
  ).modelSpeed;
  assert.equal(summaries.find((item) => item.model === "small")?.unavailableReason, "too_few_samples");
  assert.equal(summaries.find((item) => item.model === "narrow")?.unavailableReason, "output_range_too_narrow");
});

test("Claude request endpoints include later streamed output blocks", () => {
  const session = makeSession("claude", [
    message("2026-01-01T00:00:00.000Z", "user"),
    message("2026-01-01T00:00:02.000Z", "assistant"),
    usage("2026-01-01T00:00:02.000Z", 200),
    toolCall("2026-01-01T00:00:04.000Z", "a"),
    toolResult("2026-01-01T00:00:07.000Z", "a"),
    usage("2026-01-01T00:00:10.000Z", 300),
    message("2026-01-01T00:00:11.000Z", "assistant"),
    message("2026-01-01T00:00:20.000Z", "user"),
  ]);

  const result = extractAgentSpeedSamples(session);
  assert.deepEqual(extractStandaloneAgentSpeedSamples(session), result);
  assert.deepEqual(result.requests.map((sample) => sample.latencyMs), [4_000, 4_000]);
  assert.deepEqual(result.requests.map((sample) => sample.followedByTool), [true, false]);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].wallMs, 11_000);
  assert.equal(result.turns[0].toolMs, 3_000);
  assert.equal(result.turns[0].nonToolMs, 8_000);
});

test("Codex consecutive usage events use the previous usage as their next anchor", () => {
  const session = makeSession("codex", [
    message("2026-01-01T00:00:00.000Z", "user"),
    message("2026-01-01T00:00:05.000Z", "assistant"),
    usage("2026-01-01T00:00:06.000Z", 100),
    { kind: "reasoning", ts: "2026-01-01T00:00:07.000Z" },
    message("2026-01-01T00:00:09.000Z", "assistant"),
    usage("2026-01-01T00:00:10.000Z", 200),
    message("2026-01-01T00:00:20.000Z", "user"),
  ]);

  const result = extractAgentSpeedSamples(session);
  assert.deepEqual(extractStandaloneAgentSpeedSamples(session), result);
  assert.deepEqual(result.requests.map((sample) => sample.latencyMs), [6_000, 4_000]);
});

test("time composition unions parallel tools, ignores unpaired tools, and excludes compaction turns", () => {
  const parallel = makeSession("claude", [
    message("2026-01-01T00:00:00.000Z", "user"),
    toolCall("2026-01-01T00:00:02.000Z", "a"),
    toolCall("2026-01-01T00:00:03.000Z", "b"),
    toolCall("2026-01-01T00:00:04.000Z", "never-finishes"),
    toolResult("2026-01-01T00:00:06.000Z", "b"),
    toolResult("2026-01-01T00:00:08.000Z", "a"),
    message("2026-01-01T00:00:10.000Z", "assistant"),
    message("2026-01-01T00:00:12.000Z", "user"),
    { kind: "compaction", ts: "2026-01-01T00:00:13.000Z" },
    message("2026-01-01T00:00:15.000Z", "assistant"),
    message("2026-01-01T00:00:20.000Z", "user"),
  ]);

  const turns = extractAgentSpeedSamples(parallel).turns;
  assert.equal(turns.length, 1);
  assert.equal(turns[0].wallMs, 10_000);
  assert.equal(turns[0].toolMs, 6_000);
  assert.equal(turns[0].nonToolMs, 4_000);
});

test("patched ASC normalizes modern Codex custom tool calls", async () => {
  const { parseSessionText } = await import(
    "../../packages/token-board-core/node_modules/agent-session-core/src/index.mjs"
  );
  const rows = [
    { timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload: { id: "modern", model: "gpt-test" } },
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "start" }] },
    },
    {
      timestamp: "2026-01-01T00:00:02.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", call_id: "call-modern", input: "tools.exec()" },
    },
    {
      timestamp: "2026-01-01T00:00:05.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call_output", call_id: "call-modern", output: [{ type: "input_text", text: "ok" }] },
    },
    {
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
    },
    {
      timestamp: "2026-01-01T00:00:07.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 } },
      },
    },
    {
      timestamp: "2026-01-01T00:00:10.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
    },
  ];
  const session = parseSessionText("codex", rows.map((row) => JSON.stringify(row)).join("\n"));
  const toolKinds = session.events.filter((event) => event.kind === "tool_call" || event.kind === "tool_result");
  assert.deepEqual(toolKinds.map((event) => event.kind), ["tool_call", "tool_result"]);
  const turns = extractAgentSpeedSamples(session).turns;
  const requests = extractAgentSpeedSamples(session).requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].latencyMs, 2_000);
  assert.equal(requests[0].followedByTool, true);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].wallMs, 7_000);
  assert.equal(turns[0].toolMs, 3_000);
});

test("standalone npm analyzer enriches custom tools even with unpatched ASC output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "token-board-speed-modern-"));
  const filePath = path.join(root, "modern.jsonl");
  const rows = [
    { timestamp: "2026-01-01T00:00:00.000Z", type: "response_item", payload: { type: "message", role: "user" } },
    {
      timestamp: "2026-01-01T00:00:02.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", call_id: "standalone", input: "tools.exec()" },
    },
    {
      timestamp: "2026-01-01T00:00:05.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call_output", call_id: "standalone", output: "ok" },
    },
  ];
  try {
    await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n"));
    const session = makeSession("codex", [
      message("2026-01-01T00:00:00.000Z", "user"),
      usage("2026-01-01T00:00:05.000Z", 100),
      message("2026-01-01T00:00:07.000Z", "assistant"),
      message("2026-01-01T00:00:10.000Z", "user"),
    ]);
    session.filePath = filePath;
    const analyzer = createAgentSpeedAnalyzer();
    analyzer.addSession(session);
    const result = analyzer.finish();
    assert.equal(result.requestSampleCount, 1);
    assert.equal(result.timeComposition[0]?.toolMs, 3_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("daily history uses Shanghai calendar days and matches the standalone analyzer", () => {
  const requests: AgentSpeedRequestSample[] = Array.from({ length: 70 }, (_, index) => {
    const secondDay = index >= 35;
    const outputTokens = 20 + (index % 35) * 80;
    return {
      engine: "codex",
      model: "gpt-daily",
      latencyMs: 1_500 + outputTokens * 12,
      outputTokens,
      missTokens: index * 113,
      followedByTool: index % 2 === 0,
      observedAt: secondDay ? "2026-08-20T02:00:00.000Z" : "2026-08-18T16:30:00.000Z",
    };
  });
  const turns = [
    { engine: "codex" as const, wallMs: 10_000, toolMs: 3_000, nonToolMs: 7_000, observedAt: "2026-08-18T16:10:00.000Z" },
    { engine: "claude" as const, wallMs: 20_000, toolMs: 5_000, nonToolMs: 15_000, observedAt: "2026-08-20T03:00:00.000Z" },
  ];
  const options = { capturedAt: new Date("2026-08-20T08:00:00.000Z") };
  const history = buildAgentSpeedDailySnapshots(requests, turns, options);

  assert.deepEqual(buildStandaloneAgentSpeedDailySnapshots(requests, turns, options), history);
  assert.deepEqual(history.map((entry) => entry.date), ["2026-08-19", "2026-08-20"]);
  assert.equal(history[0].requestSampleCount, 35);
  assert.equal(history[0].timeComposition.find((entry) => entry.engine === "all")?.toolPercent, 30);
  assert.equal(history[1].modelSpeed[0].available, true);
});

test("daily history sanitizer rejects inconsistent time composition", () => {
  const sanitized = sanitizeAgentSpeedDailySnapshots([
    {
      date: "2026-08-20",
      capturedAt: "2026-08-20T08:00:00.000Z",
      requestSampleCount: 0,
      closedTurnCount: 1,
      modelSpeed: [],
      timeComposition: [{ engine: "all", turnCount: 1, wallMs: 100, toolMs: 101, nonToolMs: 0 }],
    },
  ]);
  assert.equal(sanitized.snapshots.length, 0);
  assert.equal(sanitized.errors.length, 1);
});

test("agent speed history API upserts and isolates snapshots by authenticated user", async () => {
  const harness = await startTokenBoardHarness();
  const date = shanghaiDayKey(new Date());
  const snapshot = makeDailySnapshot(date, 42);
  try {
    const unauthorized = await fetch(`${harness.apiUrl}/api/agent-speed/history`);
    assert.equal(unauthorized.status, 401);

    const upload = await fetch(`${harness.apiUrl}/api/agent-speed/history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${harness.agentToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, snapshots: [snapshot] }),
    });
    assert.equal(upload.status, 200, await upload.text());

    const overwrite = await fetch(`${harness.apiUrl}/api/agent-speed/history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${harness.agentToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, snapshots: [makeDailySnapshot(date, 84)] }),
    });
    assert.equal(overwrite.status, 200, await overwrite.text());

    const bobUpload = await fetch(`${harness.apiUrl}/api/agent-speed/history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${harness.agentTokens.bob}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, snapshots: [makeDailySnapshot(date, 21)] }),
    });
    assert.equal(bobUpload.status, 200, await bobUpload.text());

    const mine = await fetch(`${harness.apiUrl}/api/agent-speed/history?days=30`, {
      headers: { Cookie: harness.sessionCookie },
    });
    const minePayload = await mine.json() as { snapshots: Array<{ requestSampleCount: number }> };
    assert.equal(mine.status, 200, JSON.stringify(minePayload));
    assert.equal(minePayload.snapshots.length, 1);
    assert.equal(minePayload.snapshots[0].requestSampleCount, 84);

    const bob = await fetch(`${harness.apiUrl}/api/agent-speed/history?days=30`, {
      headers: { Authorization: `Bearer ${harness.agentTokens.bob}` },
    });
    const bobPayload = await bob.json() as { snapshots: Array<{ requestSampleCount: number }> };
    assert.equal(bobPayload.snapshots.length, 1);
    assert.equal(bobPayload.snapshots[0].requestSampleCount, 21);
  } finally {
    await harness.close();
  }
});

function makeSession(engine: Engine, events: NormalizedEvent[]): NormalizedSession {
  return {
    engine,
    id: `${engine}-session`,
    filePath: "fixture.jsonl",
    cwd: "/fixture",
    model: "test-model",
    version: "test",
    gitBranch: "main",
    startedAt: events[0]?.ts ?? "",
    endedAt: events.at(-1)?.ts ?? "",
    mtimeMs: 0,
    sizeBytes: 0,
    title: "fixture",
    goalObjective: "",
    events,
  };
}

function message(ts: string, role: "user" | "assistant"): NormalizedEvent {
  return { kind: "message", ts, role, text: role };
}

function usage(ts: string, output: number): NormalizedEvent {
  return {
    kind: "token_usage",
    ts,
    usage: { input: 10_000, cached: 8_000, cacheCreation: 0, output, reasoning: 0 },
    model: "test-model",
  };
}

function toolCall(ts: string, callId: string): NormalizedEvent {
  return { kind: "tool_call", ts, name: "Bash", args: {}, callId };
}

function toolResult(ts: string, callId: string): NormalizedEvent {
  return { kind: "tool_result", ts, callId, ok: true };
}

function makeDailySnapshot(date: string, requestSampleCount: number) {
  return {
    date,
    capturedAt: new Date().toISOString(),
    requestSampleCount,
    closedTurnCount: 2,
    modelSpeed: [{
      engine: "codex",
      model: "gpt-api-test",
      sampleCount: requestSampleCount,
      outputSpreadRatio: 1,
      available: false,
      unavailableReason: "too_few_samples",
    }],
    timeComposition: [{
      engine: "all",
      turnCount: 2,
      wallMs: 10_000,
      toolMs: 2_500,
      nonToolMs: 7_500,
      toolPercent: 25,
      nonToolPercent: 75,
    }],
  };
}

function shanghaiDayKey(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
