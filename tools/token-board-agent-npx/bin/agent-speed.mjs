// Runtime mirror of packages/token-board-core/src/agent-speed.ts for the
// standalone npm agent. Keep behavior aligned; parity is covered by API tests.

import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const MIN_LATENCY_MS = 300;
const MIN_MODEL_SAMPLES = 30;
const MIN_OUTPUT_SPREAD_RATIO = 3;

export function createAgentSpeedAnalyzer() {
  const requests = [];
  const turns = [];
  return {
    addSession(session) {
      enrichModernCodexTools(session);
      const samples = extractAgentSpeedSamples(session);
      requests.push(...samples.requests);
      turns.push(...samples.turns);
    },
    addRequestSamples(samples) {
      requests.push(...samples);
    },
    finish() {
      return analyzeAgentSpeedSamples(requests, turns);
    },
    finishHistory(options = {}) {
      return buildAgentSpeedDailySnapshots(requests, turns, options);
    },
  };
}

// The npm package must also work when the registry still serves ASC 0.1.1
// without the repository's pnpm patch. Enrich only the two modern Codex event
// kinds that version misses; call-id dedup keeps this a no-op once upstream ASC
// learns the format.
function enrichModernCodexTools(session) {
  if (session?.engine !== "codex" || !session.filePath) return;
  const existing = new Set(
    (session.events || []).flatMap((event) =>
      (event.kind === "tool_call" || event.kind === "tool_result") && event.callId
        ? [`${event.kind}:${event.callId}`]
        : []
    )
  );
  try {
    for (const rawLine of readSessionLines(session.filePath)) {
      if (!rawLine.includes("custom_tool_call")) continue;
      let row;
      try {
        row = JSON.parse(rawLine);
      } catch {
        continue;
      }
      const payload = row?.type === "response_item" ? row.payload : null;
      const callId = typeof payload?.call_id === "string" ? payload.call_id : "";
      const ts = typeof row?.timestamp === "string" ? row.timestamp : "";
      if (!callId || !ts) continue;
      if (payload.type === "custom_tool_call") {
        const key = `tool_call:${callId}`;
        if (existing.has(key)) continue;
        existing.add(key);
        session.events.push({
          kind: "tool_call",
          ts,
          name: typeof payload.name === "string" ? payload.name : "custom_tool_call",
          args: payload.input ?? "",
          callId,
        });
      } else if (payload.type === "custom_tool_call_output") {
        const key = `tool_result:${callId}`;
        if (existing.has(key)) continue;
        existing.add(key);
        session.events.push({
          kind: "tool_result",
          ts,
          callId,
          ok: true,
          outputText: stringifyToolOutput(payload.output),
        });
      }
    }
  } catch {
    // ASC already returned a usable session. A fallback enrichment read failure
    // must not make the entire local speed report disappear.
  }
}

function* readSessionLines(filePath) {
  const fd = openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let carry = "";
  let total = 0;
  const maxBytes = 256 * 1024 * 1024;
  try {
    while (total < maxBytes) {
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - total), null);
      if (bytes === 0) break;
      total += bytes;
      carry += decoder.write(buffer.subarray(0, bytes));
      let newline;
      while ((newline = carry.indexOf("\n")) !== -1) {
        yield carry.slice(0, newline);
        carry = carry.slice(newline + 1);
      }
    }
    carry += decoder.end();
    if (carry) yield carry;
  } finally {
    closeSync(fd);
  }
}

