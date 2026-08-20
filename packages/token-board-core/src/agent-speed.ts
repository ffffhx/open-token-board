import type { Engine, NormalizedEvent, NormalizedSession } from "agent-session-core";

const MIN_LATENCY_MS = 300;
const MIN_MODEL_SAMPLES = 30;
const MIN_OUTPUT_SPREAD_RATIO = 3;

export type AgentSpeedRequestSample = {
  engine: Engine;
  model: string;
  latencyMs: number;
  outputTokens: number;
  missTokens: number;
  followedByTool: boolean;
  observedAt?: string;
};

export type AgentSpeedTurnSample = {
  engine: Engine;
  wallMs: number;
  toolMs: number;
  nonToolMs: number;
  observedAt?: string;
};

export type AgentModelSpeedSummary = {
  engine: Engine;
  model: string;
  sampleCount: number;
  outputSpreadRatio: number;
  available: boolean;
  unavailableReason?: "too_few_samples" | "output_range_too_narrow" | "unstable_regression";
  decodeTokensPerSecond?: number;
  fixedOverheadSeconds?: number;
  jitterP90?: number;
  jitterP99?: number;
  rSquared?: number;
  confidence?: "low" | "medium" | "high";
};

export type AgentTimeCompositionSummary = {
  engine: Engine | "all";
  turnCount: number;
  wallMs: number;
  toolMs: number;
  nonToolMs: number;
  toolPercent: number;
  nonToolPercent: number;
};

export type AgentSpeedAnalysis = {
  modelSpeed: AgentModelSpeedSummary[];
  timeComposition: AgentTimeCompositionSummary[];
  requestSampleCount: number;
  closedTurnCount: number;
};

export type AgentSpeedDailySnapshot = AgentSpeedAnalysis & {
  date: string;
  capturedAt: string;
};

export type AgentSpeedHistoryPayload = {
  schemaVersion: 1;
  generatedAt: string;
  snapshots: AgentSpeedDailySnapshot[];
};

type TimedEvent = {
  event: NormalizedEvent;
  index: number;
  timeMs: number;
};

type RegressionFit = {
  coefficients: number[];
  predictions: number[];
  rSquared: number;
};

/**
 * Analyze already-normalized sessions. This module deliberately performs no IO:
 * callers can stream sessions into the two sample arrays, while tests can feed
 * small synthetic sessions without touching a real CLI transcript.
 */
export function analyzeAgentSpeedSessions(sessions: NormalizedSession[]): AgentSpeedAnalysis {
  const requestSamples: AgentSpeedRequestSample[] = [];
  const turnSamples: AgentSpeedTurnSample[] = [];

  for (const session of sessions) {
    const samples = extractAgentSpeedSamples(session);
    requestSamples.push(...samples.requests);
    turnSamples.push(...samples.turns);
  }

  return analyzeAgentSpeedSamples(requestSamples, turnSamples);
}

export function analyzeAgentSpeedSamples(
  requestSamples: AgentSpeedRequestSample[],
  turnSamples: AgentSpeedTurnSample[]
): AgentSpeedAnalysis {
  return {
    modelSpeed: summarizeModelSpeed(requestSamples),
    timeComposition: summarizeTimeComposition(turnSamples),
    requestSampleCount: requestSamples.length,
    closedTurnCount: turnSamples.length,
  };
}

/**
 * Convert local request/turn observations into compact Shanghai-day aggregates.
 * Raw prompts, tool arguments, paths, and session identifiers never enter this
 * payload; it is safe to persist as a personal trend history.
 */
export function buildAgentSpeedDailySnapshots(
  requestSamples: AgentSpeedRequestSample[],
  turnSamples: AgentSpeedTurnSample[],
  options: { capturedAt?: Date; timeZoneOffsetMinutes?: number } = {}
): AgentSpeedDailySnapshot[] {
  const capturedAt = options.capturedAt ?? new Date();
  const offsetMinutes = Number.isFinite(options.timeZoneOffsetMinutes)
    ? Number(options.timeZoneOffsetMinutes)
    : 8 * 60;
  const requestsByDay = groupSamplesByDay(requestSamples, offsetMinutes);
  const turnsByDay = groupSamplesByDay(turnSamples, offsetMinutes);
  const dayKeys = [...new Set([...requestsByDay.keys(), ...turnsByDay.keys()])].sort();

  return dayKeys.map((date) => ({
    date,
    capturedAt: capturedAt.toISOString(),
    ...analyzeAgentSpeedSamples(requestsByDay.get(date) ?? [], turnsByDay.get(date) ?? []),
  }));
}

