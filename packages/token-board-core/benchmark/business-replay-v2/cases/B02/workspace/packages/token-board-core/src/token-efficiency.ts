import type { TokenUsageEvent } from "./token-leaderboard";

export const TOKEN_EFFICIENCY_MIN_TOOL_CALLS = 50;
export const TOKEN_EFFICIENCY_STABLE_TOOL_CALLS = 100;
export const TOKEN_EFFICIENCY_MIN_INTERRUPTION_SESSIONS = 10;
export const TOKEN_EFFICIENCY_MIN_TOKEN_SESSIONS = 1;

export type TokenEfficiencyMetricStatus = "ready" | "insufficient" | "no_data";
export type TokenEfficiencyComparison = "higher" | "lower" | "same";

export type TokenEfficiencyMetric = {
  comparison: TokenEfficiencyComparison | null;
  denominator: number;
  minimumDenominator: number;
  numerator: number;
  status: TokenEfficiencyMetricStatus;
  teamMedian: number | null;
  value: number | null;
};

export type TokenEfficiencyProfile = {
  errorRate: TokenEfficiencyMetric;
  interruptionRate: TokenEfficiencyMetric;
  tokensPerSession: TokenEfficiencyMetric;
};

export type TokenEfficiencyTeamSummary = {
  errorRateMedian: number | null;
  interruptionRateMedian: number | null;
  qualifiedUsers: {
    errorRate: number;
    interruptionRate: number;
    tokensPerSession: number;
  };
  tokensPerSessionMedian: number | null;
};

export type TokenEfficiencySummary = {
  team: TokenEfficiencyTeamSummary;
  users: Map<string, TokenEfficiencyProfile>;
};

export type TokenEfficiencyCounts = {
  errorCount: number;
  interruptedSessions: number;
  interruptionSignalSessions: number;
  sessions: number;
  tokens: number;
  toolCallCount: number;
};

type MutableEfficiencyCounts = {
  errorCount: number;
  interruptedSessions: Map<string, boolean>;
  interruptionSignalSessions: Set<string>;
  sessions: Set<string>;
  tokens: number;
  toolCallCount: number;
};

const EMPTY_TEAM_SUMMARY: TokenEfficiencyTeamSummary = {
  errorRateMedian: null,
  interruptionRateMedian: null,
  qualifiedUsers: {
    errorRate: 0,
    interruptionRate: 0,
    tokensPerSession: 0,
  },
  tokensPerSessionMedian: null,
};

export function buildTokenEfficiencySummary(entries: TokenUsageEvent[]): TokenEfficiencySummary {
  const countsByUser = new Map<string, MutableEfficiencyCounts>();

  for (const entry of entries) {
    const current = countsByUser.get(entry.userId) ?? createMutableCounts();
    addEntryToCounts(current, entry);
    countsByUser.set(entry.userId, current);
  }

  const rawProfiles = new Map(
    [...countsByUser.entries()].map(([userId, counts]) => [
      userId,
      buildEfficiencyProfileFromCounts(finalizeCounts(counts)),
    ])
  );
  const errorRateValues = readyValues(rawProfiles, "errorRate");
  const interruptionRateValues = readyValues(rawProfiles, "interruptionRate");
  const tokensPerSessionValues = readyValues(rawProfiles, "tokensPerSession");
  const team: TokenEfficiencyTeamSummary = {
    errorRateMedian: median(errorRateValues),
    interruptionRateMedian: median(interruptionRateValues),
    qualifiedUsers: {
      errorRate: errorRateValues.length,
      interruptionRate: interruptionRateValues.length,
      tokensPerSession: tokensPerSessionValues.length,
    },
    tokensPerSessionMedian: median(tokensPerSessionValues),
  };

  return {
    team,
    users: new Map(
      [...rawProfiles.entries()].map(([userId, profile]) => [
        userId,
        {
          errorRate: withTeamMedian(profile.errorRate, team.errorRateMedian),
          interruptionRate: withTeamMedian(profile.interruptionRate, team.interruptionRateMedian),
          tokensPerSession: withTeamMedian(profile.tokensPerSession, team.tokensPerSessionMedian),
        },
      ])
    ),
  };
}

export function emptyTokenEfficiencyProfile(team: TokenEfficiencyTeamSummary = EMPTY_TEAM_SUMMARY): TokenEfficiencyProfile {
  return {
    errorRate: withTeamMedian(emptyMetric(TOKEN_EFFICIENCY_MIN_TOOL_CALLS), team.errorRateMedian),
    interruptionRate: withTeamMedian(
      emptyMetric(TOKEN_EFFICIENCY_MIN_INTERRUPTION_SESSIONS),
      team.interruptionRateMedian
    ),
    tokensPerSession: withTeamMedian(emptyMetric(TOKEN_EFFICIENCY_MIN_TOKEN_SESSIONS), team.tokensPerSessionMedian),
  };
}

export function summarizeTokenEfficiencyCounts(entries: TokenUsageEvent[]): TokenEfficiencyCounts {
  const counts = createMutableCounts();
  for (const entry of entries) {
    addEntryToCounts(counts, entry);
  }
  return finalizeCounts(counts);
}