function stringifyToolOutput(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

export function analyzeAgentSpeedSamples(requestSamples, turnSamples) {
  return {
    modelSpeed: summarizeModelSpeed(requestSamples),
    timeComposition: summarizeTimeComposition(turnSamples),
    requestSampleCount: requestSamples.length,
    closedTurnCount: turnSamples.length,
  };
}

export function buildAgentSpeedDailySnapshots(requestSamples, turnSamples, options = {}) {
  const capturedAt = options.capturedAt instanceof Date ? options.capturedAt : new Date();
  const offsetMinutes = Number.isFinite(options.timeZoneOffsetMinutes) ? Number(options.timeZoneOffsetMinutes) : 8 * 60;
  const requestsByDay = groupSamplesByDay(requestSamples, offsetMinutes);
  const turnsByDay = groupSamplesByDay(turnSamples, offsetMinutes);
  const dayKeys = [...new Set([...requestsByDay.keys(), ...turnsByDay.keys()])].sort();
  return dayKeys.map((date) => ({
    date,
    capturedAt: capturedAt.toISOString(),
    ...analyzeAgentSpeedSamples(requestsByDay.get(date) || [], turnsByDay.get(date) || []),
  }));
}

export function extractAgentSpeedSamples(session) {
  const events = timedEvents(session.events || []);
  return {
    requests: extractRequestSamples(session, events),
    turns: extractTurnSamples(session, events),
  };
}

export function extractKimiSpeedSamplesFromText(text) {
  const samples = [];
  let pending;
  for (const rawLine of text.split(/\r?\n/)) {
    const record = parseJsonRecord(rawLine);
    if (!record) continue;
    if (record.type === "llm.request") {
      const timeMs = epochMilliseconds(record.time);
      pending = Number.isFinite(timeMs)
        ? { timeMs, model: sanitizeText(record.modelAlias, 160) || sanitizeText(record.model, 160) || "unknown" }
        : undefined;
      continue;
    }
    if (record.type !== "usage.record" || !pending || !isRecord(record.usage)) continue;
    const endMs = epochMilliseconds(record.time);
    const latencyMs = endMs - pending.timeMs;
    const outputTokens = finiteNonNegative(Number(record.usage.output));
    if (!Number.isFinite(latencyMs) || latencyMs <= MIN_LATENCY_MS || outputTokens <= 0) {
      pending = undefined;
      continue;
    }
    samples.push({
      engine: "kimi",
      model: sanitizeText(record.model, 160) || pending.model,
      latencyMs,
      outputTokens,
      missTokens: finiteNonNegative(Number(record.usage.inputOther)),
      followedByTool: false,
      requestCount: 1,
      observedAt: new Date(endMs).toISOString(),
    });
    pending = undefined;
  }
  return samples;
}

export function extractGrokSpeedSamplesFromText(text) {
  const samples = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const record = parseJsonRecord(rawLine);
    if (!record || !isRecord(record.params) || !isRecord(record.params.update)) continue;
    const usage = record.params.update.usage;
    if (!isRecord(usage)) continue;
    const observedAt = grokObservedAt(record);
    if (!observedAt) continue;
    const modelUsage = isRecord(usage.modelUsage) ? usage.modelUsage : undefined;
    if (modelUsage) {
      for (const [model, modelValue] of Object.entries(modelUsage)) {
        if (!isRecord(modelValue)) continue;
        const sample = grokUsageToSample(model, modelValue, observedAt);
        if (sample) samples.push(sample);
      }
      continue;
    }
    const model = sanitizeText(record.params.update.model, 160) || sanitizeText(record.params.update.modelId, 160);
    const sample = grokUsageToSample(model || "grok", usage, observedAt);
    if (sample) samples.push(sample);
  }
  return samples;
}

function grokUsageToSample(model, usage, observedAt) {
  const latencyMs = finiteNonNegative(Number(usage.apiDurationMs));
  const outputTokens = finiteNonNegative(Number(usage.outputTokens));
  const requestCount = Math.max(1, Math.trunc(finiteNonNegative(Number(usage.modelCalls))));
  if (latencyMs <= MIN_LATENCY_MS || outputTokens <= 0) return undefined;
  const inputTokens = finiteNonNegative(Number(usage.inputTokens));
  const cachedTokens = finiteNonNegative(Number(usage.cachedReadTokens));
  return {
    engine: "grok",
    model: sanitizeText(model, 160) || "grok",
    latencyMs,
    outputTokens,
    missTokens: Math.max(0, inputTokens - cachedTokens),
    followedByTool: false,
    requestCount,
    observedAt,
  };
}

function grokObservedAt(record) {
  const params = isRecord(record.params) ? record.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const timeMs = epochMilliseconds(meta.agentTimestampMs ?? record.timestamp);
  return Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : "";
}