export function createAgentSpeedHistoryPayload(
  requestSamples: AgentSpeedRequestSample[],
  turnSamples: AgentSpeedTurnSample[],
  options: { capturedAt?: Date; timeZoneOffsetMinutes?: number } = {}
): AgentSpeedHistoryPayload {
  const generatedAt = (options.capturedAt ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    snapshots: buildAgentSpeedDailySnapshots(requestSamples, turnSamples, {
      ...options,
      capturedAt: new Date(generatedAt),
    }),
  };
}

export function sanitizeAgentSpeedDailySnapshots(value: unknown): {
  snapshots: AgentSpeedDailySnapshot[];
  errors: string[];
} {
  if (!Array.isArray(value)) {
    return { snapshots: [], errors: ["snapshots must be an array"] };
  }
  if (value.length > 120) {
    return { snapshots: [], errors: ["snapshots cannot contain more than 120 days"] };
  }

  const errors: string[] = [];
  const byDate = new Map<string, AgentSpeedDailySnapshot>();
  value.forEach((entry, index) => {
    const normalized = normalizeDailySnapshot(entry);
    if (!normalized) {
      errors.push(`snapshots[${index}] is invalid`);
      return;
    }
    byDate.set(normalized.date, normalized);
  });

  return {
    snapshots: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    errors,
  };
}

export function extractAgentSpeedSamples(session: NormalizedSession): {
  requests: AgentSpeedRequestSample[];
  turns: AgentSpeedTurnSample[];
} {
  const events = timedEvents(session.events);
  return {
    requests: extractRequestSamples(session, events),
    turns: extractTurnSamples(session, events),
  };
}