export function buildEfficiencyProfileFromCounts(counts: TokenEfficiencyCounts): TokenEfficiencyProfile {
  return {
    errorRate: buildMetric(counts.errorCount, counts.toolCallCount, TOKEN_EFFICIENCY_MIN_TOOL_CALLS, counts.toolCallCount > 0),
    interruptionRate: buildMetric(
      counts.interruptedSessions,
      counts.interruptionSignalSessions,
      TOKEN_EFFICIENCY_MIN_INTERRUPTION_SESSIONS,
      counts.interruptionSignalSessions > 0
    ),
    tokensPerSession: buildMetric(
      counts.tokens,
      counts.sessions,
      TOKEN_EFFICIENCY_MIN_TOKEN_SESSIONS,
      counts.sessions > 0,
      (tokens, sessions) => tokens / sessions
    ),
  };
}

function createMutableCounts(): MutableEfficiencyCounts {
  return {
    errorCount: 0,
    interruptedSessions: new Map<string, boolean>(),
    interruptionSignalSessions: new Set<string>(),
    sessions: new Set<string>(),
    tokens: 0,
    toolCallCount: 0,
  };
}

function addEntryToCounts(counts: MutableEfficiencyCounts, entry: TokenUsageEvent) {
  const sessionId = entry.sessionId || entry.id;
  counts.sessions.add(sessionId);
  counts.tokens += consumptionTokens(entry);

  if (entry.toolCallCount !== undefined && entry.toolCallCount !== null) {
    counts.toolCallCount += nonNegativeInteger(entry.toolCallCount);
    counts.errorCount += nonNegativeInteger(entry.errorCount);
  }

  if (entry.interruptedCount !== undefined && entry.interruptedCount !== null) {
    counts.interruptionSignalSessions.add(sessionId);
    if (nonNegativeInteger(entry.interruptedCount) > 0) {
      counts.interruptedSessions.set(sessionId, true);
    } else if (!counts.interruptedSessions.has(sessionId)) {
      counts.interruptedSessions.set(sessionId, false);
    }
  }
}

function finalizeCounts(counts: MutableEfficiencyCounts): TokenEfficiencyCounts {
  return {
    errorCount: counts.errorCount,
    interruptedSessions: [...counts.interruptedSessions.values()].filter(Boolean).length,
    interruptionSignalSessions: counts.interruptionSignalSessions.size,
    sessions: counts.sessions.size,
    tokens: counts.tokens,
    toolCallCount: counts.toolCallCount,
  };
}

function buildMetric(
  numerator: number,
  denominator: number,
  minimumDenominator: number,
  hasData: boolean,
  valueFactory: (numerator: number, denominator: number) => number = (left, right) => left / right
): TokenEfficiencyMetric {
  const safeNumerator = nonNegativeNumber(numerator);
  const safeDenominator = nonNegativeNumber(denominator);

  if (!hasData) {
    return emptyMetric(minimumDenominator, safeNumerator, safeDenominator);
  }

  if (safeDenominator < minimumDenominator) {
    return {
      comparison: null,
      denominator: safeDenominator,
      minimumDenominator,
      numerator: safeNumerator,
      status: "insufficient",
      teamMedian: null,
      value: null,
    };
  }

  return {
    comparison: null,
    denominator: safeDenominator,
    minimumDenominator,
    numerator: safeNumerator,
    status: "ready",
    teamMedian: null,
    value: safeDenominator > 0 ? valueFactory(safeNumerator, safeDenominator) : null,
  };
}

function emptyMetric(minimumDenominator: number, numerator = 0, denominator = 0): TokenEfficiencyMetric {
  return {
    comparison: null,
    denominator,
    minimumDenominator,
    numerator,
    status: "no_data",
    teamMedian: null,
    value: null,
  };
}

function withTeamMedian(metric: TokenEfficiencyMetric, teamMedian: number | null): TokenEfficiencyMetric {
  return {
    ...metric,
    teamMedian,
    comparison: metric.value === null || teamMedian === null ? null : compareMetric(metric.value, teamMedian),
  };
}

function compareMetric(value: number, medianValue: number): TokenEfficiencyComparison {
  const diff = value - medianValue;
  if (Math.abs(diff) <= 1e-9) {
    return "same";
  }
  return diff > 0 ? "higher" : "lower";
}

function readyValues(
  profiles: Map<string, TokenEfficiencyProfile>,
  key: keyof TokenEfficiencyProfile
): number[] {
  return [...profiles.values()].flatMap((profile) => {
    const metric = profile[key];
    return metric.status === "ready" && metric.value !== null ? [metric.value] : [];
  });
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function consumptionTokens(entry: Pick<TokenUsageEvent, "inputTokens" | "outputTokens">) {
  return nonNegativeNumber(entry.inputTokens) + nonNegativeNumber(entry.outputTokens);
}

function nonNegativeInteger(value: unknown) {
  return Math.trunc(nonNegativeNumber(value));
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
