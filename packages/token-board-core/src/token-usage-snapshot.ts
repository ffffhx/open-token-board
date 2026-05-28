import fs from "node:fs";
import path from "node:path";

import type { TokenUsageEvent } from "./token-leaderboard";

export type TokenUsagePeriodKey = "today" | "week" | "month";

export type TokenUsagePeriod = {
  startAt: string;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  events: number;
  estimatedCostUsd: number;
  estimatedCost: {
    inputUsd: number;
    cachedInputUsd: number;
    outputUsd: number;
    unpricedTokens: number;
  };
  models: Record<
    string,
    {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
      events: number;
    }
  >;
};

export type TokenUsageSnapshot = {
  schemaVersion: number;
  updatedAt: string;
  timezone: string;
  source: string;
  filesScanned: number;
  pricing?: {
    currency: string;
    basis: string;
    note: string;
    pricesPerMillionTokens: Record<
      string,
      {
        input: number;
        cachedInput: number;
        output: number;
      }
    >;
  };
  periods: Record<TokenUsagePeriodKey, TokenUsagePeriod>;
};

const EMPTY_PERIOD: TokenUsagePeriod = {
  startAt: new Date(0).toISOString(),
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  events: 0,
  estimatedCostUsd: 0,
  estimatedCost: {
    inputUsd: 0,
    cachedInputUsd: 0,
    outputUsd: 0,
    unpricedTokens: 0,
  },
  models: {},
};

export const EMPTY_TOKEN_USAGE_SNAPSHOT: TokenUsageSnapshot = {
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  timezone: "Asia/Shanghai",
  source: "empty",
  filesScanned: 0,
  periods: {
    today: EMPTY_PERIOD,
    week: EMPTY_PERIOD,
    month: EMPTY_PERIOD,
  },
};

const TIMEZONE = "Asia/Shanghai";
const TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getTokenUsageSnapshot() {
  const filePath = path.join(process.cwd(), "public", "stats", "token-usage.json");

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return normalizeTokenUsageSnapshot(JSON.parse(content));
  } catch {
    return EMPTY_TOKEN_USAGE_SNAPSHOT;
  }
}

export function buildTokenUsageSnapshotFromEvents(
  entries: TokenUsageEvent[],
  {
    now = new Date(),
    source = "token-board-server",
  }: {
    now?: Date;
    source?: string;
  } = {}
): TokenUsageSnapshot {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const starts = getPeriodStarts(safeNow);
  const periods: Record<TokenUsagePeriodKey, TokenUsagePeriod> = {
    today: createPeriod(starts.today),
    week: createPeriod(starts.week),
    month: createPeriod(starts.month),
  };
  const oldestStart = starts.month.getTime();
  const nowWithSkew = safeNow.getTime() + 5 * 60 * 1000;

  for (const entry of entries) {
    const time = new Date(entry.timestamp).getTime();

    if (!Number.isFinite(time) || time < oldestStart || time > nowWithSkew) {
      continue;
    }

    if (time >= starts.today.getTime()) {
      addEventToPeriod(periods.today, entry);
    }

    if (time >= starts.week.getTime()) {
      addEventToPeriod(periods.week, entry);
    }

    addEventToPeriod(periods.month, entry);
  }

  return {
    schemaVersion: 1,
    updatedAt: safeNow.toISOString(),
    timezone: TIMEZONE,
    source,
    filesScanned: entries.length,
    pricing: {
      currency: "USD",
      basis: "estimated-api-equivalent",
      note: "Estimated from token-board agent events and public model rates. This is not an invoice.",
      pricesPerMillionTokens: {},
    },
    periods: {
      today: finalizePeriod(periods.today),
      week: finalizePeriod(periods.week),
      month: finalizePeriod(periods.month),
    },
  };
}

export function normalizeTokenUsageSnapshot(value: unknown): TokenUsageSnapshot {
  if (!value || typeof value !== "object") {
    return EMPTY_TOKEN_USAGE_SNAPSHOT;
  }

  const snapshot = value as Partial<TokenUsageSnapshot>;
  const schemaVersion = toFiniteNumber(snapshot.schemaVersion);

  return {
    schemaVersion: schemaVersion > 0 ? schemaVersion : 1,
    updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : new Date(0).toISOString(),
    timezone: typeof snapshot.timezone === "string" ? snapshot.timezone : "Asia/Shanghai",
    source: typeof snapshot.source === "string" ? snapshot.source : "unknown",
    filesScanned: toFiniteNumber(snapshot.filesScanned),
    pricing: normalizePricing(snapshot.pricing),
    periods: {
      today: normalizePeriod(snapshot.periods?.today),
      week: normalizePeriod(snapshot.periods?.week),
      month: normalizePeriod(snapshot.periods?.month),
    },
  };
}