function extractRequestSamples(session, events) {
  const samples = [];
  let previousUsageIndex = -1;
  for (let usageIndex = 0; usageIndex < events.length; usageIndex += 1) {
    const usageEntry = events[usageIndex];
    if (usageEntry.event.kind !== "token_usage") continue;
    const codexToolFrame = session.engine === "codex"
      ? findCodexCompletedToolFrame(events, usageIndex, previousUsageIndex)
      : null;
    const requestEndIndex = codexToolFrame?.endIndex ?? usageIndex;
    const anchorSearchIndex = codexToolFrame?.startIndex ?? usageIndex;
    const anchorIndex = findRequestAnchor(events, anchorSearchIndex, previousUsageIndex);
    previousUsageIndex = usageIndex;
    if (anchorIndex < 0) continue;
    const endIndex = session.engine === "claude" ? findClaudeResponseEnd(events, usageIndex) : requestEndIndex;
    const latencyMs = events[endIndex].timeMs - events[anchorIndex].timeMs;
    if (!Number.isFinite(latencyMs) || latencyMs <= MIN_LATENCY_MS) continue;
    const responseEvents = events.slice(anchorIndex + 1, endIndex + 1);
    if (responseEvents.some(({ event }) => event.kind === "compaction")) continue;
    const outputTokens = finiteNonNegative(usageEntry.event.usage?.output);
    if (outputTokens <= 0) continue;
    const inputTokens = finiteNonNegative(usageEntry.event.usage?.input);
    const cachedTokens = finiteNonNegative(usageEntry.event.usage?.cached);
    const model = String(usageEntry.event.model || session.model || "unknown").trim() || "unknown";
    samples.push({
      engine: session.engine,
      model,
      latencyMs,
      outputTokens,
      missTokens: Math.max(0, inputTokens - cachedTokens),
      followedByTool: responseEvents.some(({ event }) => event.kind === "tool_call"),
      observedAt: events[endIndex].event.ts,
    });
  }
  return samples;
}

function findCodexCompletedToolFrame(events, usageIndex, previousUsageIndex) {
  const results = new Set();
  for (let index = previousUsageIndex + 1; index < usageIndex; index += 1) {
    const event = events[index].event;
    if (event.kind === "tool_result" && event.callId) results.add(event.callId);
  }
  if (!results.size) return null;
  const matchedCalls = [];
  for (let index = previousUsageIndex + 1; index < usageIndex; index += 1) {
    const event = events[index].event;
    if (event.kind === "tool_call" && event.callId && results.has(event.callId)) matchedCalls.push(index);
  }
  if (!matchedCalls.length) return null;
  return { startIndex: matchedCalls[0], endIndex: matchedCalls.at(-1) ?? matchedCalls[0] };
}

function findRequestAnchor(events, usageIndex, previousUsageIndex) {
  for (let index = usageIndex - 1; index >= 0; index -= 1) {
    const event = events[index].event;
    if (event.kind === "tool_result" || isRealUserMessage(event)) return index;
    if (index === previousUsageIndex) return index;
  }
  return previousUsageIndex;
}

function findClaudeResponseEnd(events, usageIndex) {
  let endIndex = usageIndex;
  for (let index = usageIndex + 1; index < events.length; index += 1) {
    const event = events[index].event;
    if (event.kind === "token_usage" || event.kind === "tool_result" || isRealUserMessage(event)) break;
    endIndex = index;
  }
  return endIndex;
}

function extractTurnSamples(session, events) {
  const userIndexes = events
    .map(({ event }, index) => (isRealUserMessage(event) ? index : -1))
    .filter((index) => index >= 0);
  const samples = [];
  for (let turnIndex = 0; turnIndex < userIndexes.length - 1; turnIndex += 1) {
    const startIndex = userIndexes[turnIndex];
    const nextStartIndex = userIndexes[turnIndex + 1];
    const segment = events.slice(startIndex + 1, nextStartIndex);
    if (segment.some(({ event }) => event.kind === "compaction")) continue;
    const endEntry = [...segment].reverse().find(({ event }) => isTurnActivity(event));
    if (!endEntry) continue;
    const startMs = events[startIndex].timeMs;
    const endMs = endEntry.timeMs;
    const wallMs = endMs - startMs;
    if (!Number.isFinite(wallMs) || wallMs <= 0) continue;
    const toolMs = Math.min(wallMs, unionDuration(pairedToolIntervals(segment, startMs, endMs)));
    samples.push({
      engine: session.engine,
      wallMs,
      toolMs,
      nonToolMs: Math.max(0, wallMs - toolMs),
      observedAt: events[startIndex].event.ts,
    });
  }
  return samples;
}