function extractRequestSamples(session: NormalizedSession, events: TimedEvent[]): AgentSpeedRequestSample[] {
  const samples: AgentSpeedRequestSample[] = [];
  let previousUsageIndex = -1;

  for (let usageIndex = 0; usageIndex < events.length; usageIndex += 1) {
    const usageEntry = events[usageIndex];
    if (usageEntry.event.kind !== "token_usage") {
      continue;
    }

    const codexToolFrame = session.engine === "codex"
      ? findCodexCompletedToolFrame(events, usageIndex, previousUsageIndex)
      : null;
    const requestEndIndex = codexToolFrame?.endIndex ?? usageIndex;
    const anchorSearchIndex = codexToolFrame?.startIndex ?? usageIndex;
    const anchorIndex = findRequestAnchor(events, anchorSearchIndex, previousUsageIndex);
    previousUsageIndex = usageIndex;
    if (anchorIndex < 0) {
      continue;
    }

    // Claude records usage near the first response block, while Codex records it
    // after the response. Extend only Claude to the last output block before the
    // next input/request boundary so the endpoint means "response finished" for
    // both engines as closely as the local transcripts allow.
    const endIndex = session.engine === "claude" ? findClaudeResponseEnd(events, usageIndex) : requestEndIndex;
    const startMs = events[anchorIndex].timeMs;
    const endMs = events[endIndex].timeMs;
    const latencyMs = endMs - startMs;
    if (!Number.isFinite(latencyMs) || latencyMs <= MIN_LATENCY_MS) {
      continue;
    }

    const responseEvents = events.slice(anchorIndex + 1, endIndex + 1);
    if (responseEvents.some(({ event }) => event.kind === "compaction")) {
      continue;
    }

    const outputTokens = finiteNonNegative(usageEntry.event.usage.output);
    if (outputTokens <= 0) {
      continue;
    }
    const inputTokens = finiteNonNegative(usageEntry.event.usage.input);
    const cachedTokens = finiteNonNegative(usageEntry.event.usage.cached);
    const model = (usageEntry.event.model || session.model || "unknown").trim() || "unknown";

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

// Newer Codex runtimes emit token_count only after a custom tool has finished:
// custom_tool_call -> custom_tool_call_output -> token_usage (same timestamp).
// In that shape the preceding tool_result is not the request start; it belongs
// to the request whose usage we are processing. Match the completed call and
// use the tool_call timestamp as the model-response endpoint instead.
function findCodexCompletedToolFrame(
  events: TimedEvent[],
  usageIndex: number,
  previousUsageIndex: number
): { startIndex: number; endIndex: number } | null {
  const results = new Set<string>();
  for (let index = previousUsageIndex + 1; index < usageIndex; index += 1) {
    const event = events[index].event;
    if (event.kind === "tool_result" && event.callId) {
      results.add(event.callId);
    }
  }
  if (!results.size) {
    return null;
  }

  const matchedCalls: number[] = [];
  for (let index = previousUsageIndex + 1; index < usageIndex; index += 1) {
    const event = events[index].event;
    if (event.kind === "tool_call" && event.callId && results.has(event.callId)) {
      matchedCalls.push(index);
    }
  }
  if (!matchedCalls.length) {
    return null;
  }
  return { startIndex: matchedCalls[0], endIndex: matchedCalls.at(-1) ?? matchedCalls[0] };
}

function findRequestAnchor(events: TimedEvent[], usageIndex: number, previousUsageIndex: number) {
  for (let index = usageIndex - 1; index >= 0; index -= 1) {
    const event = events[index].event;
    if (event.kind === "tool_result" || isRealUserMessage(event)) {
      return index;
    }
    if (index === previousUsageIndex) {
      return index;
    }
  }
  return previousUsageIndex;
}

function findClaudeResponseEnd(events: TimedEvent[], usageIndex: number) {
  let endIndex = usageIndex;
  for (let index = usageIndex + 1; index < events.length; index += 1) {
    const event = events[index].event;
    if (event.kind === "token_usage" || event.kind === "tool_result" || isRealUserMessage(event)) {
      break;
    }
    endIndex = index;
  }
  return endIndex;
}

function extractTurnSamples(session: NormalizedSession, events: TimedEvent[]): AgentSpeedTurnSample[] {
  const userIndexes = events
    .map(({ event }, index) => (isRealUserMessage(event) ? index : -1))
    .filter((index) => index >= 0);
  const samples: AgentSpeedTurnSample[] = [];

  // Only a later real user message proves that the previous turn was closed.
  // The final transcript tail may still be running, so it is intentionally not
  // guessed from file mtime or the current clock.
  for (let turnIndex = 0; turnIndex < userIndexes.length - 1; turnIndex += 1) {
    const startIndex = userIndexes[turnIndex];
    const nextStartIndex = userIndexes[turnIndex + 1];
    const segment = events.slice(startIndex + 1, nextStartIndex);
    if (segment.some(({ event }) => event.kind === "compaction")) {
      continue;
    }

    const endEntry = [...segment].reverse().find(({ event }) => isTurnActivity(event));
    if (!endEntry) {
      continue;
    }

    const startMs = events[startIndex].timeMs;
    const endMs = endEntry.timeMs;
    const wallMs = endMs - startMs;
    if (!Number.isFinite(wallMs) || wallMs <= 0) {
      continue;
    }

    const toolIntervals = pairedToolIntervals(segment, startMs, endMs);
    const toolMs = Math.min(wallMs, unionDuration(toolIntervals));
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

function pairedToolIntervals(segment: TimedEvent[], startMs: number, endMs: number): Array<[number, number]> {
  const pending = new Map<string, number>();
  const intervals: Array<[number, number]> = [];

  for (const entry of segment) {
    if (entry.event.kind === "tool_call" && entry.event.callId) {
      pending.set(entry.event.callId, entry.timeMs);
      continue;
    }
    if (entry.event.kind !== "tool_result" || !entry.event.callId) {
      continue;
    }
    const callStart = pending.get(entry.event.callId);
    if (callStart === undefined) {
      continue;
    }
    pending.delete(entry.event.callId);
    const clippedStart = Math.max(startMs, callStart);
    const clippedEnd = Math.min(endMs, entry.timeMs);
    if (clippedEnd >= clippedStart) {
      intervals.push([clippedStart, clippedEnd]);
    }
  }

  return intervals;
}

function unionDuration(intervals: Array<[number, number]>) {
  if (!intervals.length) {
    return 0;
  }
  const sorted = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let [currentStart, currentEnd] = sorted[0];

  for (const [start, end] of sorted.slice(1)) {
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = start;
    currentEnd = end;
  }
  return total + currentEnd - currentStart;
}

function summarizeModelSpeed(samples: AgentSpeedRequestSample[]): AgentModelSpeedSummary[] {
  const groups = new Map<string, AgentSpeedRequestSample[]>();
  for (const sample of samples) {
    const key = `${sample.engine}\u0000${sample.model}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(summarizeOneModel)
    .sort((left, right) => left.engine.localeCompare(right.engine) || left.model.localeCompare(right.model));
}

function summarizeOneModel(samples: AgentSpeedRequestSample[]): AgentModelSpeedSummary {
  const { engine, model } = samples[0];
  const outputValues = samples.map((sample) => sample.outputTokens);
  const p10 = percentile(outputValues, 0.1);
  const p90 = percentile(outputValues, 0.9);
  const outputSpreadRatio = p90 / Math.max(1, p10);
  const base = { engine, model, sampleCount: samples.length, outputSpreadRatio };

  if (samples.length < MIN_MODEL_SAMPLES) {
    return { ...base, available: false, unavailableReason: "too_few_samples" };
  }
  if (outputSpreadRatio < MIN_OUTPUT_SPREAD_RATIO) {
    return { ...base, available: false, unavailableReason: "output_range_too_narrow" };
  }

  const hasMissVariation = percentile(samples.map((sample) => sample.missTokens), 0.9) >
    percentile(samples.map((sample) => sample.missTokens), 0.1);
  const hasToolVariation = samples.some((sample) => sample.followedByTool) &&
    samples.some((sample) => !sample.followedByTool);
  const rows = samples.map((sample) => {
    const row = [1, sample.outputTokens / 1_000];
    if (hasMissVariation) row.push(sample.missTokens / 10_000);
    if (hasToolVariation) row.push(sample.followedByTool ? 1 : 0);
    return row;
  });
  const values = samples.map((sample) => sample.latencyMs / 1_000);
  const fit = huberRegression(rows, values);
  const outputSecondsPerThousand = fit?.coefficients[1];
  const fixedOverheadSeconds = fit?.coefficients[0];

  if (
    !fit ||
    typeof outputSecondsPerThousand !== "number" ||
    typeof fixedOverheadSeconds !== "number" ||
    !Number.isFinite(outputSecondsPerThousand) ||
    !Number.isFinite(fixedOverheadSeconds) ||
    outputSecondsPerThousand <= 0 ||
    fixedOverheadSeconds <= 0
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
    : samples.length >= 50 && fit.rSquared >= 0.25
      ? "medium"
      : "low";

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

function summarizeTimeComposition(samples: AgentSpeedTurnSample[]): AgentTimeCompositionSummary[] {
  const groups = new Map<Engine | "all", AgentSpeedTurnSample[]>();
  groups.set("all", samples);
  for (const sample of samples) {
    const group = groups.get(sample.engine) ?? [];
    group.push(sample);
    groups.set(sample.engine, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 0)
    .map(([engine, group]) => {
      const wallMs = group.reduce((sum, sample) => sum + sample.wallMs, 0);
      const toolMs = group.reduce((sum, sample) => sum + sample.toolMs, 0);
      const nonToolMs = group.reduce((sum, sample) => sum + sample.nonToolMs, 0);
      return {
        engine,
        turnCount: group.length,
        wallMs,
        toolMs,
        nonToolMs,
        toolPercent: wallMs > 0 ? (toolMs / wallMs) * 100 : 0,
        nonToolPercent: wallMs > 0 ? (nonToolMs / wallMs) * 100 : 0,
      };
    });
}

function huberRegression(rows: number[][], values: number[]): RegressionFit | null {
  if (!rows.length || rows.length !== values.length) {
    return null;
  }

  let weights = Array.from({ length: rows.length }, () => 1);
  let coefficients = weightedLeastSquares(rows, values, weights);
  if (!coefficients) {
    return null;
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const residuals = values.map((value, index) => value - dot(rows[index], coefficients!));
    const residualMedian = percentile(residuals, 0.5);
    const mad = percentile(residuals.map((value) => Math.abs(value - residualMedian)), 0.5);
    const scale = Math.max(1e-6, mad * 1.4826);
    const threshold = 1.345 * scale;
    weights = residuals.map((residual) => {
      const distance = Math.abs(residual);
      return distance <= threshold ? 1 : threshold / distance;
    });
    const next = weightedLeastSquares(rows, values, weights);
    if (!next) {
      return null;
    }
    const delta = Math.max(...next.map((value, index) => Math.abs(value - coefficients![index])));
    coefficients = next;
    if (delta < 1e-7) {
      break;
    }
  }

  const predictions = rows.map((row) => dot(row, coefficients!));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const residual = values.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  return {
    coefficients,
    predictions,
    rSquared: total > 0 ? 1 - residual / total : 1,
  };
}

function weightedLeastSquares(rows: number[][], values: number[], weights: number[]) {
  const width = rows[0]?.length ?? 0;
  if (!width || rows.some((row) => row.length !== width)) {
    return null;
  }
  const matrix = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const vector = Array.from({ length: width }, () => 0);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const weight = weights[rowIndex];
    for (let left = 0; left < width; left += 1) {
      vector[left] += weight * row[left] * values[rowIndex];
      for (let right = 0; right < width; right += 1) {
        matrix[left][right] += weight * row[left] * row[right];
      }
    }
  }

  // Tiny ridge on non-intercept features only. It stabilizes nearly-collinear
  // output/miss-token columns without biasing the fixed-overhead estimate.
  for (let index = 1; index < width; index += 1) {
    matrix[index][index] += 1e-9;
  }
  return solveLinearSystem(matrix, vector);
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) {
        best = row;
      }
    }
    if (Math.abs(augmented[best][pivot]) < 1e-12) {
      return null;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];

    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function timedEvents(events: NormalizedEvent[]) {
  return events
    .map((event, index) => ({ event, index, timeMs: Date.parse(event.ts) }))
    .filter((entry) => Number.isFinite(entry.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs || left.index - right.index);
}

function isRealUserMessage(event: NormalizedEvent) {
  return event.kind === "message" &&
    event.role === "user" &&
    event.internal !== true &&
    event.isMeta !== true &&
    event.isSidechain !== true;
}

function isTurnActivity(event: NormalizedEvent) {
  return event.kind === "token_usage" ||
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "web_search" ||
    event.kind === "reasoning" ||
    (event.kind === "message" && event.role === "assistant");
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function groupSamplesByDay<T extends { observedAt?: string }>(samples: T[], offsetMinutes: number) {
  const groups = new Map<string, T[]>();
  for (const sample of samples) {
    const day = dayKeyAtOffset(sample.observedAt, offsetMinutes);
    if (!day) continue;
    const group = groups.get(day) ?? [];
    group.push(sample);
    groups.set(day, group);
  }
  return groups;
}

function dayKeyAtOffset(value: string | undefined, offsetMinutes: number) {
  const timeMs = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timeMs)) return "";
  const shifted = new Date(timeMs + offsetMinutes * 60 * 1_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function normalizeDailySnapshot(value: unknown): AgentSpeedDailySnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const date = typeof value.date === "string" && isDayKey(value.date) ? value.date : "";
  const capturedAt = normalizeIsoDate(value.capturedAt);
  const requestSampleCount = safeInteger(value.requestSampleCount, 10_000_000);
  const closedTurnCount = safeInteger(value.closedTurnCount, 10_000_000);
  if (!date || !capturedAt || requestSampleCount === undefined || closedTurnCount === undefined) return undefined;
  if (!Array.isArray(value.modelSpeed) || value.modelSpeed.length > 100) return undefined;
  if (!Array.isArray(value.timeComposition) || value.timeComposition.length > 3) return undefined;

  const modelSpeed = value.modelSpeed.flatMap((entry) => normalizeModelSpeed(entry) ?? []);
  const timeComposition = value.timeComposition.flatMap((entry) => normalizeTimeComposition(entry) ?? []);
  if (modelSpeed.length !== value.modelSpeed.length || timeComposition.length !== value.timeComposition.length) {
    return undefined;
  }
  return { date, capturedAt, requestSampleCount, closedTurnCount, modelSpeed, timeComposition };
}

function normalizeModelSpeed(value: unknown): AgentModelSpeedSummary | undefined {
  if (!isRecord(value)) return undefined;
  const engine = normalizeEngine(value.engine);
  const model = sanitizeText(value.model, 160);
  const sampleCount = safeInteger(value.sampleCount, 10_000_000);
  const outputSpreadRatio = safeNumber(value.outputSpreadRatio, 0, 1_000_000_000);
  if (!engine || !model || sampleCount === undefined || outputSpreadRatio === undefined || typeof value.available !== "boolean") {
    return undefined;
  }
  const base = { engine, model, sampleCount, outputSpreadRatio, available: value.available };
  if (!value.available) {
    const unavailableReason = value.unavailableReason;
    if (
      unavailableReason !== "too_few_samples" &&
      unavailableReason !== "output_range_too_narrow" &&
      unavailableReason !== "unstable_regression"
    ) return undefined;
    return { ...base, available: false, unavailableReason };
  }

  const decodeTokensPerSecond = safeNumber(value.decodeTokensPerSecond, Number.EPSILON, 1_000_000);
  const fixedOverheadSeconds = safeNumber(value.fixedOverheadSeconds, Number.EPSILON, 86_400);
  const jitterP90 = safeNumber(value.jitterP90, Number.EPSILON, 10_000);
  const jitterP99 = safeNumber(value.jitterP99, Number.EPSILON, 10_000);
  const rSquared = safeNumber(value.rSquared, -10_000, 1);
  const confidence = value.confidence;
  if (
    decodeTokensPerSecond === undefined ||
    fixedOverheadSeconds === undefined ||
    jitterP90 === undefined ||
    jitterP99 === undefined ||
    rSquared === undefined ||
    (confidence !== "low" && confidence !== "medium" && confidence !== "high")
  ) return undefined;
  return {
    ...base,
    available: true,
    decodeTokensPerSecond,
    fixedOverheadSeconds,
    jitterP90,
    jitterP99,
    rSquared,
    confidence,
  };
}

function normalizeTimeComposition(value: unknown): AgentTimeCompositionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const engine = value.engine === "all" ? "all" : normalizeEngine(value.engine);
  const turnCount = safeInteger(value.turnCount, 10_000_000);
  const wallMs = safeNumber(value.wallMs, 0, 1_000_000_000_000);
  const toolMs = safeNumber(value.toolMs, 0, 1_000_000_000_000);
  const nonToolMs = safeNumber(value.nonToolMs, 0, 1_000_000_000_000);
  if (!engine || turnCount === undefined || wallMs === undefined || toolMs === undefined || nonToolMs === undefined) {
    return undefined;
  }
  if (toolMs > wallMs || nonToolMs > wallMs || Math.abs(toolMs + nonToolMs - wallMs) > 1) return undefined;
  return {
    engine,
    turnCount,
    wallMs,
    toolMs,
    nonToolMs,
    toolPercent: wallMs > 0 ? toolMs / wallMs * 100 : 0,
    nonToolPercent: wallMs > 0 ? nonToolMs / wallMs * 100 : 0,
  };
}

function normalizeEngine(value: unknown): Engine | undefined {
  return value === "codex" || value === "claude" ? value : undefined;
}

function safeInteger(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= max ? numeric : undefined;
}

function safeNumber(value: unknown, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : undefined;
}

function normalizeIsoDate(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isDayKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function percentile(values: number[], quantile: number) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function dot(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