function getShanghaiParts(date: Date) {
  const shifted = new Date(date.getTime() + TIMEZONE_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function fromShanghaiStartOfDay({
  year,
  month,
  date,
}: {
  year: number;
  month: number;
  date: number;
}) {
  return new Date(Date.UTC(year, month, date) - TIMEZONE_OFFSET_MS);
}

function getPeriodStarts(now: Date) {
  const parts = getShanghaiParts(now);
  const today = fromShanghaiStartOfDay(parts);
  const daysSinceMonday = (parts.day + 6) % 7;
  const week = new Date(today.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const month = fromShanghaiStartOfDay({ ...parts, date: 1 });

  return { today, week, month };
}

function createPeriod(startAt: Date): TokenUsagePeriod {
  return {
    ...EMPTY_PERIOD,
    startAt: startAt.toISOString(),
    estimatedCost: { ...EMPTY_PERIOD.estimatedCost },
    models: {},
  };
}

function addEventToPeriod(period: TokenUsagePeriod, entry: TokenUsageEvent) {
  period.totalTokens += entry.totalTokens;
  period.inputTokens += entry.inputTokens;
  period.cachedInputTokens += entry.cachedInputTokens;
  period.outputTokens += entry.outputTokens;
  period.reasoningOutputTokens += entry.reasoningOutputTokens;
  period.events += 1;
  period.estimatedCostUsd += entry.costUsd ?? 0;
  period.estimatedCost.unpricedTokens += entry.costUsd === undefined ? entry.inputTokens + entry.outputTokens : 0;

  const model = entry.model || "unknown";
  const modelUsage = period.models[model] ?? {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    events: 0,
  };

  modelUsage.inputTokens += entry.inputTokens;
  modelUsage.cachedInputTokens += entry.cachedInputTokens;
  modelUsage.outputTokens += entry.outputTokens;
  modelUsage.estimatedCostUsd += entry.costUsd ?? 0;
  modelUsage.events += 1;
  period.models[model] = modelUsage;
}

function finalizePeriod(period: TokenUsagePeriod): TokenUsagePeriod {
  return {
    ...period,
    estimatedCostUsd: roundUsd(period.estimatedCostUsd),
    estimatedCost: {
      inputUsd: roundUsd(period.estimatedCost.inputUsd),
      cachedInputUsd: roundUsd(period.estimatedCost.cachedInputUsd),
      outputUsd: roundUsd(period.estimatedCost.outputUsd),
      unpricedTokens: period.estimatedCost.unpricedTokens,
    },
    models: Object.fromEntries(
      Object.entries(period.models)
        .map(
          ([model, usage]) =>
            [
              model,
              {
                ...usage,
                estimatedCostUsd: roundUsd(usage.estimatedCostUsd),
              },
            ] as const
        )
        .sort(([, left], [, right]) => right.estimatedCostUsd - left.estimatedCostUsd)
    ),
  };
}

function roundUsd(value: number) {
  return Number(value.toFixed(4));
}

function normalizePeriod(value: unknown): TokenUsagePeriod {
  if (!value || typeof value !== "object") {
    return EMPTY_PERIOD;
  }

  const period = value as Partial<TokenUsagePeriod>;

  return {
    startAt: typeof period.startAt === "string" ? period.startAt : new Date(0).toISOString(),
    totalTokens: toFiniteNumber(period.totalTokens),
    inputTokens: toFiniteNumber(period.inputTokens),
    cachedInputTokens: toFiniteNumber(period.cachedInputTokens),
    outputTokens: toFiniteNumber(period.outputTokens),
    reasoningOutputTokens: toFiniteNumber(period.reasoningOutputTokens),
    events: toFiniteNumber(period.events),
    estimatedCostUsd: toFiniteNumber(period.estimatedCostUsd),
    estimatedCost: normalizeEstimatedCost(period.estimatedCost),
    models: normalizeModels(period.models),
  };
}

function normalizeEstimatedCost(value: unknown): TokenUsagePeriod["estimatedCost"] {
  if (!value || typeof value !== "object") {
    return EMPTY_PERIOD.estimatedCost;
  }

  const cost = value as Partial<TokenUsagePeriod["estimatedCost"]>;

  return {
    inputUsd: toFiniteNumber(cost.inputUsd),
    cachedInputUsd: toFiniteNumber(cost.cachedInputUsd),
    outputUsd: toFiniteNumber(cost.outputUsd),
    unpricedTokens: toFiniteNumber(cost.unpricedTokens),
  };
}

function normalizeModels(value: unknown): TokenUsagePeriod["models"] {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([model, modelValue]) => {
      if (!modelValue || typeof modelValue !== "object") {
        return [
          model,
          {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            events: 0,
          },
        ];
      }

      const modelUsage = modelValue as Partial<TokenUsagePeriod["models"][string]>;

      return [
        model,
        {
          inputTokens: toFiniteNumber(modelUsage.inputTokens),
          cachedInputTokens: toFiniteNumber(modelUsage.cachedInputTokens),
          outputTokens: toFiniteNumber(modelUsage.outputTokens),
          estimatedCostUsd: toFiniteNumber(modelUsage.estimatedCostUsd),
          events: toFiniteNumber(modelUsage.events),
        },
      ];
    })
  );
}

function normalizePricing(value: unknown): TokenUsageSnapshot["pricing"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const pricing = value as Partial<NonNullable<TokenUsageSnapshot["pricing"]>>;

  return {
    currency: typeof pricing.currency === "string" ? pricing.currency : "USD",
    basis: typeof pricing.basis === "string" ? pricing.basis : "estimated-api-equivalent",
    note: typeof pricing.note === "string" ? pricing.note : "",
    pricesPerMillionTokens:
      pricing.pricesPerMillionTokens && typeof pricing.pricesPerMillionTokens === "object"
        ? pricing.pricesPerMillionTokens
        : {},
  };
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