function pairedToolIntervals(segment, startMs, endMs) {
  const pending = new Map();
  const intervals = [];
  for (const entry of segment) {
    if (entry.event.kind === "tool_call" && entry.event.callId) {
      pending.set(entry.event.callId, entry.timeMs);
      continue;
    }
    if (entry.event.kind !== "tool_result" || !entry.event.callId) continue;
    const callStart = pending.get(entry.event.callId);
    if (callStart === undefined) continue;
    pending.delete(entry.event.callId);
    const clippedStart = Math.max(startMs, callStart);
    const clippedEnd = Math.min(endMs, entry.timeMs);
    if (clippedEnd >= clippedStart) intervals.push([clippedStart, clippedEnd]);
  }
  return intervals;
}

function unionDuration(intervals) {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let [currentStart, currentEnd] = sorted[0];
  for (const [start, end] of sorted.slice(1)) {
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return total + currentEnd - currentStart;
}

function summarizeModelSpeed(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.engine}\u0000${sample.model}`;
    const group = groups.get(key) || [];
    group.push(sample);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(summarizeOneModel)
    .sort((left, right) => left.engine.localeCompare(right.engine) || left.model.localeCompare(right.model));
}

function summarizeOneModel(samples) {
  const { engine, model } = samples[0];
  const outputValues = samples.map((sample) => sample.outputTokens);
  const outputSpreadRatio = percentile(outputValues, 0.9) / Math.max(1, percentile(outputValues, 0.1));
  const base = { engine, model, sampleCount: samples.length, outputSpreadRatio };
  if (samples.length < MIN_MODEL_SAMPLES) {
    return { ...base, available: false, unavailableReason: "too_few_samples" };
  }
  if (outputSpreadRatio < MIN_OUTPUT_SPREAD_RATIO) {
    return { ...base, available: false, unavailableReason: "output_range_too_narrow" };
  }
  const missValues = samples.map((sample) => sample.missTokens);
  const hasMissVariation = percentile(missValues, 0.9) > percentile(missValues, 0.1);
  const hasToolVariation = samples.some((sample) => sample.followedByTool) && samples.some((sample) => !sample.followedByTool);
  const rows = samples.map((sample) => {
    const row = [Math.max(1, sample.requestCount ?? 1), sample.outputTokens / 1_000];
    if (hasMissVariation) row.push(sample.missTokens / 10_000);
    if (hasToolVariation) row.push(sample.followedByTool ? 1 : 0);
    return row;
  });
  const values = samples.map((sample) => sample.latencyMs / 1_000);
  const fit = huberRegression(rows, values);
  const outputSecondsPerThousand = fit?.coefficients[1];
  const fixedOverheadSeconds = fit?.coefficients[0];
  if (
    !fit || !Number.isFinite(outputSecondsPerThousand) || !Number.isFinite(fixedOverheadSeconds) ||
    outputSecondsPerThousand <= 0 || fixedOverheadSeconds <= 0
  ) {
    return { ...base, available: false, unavailableReason: "unstable_regression" };
  }
  const ratios = values
    .map((actual, index) => actual / fit.predictions[index])
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0);
  if (ratios.length < MIN_MODEL_SAMPLES) {
    return { ...base, available: false, unavailableReason: "unstable_regression" };
  }
  const confidence = samples.length >= 100 && fit.rSquared >= 0.5
    ? "high"
    : samples.length >= 50 && fit.rSquared >= 0.25 ? "medium" : "low";
  return {
    ...base,
    available: true,
    decodeTokensPerSecond: 1_000 / outputSecondsPerThousand,
    fixedOverheadSeconds,
    jitterP90: percentile(ratios, 0.9),
    jitterP99: percentile(ratios, 0.99),
    rSquared: fit.rSquared,
    confidence,
  };
}

function summarizeTimeComposition(samples) {
  const groups = new Map([["all", samples]]);
  for (const sample of samples) {
    const group = groups.get(sample.engine) || [];
    group.push(sample);
    groups.set(sample.engine, group);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 0).map(([engine, group]) => {
    const wallMs = group.reduce((sum, sample) => sum + sample.wallMs, 0);
    const toolMs = group.reduce((sum, sample) => sum + sample.toolMs, 0);
    const nonToolMs = group.reduce((sum, sample) => sum + sample.nonToolMs, 0);
    return {
      engine,
      turnCount: group.length,
      wallMs,
      toolMs,
      nonToolMs,
      toolPercent: wallMs > 0 ? toolMs / wallMs * 100 : 0,
      nonToolPercent: wallMs > 0 ? nonToolMs / wallMs * 100 : 0,
    };
  });
}

function huberRegression(rows, values) {
  if (!rows.length || rows.length !== values.length) return null;
  let weights = Array.from({ length: rows.length }, () => 1);
  let coefficients = weightedLeastSquares(rows, values, weights);
  if (!coefficients) return null;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const residuals = values.map((value, index) => value - dot(rows[index], coefficients));
    const residualMedian = percentile(residuals, 0.5);
    const mad = percentile(residuals.map((value) => Math.abs(value - residualMedian)), 0.5);
    const threshold = 1.345 * Math.max(1e-6, mad * 1.4826);
    weights = residuals.map((residual) => Math.abs(residual) <= threshold ? 1 : threshold / Math.abs(residual));
    const next = weightedLeastSquares(rows, values, weights);
    if (!next) return null;
    const delta = Math.max(...next.map((value, index) => Math.abs(value - coefficients[index])));
    coefficients = next;
    if (delta < 1e-7) break;
  }
  const predictions = rows.map((row) => dot(row, coefficients));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const residual = values.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  return { coefficients, predictions, rSquared: total > 0 ? 1 - residual / total : 1 };
}

function weightedLeastSquares(rows, values, weights) {
  const width = rows[0]?.length || 0;
  if (!width || rows.some((row) => row.length !== width)) return null;
  const matrix = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const vector = Array.from({ length: width }, () => 0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const weight = weights[rowIndex];
    for (let left = 0; left < width; left += 1) {
      vector[left] += weight * row[left] * values[rowIndex];
      for (let right = 0; right < width; right += 1) matrix[left][right] += weight * row[left] * row[right];
    }
  }
  for (let index = 1; index < width; index += 1) matrix[index][index] += 1e-9;
  return solveLinearSystem(matrix, vector);
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-12) return null;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[size]);
}

function timedEvents(events) {
  return events
    .map((event, index) => ({ event, index, timeMs: Date.parse(event.ts) }))
    .filter((entry) => Number.isFinite(entry.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs || left.index - right.index);
}

function isRealUserMessage(event) {
  return event.kind === "message" && event.role === "user" && !event.internal && !event.isMeta && !event.isSidechain;
}

function isTurnActivity(event) {
  return event.kind === "token_usage" || event.kind === "tool_call" || event.kind === "tool_result" ||
    event.kind === "web_search" || event.kind === "reasoning" || (event.kind === "message" && event.role === "assistant");
}

function finiteNonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function parseJsonRecord(value) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function epochMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
}

function groupSamplesByDay(samples, offsetMinutes) {
  const groups = new Map();
  for (const sample of samples) {
    const day = dayKeyAtOffset(sample.observedAt, offsetMinutes);
    if (!day) continue;
    const group = groups.get(day) || [];
    group.push(sample);
    groups.set(day, group);
  }
  return groups;
}

function dayKeyAtOffset(value, offsetMinutes) {
  const timeMs = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timeMs)) return "";
  const shifted = new Date(timeMs + offsetMinutes * 60 * 1_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
