import type { CodexRateLimitReport } from "./codex-rate-limits";
import type { TokenGoal, TokenGoalEvaluation } from "./token-goals";
import {
  buildEmptyTokenAchievementSummary,
  buildTokenAchievementSummariesByUser,
  buildTokenAchievementSummary,
  type TokenAchievementBadge,
  type TokenLevelProgress,
  type TokenPersonalBests,
} from "./token-achievements";
import {
  buildTokenEfficiencySummary,
  emptyTokenEfficiencyProfile,
  type TokenEfficiencyProfile,
  type TokenEfficiencyTeamSummary,
} from "./token-efficiency";

export type TokenBoardRange = "today" | "1D" | "7D" | "30D" | "90D" | "week" | "month" | "lastweek" | "lastmonth";
export type TokenLeaderboardSummaryRange = TokenBoardRange | "custom";

export type TokenBoardMetric = "tokens" | "cost" | "sessions" | "messages" | "users" | "lines";

export type TokenDailyUsagePoint = {
  date: string;
  startAt: string;
  endAt: string;
  tokens: number;
};

export type TokenTrendMetricValues = {
  tokens: number;
  costUsd: number;
  sessions: number;
  messages: number;
  activeUsers: number;
  linesWritten: number;
};

export type TokenTrendSegment = TokenTrendMetricValues & {
  key: string;
  label: string;
  other?: boolean;
  rank: number;
  share: number;
};

export type TokenTrendPoint = TokenDailyUsagePoint &
  Omit<TokenTrendMetricValues, "tokens"> & {
    segments: TokenTrendSegment[];
  };

export type TokenHourlyTrendPoint = TokenTrendMetricValues & {
  date: string;
  endAt: string;
  hour: number;
  segments: TokenTrendSegment[];
  startAt: string;
};

export type TokenTrendBreakdown = {
  daily: TokenTrendPoint[];
  hourly: Array<{
    date: string;
    endAt: string;
    points: TokenHourlyTrendPoint[];
    startAt: string;
  }>;
  hourlySupportedDays: number;
  kind: "model" | "user";
  limit: number;
  segments: TokenTrendSegment[];
};

export type TokenUsageEvent = {
  id: string;
  /** Stable collector-native key; unlike `id`, it is independent of mutable usage metadata. */
  upstreamEventId?: string;
  userId: string;
  displayName: string;
  team?: string;
  source: string;
  model: string;
  project?: string;
  tool?: string;
  timestamp: string;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd?: number;
  messages?: number;
  sessionId?: string;
  sessionTitle?: string;
  errorCount?: number | null;
  interruptedCount?: number | null;
  toolCallCount?: number | null;
  linesWritten?: number | null;
};

export type TokenLeaderboardUser = {
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  userId: string;
  displayName: string;
  team: string;
  level: TokenLevelProgress;
  badges: TokenAchievementBadge[];
  personalBests: TokenPersonalBests;
  tokens: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  sessions: number;
  messages: number;
  records: number;
  activeDays: number;
  linesWritten: number | null;
  efficiency: TokenEfficiencyProfile;
  lastReportedAt?: string;
  topModel: string;
  topTool: string;
  share: number;
  deltaTokens: number | null;
  daily: TokenDailyUsagePoint[];
};

export type TokenTeamMemberSummary = {
  userId: string;
  displayName: string;
  tokens: number;
  share: number;
};

export type TokenTeamLeaderboardEntry = {
  rank: number;
  name: string;
  tokens: number;
  costUsd: number;
  activeUsers: number;
  tokensPerUser: number;
  deltaTokens: number | null;
  share: number;
  members: TokenTeamMemberSummary[];
};

export type TokenProjectLeaderboardEntry = {
  rank: number;
  name: string;
  tokens: number;
  costUsd: number;
  activeUsers: number;
  sessions: number;
  topModel: string;
  share: number;
  other?: boolean;
};

export type TokenUsageDistributionBucket = {
  key: string;
  label: string;
  minTokens: number;
  maxTokens: number | null;
  count: number;
  share: number;
};

export type TokenUsageDistribution = {
  totalUsers: number;
  maxTokens: number;
  percentiles: {
    p50: number;
    p90: number;
    p99: number;
  };
  buckets: TokenUsageDistributionBucket[];
};

export type TokenLeaderboardSummary = {
  range: TokenLeaderboardSummaryRange;
  startAt: string;
  endAt: string;
  totalTokens: number;
  totalCostUsd: number;
  totalSessions: number;
  totalMessages: number;
  totalLinesWritten: number | null;
  activeUsers: number;
  topModel: string;
  topTool: string;
  daily: TokenDailyUsagePoint[];
  trends?: {
    model: TokenTrendBreakdown;
    user: TokenTrendBreakdown;
  };
  models: Array<{ name: string; tokens: number; costUsd: number; share: number }>;
  tools: Array<{ name: string; tokens: number; sessions: number; share: number }>;
  teams: TokenTeamLeaderboardEntry[];
  projects: TokenProjectLeaderboardEntry[];
  distribution: TokenUsageDistribution;
  efficiency: TokenEfficiencyTeamSummary;
  users: TokenLeaderboardUser[];
};

export type TokenUsageProjectBreakdown = {
  name: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  activeDays: number;
  models: number;
  share: number;
  lastReportedAt: string;
};

export type TokenUsageSessionBreakdown = {
  id: string;
  title?: string;
  tokens: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  messages: number;
  records: number;
  model: string;
  tool: string;
  project: string;
  models: number;
  tools: number;
  projects: number;
  startAt: string;
  endAt: string;
};

export type TokenBoardUserConfig = {
  updatedAt: string;
  agent?: {
    name?: string;
    version?: string;
    platform?: string;
  };
  codex?: {
    model?: string;
    modelReasoningEffort?: string;
    modelContextWindow?: number;
    modelAutoCompactTokenLimit?: number;
    modelCacheContextWindow?: number;
    modelMaxContextWindow?: number;
    effectiveContextWindowPercent?: number;
  };
  rateLimits?: CodexRateLimitReport;
  /** Claude Code 订阅额度(来自状态栏快照,复用 Codex 报告结构)。 */
  claudeCodeRateLimits?: CodexRateLimitReport;
  goals?: TokenGoal[];
};

export type TokenUsageActivityCell = {
  weekday: number;
  hour: number;
  tokens: number;
  sessions: number;
  messages: number;
};

export type TokenAccountUsageProfile = {
  range: TokenBoardRange;
  startAt: string;
  endAt: string;
  user: TokenLeaderboardUser | null;
  level: TokenLevelProgress;
  badges: TokenAchievementBadge[];
  personalBests: TokenPersonalBests;
  rank: number | null;
  previousRank: number | null;
  rankDelta: number | null;
  totalUsers: number;
  percentile: number | null;
  records: number;
  daily: TokenLeaderboardSummary["daily"];
  models: TokenLeaderboardSummary["models"];
  tools: TokenLeaderboardSummary["tools"];
  projects: TokenUsageProjectBreakdown[];
  sessions: TokenUsageSessionBreakdown[];
  heatmap: TokenUsageActivityCell[];
  topHour: string;
  topWeekday: string;
  efficiency: TokenEfficiencyProfile;
  config: TokenBoardUserConfig | null;
  goals: TokenGoalEvaluation[];
};

export type TokenLeaderboardWindow = {
  range: TokenLeaderboardSummaryRange;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

const ROLLING_RANGE_DAYS: Record<Extract<TokenBoardRange, "1D" | "7D" | "30D" | "90D">, number> = {
  "1D": 1,
  "7D": 7,
  "30D": 30,
  "90D": 90,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TREND_STACK_LIMIT = 5;
const HOURLY_DRILLDOWN_DAYS = 7;
const PROJECT_LEADERBOARD_LIMIT = 15;
const UNKNOWN_PROJECT_LABEL = "未知项目";
const DISTRIBUTION_BUCKET_DEFS = [
  { key: "lt-1m", label: "<1M", minTokens: 0, maxTokens: 1_000_000 },
  { key: "1m-10m", label: "1-10M", minTokens: 1_000_000, maxTokens: 10_000_000 },
  { key: "10m-100m", label: "10-100M", minTokens: 10_000_000, maxTokens: 100_000_000 },
  { key: "100m-1b", label: "100M-1B", minTokens: 100_000_000, maxTokens: 1_000_000_000 },
  { key: "gte-1b", label: ">1B", minTokens: 1_000_000_000, maxTokens: null },
] satisfies Array<{ key: string; label: string; minTokens: number; maxTokens: number | null }>;

export type TokenModelPricing = {
  id: string;
  aliases?: string[];
  startsWith?: string[];
  includes?: string[];
  input: number;
  output: number;
  cachedInput?: number;
  cacheReadInput?: number;
  cacheCreationInput?: number;
  source?: string;
};

export type TokenPricingFile = {
  models?: TokenModelPricing[];
  fallback?: Pick<TokenModelPricing, "input" | "output" | "cachedInput" | "cacheReadInput" | "cacheCreationInput">;
};

const DEFAULT_MODEL_PRICING: TokenModelPricing[] = [
  { id: "gpt-5.5-pro", startsWith: ["gpt-5.5-pro"], input: 15, output: 90, source: "openai" },
  { id: "gpt-5.5", startsWith: ["gpt-5.5"], input: 2.5, cachedInput: 0.25, output: 15, source: "openai" },
  { id: "gpt-5.4-pro", startsWith: ["gpt-5.4-pro"], input: 15, output: 90, source: "openai" },
  { id: "gpt-5.4-mini", startsWith: ["gpt-5.4-mini"], input: 0.375, cachedInput: 0.0375, output: 2.25, source: "openai" },
  { id: "gpt-5.4-nano", startsWith: ["gpt-5.4-nano"], input: 0.1, cachedInput: 0.01, output: 0.625, source: "openai" },
  { id: "gpt-5.4", startsWith: ["gpt-5.4"], input: 1.25, cachedInput: 0.13, output: 7.5, source: "openai" },
  { id: "gpt-5.3-codex", startsWith: ["gpt-5.3-codex"], input: 1.75, cachedInput: 0.175, output: 14, source: "openai" },
  { id: "gpt-5-mini", startsWith: ["gpt-5-mini", "gpt-5.3-mini", "gpt-5.2-mini", "gpt-5.1-mini"], input: 0.75, cachedInput: 0.075, output: 4.5, source: "openai-compat" },
  { id: "gpt-5-nano", startsWith: ["gpt-5-nano", "gpt-5.3-nano", "gpt-5.2-nano", "gpt-5.1-nano"], input: 0.2, cachedInput: 0.02, output: 1.25, source: "openai-compat" },
  { id: "gpt-5", startsWith: ["gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5"], input: 1.25, cachedInput: 0.125, output: 10, source: "openai-compat" },
  { id: "o3-deep-research", startsWith: ["o3-deep-research"], input: 5, output: 20, source: "openai" },
  { id: "o4-mini-deep-research", startsWith: ["o4-mini-deep-research"], input: 1, output: 4, source: "openai" },
  { id: "o4-mini", startsWith: ["o4-mini"], input: 1.1, cachedInput: 0.275, output: 4.4, source: "openai-compat" },
  { id: "o3-mini", startsWith: ["o3-mini"], input: 1.1, cachedInput: 0.55, output: 4.4, source: "openai-compat" },
  { id: "o3", startsWith: ["o3"], input: 10, cachedInput: 2.5, output: 40, source: "openai-compat" },
  { id: "gpt-4.1-mini", startsWith: ["gpt-4.1-mini", "gpt-4.1-nano"], input: 0.4, cachedInput: 0.1, output: 1.6, source: "openai-compat" },
  { id: "gpt-4.1", startsWith: ["gpt-4.1"], input: 2, cachedInput: 0.5, output: 8, source: "openai-compat" },
  { id: "gpt-4o-mini", startsWith: ["gpt-4o-mini"], input: 0.15, cachedInput: 0.075, output: 0.6, source: "openai-compat" },
  { id: "gpt-4o", startsWith: ["gpt-4o"], input: 2.5, cachedInput: 1.25, output: 10, source: "openai-compat" },
  { id: "gemini-3.5-flash", startsWith: ["gemini-3.5-flash", "google/gemini-3.5-flash"], input: 1.5, cacheReadInput: 0.15, output: 9, source: "google" },
  { id: "gemini-3.1-pro", startsWith: ["gemini-3.1-pro", "google/gemini-3.1-pro"], input: 2, cacheReadInput: 0.2, output: 12, source: "google" },
  { id: "gemini-3.1-flash-lite", startsWith: ["gemini-3.1-flash-lite", "google/gemini-3.1-flash-lite"], input: 0.25, cacheReadInput: 0.025, output: 1.5, source: "google" },
  { id: "gemini-3-pro", startsWith: ["gemini-3-pro", "gemini-3.0-pro", "google/gemini-3-pro", "google/gemini-3.0-pro"], input: 2, cacheReadInput: 0.2, output: 12, source: "google" },
  { id: "gemini-3-flash", startsWith: ["gemini-3-flash", "gemini-3.0-flash", "google/gemini-3-flash", "google/gemini-3.0-flash"], input: 0.5, cacheReadInput: 0.05, output: 3, source: "google" },
  { id: "gemini-2.5-pro", startsWith: ["gemini-2.5-pro", "google/gemini-2.5-pro"], input: 1.25, cacheReadInput: 0.125, output: 10, source: "google" },
  { id: "gemini-2.5-flash-lite", startsWith: ["gemini-2.5-flash-lite", "google/gemini-2.5-flash-lite"], input: 0.1, cacheReadInput: 0.01, output: 0.4, source: "google" },
  { id: "gemini-2.5-flash", startsWith: ["gemini-2.5-flash", "google/gemini-2.5-flash"], input: 0.3, cacheReadInput: 0.03, output: 2.5, source: "google" },
  { id: "gemini-2.0-flash", startsWith: ["gemini-2.0-flash", "gemini-2-flash", "google/gemini-2.0-flash", "google/gemini-2-flash"], input: 0.1, cacheReadInput: 0.01, output: 0.4, source: "google" },
  { id: "claude-fable-5", startsWith: ["claude-fable-5"], input: 10, cacheCreationInput: 12.5, cacheReadInput: 1, output: 50, source: "anthropic" },
  { id: "claude-mythos-5", startsWith: ["claude-mythos-5", "claude-mythos-preview"], input: 10, cacheCreationInput: 12.5, cacheReadInput: 1, output: 50, source: "anthropic" },
  { id: "claude-opus-4.8", startsWith: ["claude-opus-4.8"], input: 5, cacheCreationInput: 6.25, cacheReadInput: 0.5, output: 25, source: "anthropic" },
  { id: "claude-opus-4.7", startsWith: ["claude-opus-4.7"], input: 5, cacheCreationInput: 6.25, cacheReadInput: 0.5, output: 25, source: "anthropic" },
  { id: "claude-opus-4.6", startsWith: ["claude-opus-4.6"], input: 5, cacheCreationInput: 6.25, cacheReadInput: 0.5, output: 25, source: "anthropic" },
  { id: "claude-opus-4.5", startsWith: ["claude-opus-4.5"], input: 5, cacheCreationInput: 6.25, cacheReadInput: 0.5, output: 25, source: "anthropic" },
  { id: "claude-opus-4.1", startsWith: ["claude-opus-4.1"], input: 15, cacheCreationInput: 18.75, cacheReadInput: 1.5, output: 75, source: "anthropic" },
  { id: "claude-opus-4", startsWith: ["claude-opus-4", "claude-4-opus"], includes: ["claude", "opus"], input: 15, cacheCreationInput: 18.75, cacheReadInput: 1.5, output: 75, source: "anthropic" },
  { id: "claude-sonnet-5", startsWith: ["claude-sonnet-5"], input: 2, cacheCreationInput: 2.5, cacheReadInput: 0.2, output: 10, source: "anthropic" },
  { id: "claude-sonnet-4", startsWith: ["claude-sonnet-4", "claude-4-sonnet"], includes: ["claude", "sonnet"], input: 3, cacheCreationInput: 3.75, cacheReadInput: 0.3, output: 15, source: "anthropic" },
  { id: "claude-haiku-4.5", startsWith: ["claude-haiku-4.5"], input: 1, cacheCreationInput: 1.25, cacheReadInput: 0.1, output: 5, source: "anthropic" },
  { id: "claude-haiku-3.5", startsWith: ["claude-haiku-3.5"], input: 0.8, cacheCreationInput: 1, cacheReadInput: 0.08, output: 4, source: "anthropic" },
  { id: "claude-haiku", startsWith: ["claude-haiku"], includes: ["claude", "haiku"], input: 0.8, cacheCreationInput: 1, cacheReadInput: 0.08, output: 4, source: "anthropic-compat" },
];

const DEFAULT_FALLBACK_PRICING: Pick<
  TokenModelPricing,
  "input" | "output" | "cachedInput" | "cacheReadInput" | "cacheCreationInput"
> = {
  input: 1,
  output: 5,
  cacheReadInput: 0.1,
  cacheCreationInput: 1.25,
};
const unmatchedPricingModels = new Set<string>();
let pricingFileCacheKey = "";
let pricingFileCache: { models: TokenModelPricing[]; fallback: typeof DEFAULT_FALLBACK_PRICING } | undefined;

export function buildTokenLeaderboard(
  entries: TokenUsageEvent[],
  {
    range,
    metric,
    now = new Date(),
    window,
  }: {
    range: TokenBoardRange;
    metric: TokenBoardMetric;
    now?: Date;
    window?: TokenLeaderboardWindow;
  }
): TokenLeaderboardSummary {
  const end = Number.isFinite(now.getTime()) ? now : new Date();
  const rangeWindow = window ?? resolveTokenLeaderboardWindow(range, end);
  const { start, previousStart, previousEnd } = rangeWindow;
  const normalizedEntries = dedupeTokenEvents(entries.map(normalizeTokenUsageEvent));
  const currentEntries = normalizedEntries.filter((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    return timestamp >= start.getTime() && timestamp <= rangeWindow.end.getTime();
  });
  const previousEntries = normalizedEntries.filter((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    return timestamp >= previousStart.getTime() && timestamp <= previousEnd.getTime();
  });
  const dailyByUser = buildDailySeriesByUser(currentEntries, start, rangeWindow.end);
  const previousTokensByUser = sumTokensByUser(previousEntries);
  const previousRankByUser = rankEntriesByUser(previousEntries, metric);
  const achievementsByUser = buildTokenAchievementSummariesByUser(normalizedEntries, { now: end });
  const efficiencySummary = buildTokenEfficiencySummary(currentEntries);
  const users = applyRankDelta(
    rankUsers(
      aggregateUsers(currentEntries, previousTokensByUser, dailyByUser, achievementsByUser, previousRankByUser),
      metric
    )
  ).map((user) => ({
    ...user,
    efficiency: efficiencySummary.users.get(user.userId) ?? emptyTokenEfficiencyProfile(efficiencySummary.team),
  }));
  const totalTokens = users.reduce((sum, user) => sum + user.tokens, 0);
  const totalCostUsd = users.reduce((sum, user) => sum + user.costUsd, 0);
  const totalSessions = users.reduce((sum, user) => sum + user.sessions, 0);
  const totalMessages = users.reduce((sum, user) => sum + user.messages, 0);
  const lineValues = users.flatMap((user) => (user.linesWritten === null ? [] : [user.linesWritten]));
  const totalLinesWritten = lineValues.length ? lineValues.reduce((sum, value) => sum + value, 0) : null;
  const models = aggregateNamedUsage(currentEntries, "model");
  const tools = aggregateNamedUsage(currentEntries, "tool");
  const trends = buildTokenLeaderboardTrends(currentEntries, start, rangeWindow.end);
  const teams = buildTokenTeamLeaderboard(currentEntries, previousEntries);
  const projects = buildTokenProjectLeaderboard(currentEntries);
  const distribution = buildTokenUsageDistribution(currentEntries);

  return {
    range: rangeWindow.range,
    startAt: start.toISOString(),
    endAt: rangeWindow.end.toISOString(),
    totalTokens,
    totalCostUsd,
    totalSessions,
    totalMessages,
    totalLinesWritten,
    activeUsers: users.length,
    topModel: models[0]?.name ?? "unknown",
    topTool: tools[0]?.name ?? "unknown",
    daily: buildDailySeries(currentEntries, start, rangeWindow.end),
    trends,
    models,
    tools,
    teams,
    projects,
    distribution,
    efficiency: efficiencySummary.team,
    users: users.map((user) => ({
      ...user,
      share: totalTokens > 0 ? user.tokens / totalTokens : 0,
    })),
  };
}

export function resolveTokenLeaderboardWindow(range: TokenBoardRange, now = new Date()): TokenLeaderboardWindow {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();

  if (range === "today") {
    const start = startOfShanghaiDay(safeNow);

    return {
      range,
      start,
      end: safeNow,
      previousStart: new Date(start.getTime() - DAY_MS),
      previousEnd: new Date(start.getTime() - 1),
    };
  }

  if (range in ROLLING_RANGE_DAYS) {
    const days = ROLLING_RANGE_DAYS[range as keyof typeof ROLLING_RANGE_DAYS];
    const start = new Date(safeNow.getTime() - days * DAY_MS);

    return {
      range,
      start,
      end: safeNow,
      previousStart: new Date(start.getTime() - days * DAY_MS),
      previousEnd: new Date(start.getTime() - 1),
    };
  }

  if (range === "week" || range === "lastweek") {
    const thisWeekStart = startOfShanghaiWeek(safeNow);
    const currentStart = range === "week" ? thisWeekStart : new Date(thisWeekStart.getTime() - 7 * DAY_MS);

    return {
      range,
      start: currentStart,
      end: range === "week" ? safeNow : new Date(thisWeekStart.getTime() - 1),
      previousStart: new Date(currentStart.getTime() - 7 * DAY_MS),
      previousEnd: new Date(currentStart.getTime() - 1),
    };
  }

  const thisMonthStart = startOfShanghaiMonth(safeNow);
  const currentStart = range === "month" ? thisMonthStart : addShanghaiMonths(thisMonthStart, -1);

  return {
    range,
    start: currentStart,
    end: range === "month" ? safeNow : new Date(thisMonthStart.getTime() - 1),
    previousStart: addShanghaiMonths(currentStart, -1),
    previousEnd: new Date(currentStart.getTime() - 1),
  };
}

export function createCustomTokenLeaderboardWindow(from: string, to: string): TokenLeaderboardWindow {
  const start = shanghaiDayStartUtc(from);
  const toStart = shanghaiDayStartUtc(to);
  const days = Math.floor((toStart.getTime() - start.getTime()) / DAY_MS) + 1;

  return {
    range: "custom",
    start,
    end: new Date(toStart.getTime() + DAY_MS - 1),
    previousStart: new Date(start.getTime() - days * DAY_MS),
    previousEnd: new Date(start.getTime() - 1),
  };
}

export function buildTokenAccountUsageProfile(
  entries: TokenUsageEvent[],
  {
    userId,
    range,
    now = new Date(),
  }: {
    userId: string;
    range: TokenBoardRange;
    now?: Date;
  }
): TokenAccountUsageProfile {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const normalizedEntries = dedupeTokenEvents(entries.map(normalizeTokenUsageEvent));
  const globalSummary = buildTokenLeaderboard(normalizedEntries, { range, metric: "tokens", now: safeNow });
  const start = new Date(globalSummary.startAt);
  const end = new Date(globalSummary.endAt);
  const accountEntries = normalizedEntries.filter((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    return entry.userId === userId && timestamp >= start.getTime() && timestamp <= end.getTime();
  });
  const accountSummary = buildTokenLeaderboard(accountEntries, { range, metric: "tokens", now: safeNow });
  const rankedUser = globalSummary.users.find((user) => user.userId === userId) ?? null;
  const accountEfficiencySummary = buildTokenEfficiencySummary(accountEntries);
  const accountEfficiency =
    rankedUser?.efficiency ??
    accountEfficiencySummary.users.get(userId) ??
    emptyTokenEfficiencyProfile(globalSummary.efficiency);
  const achievements = buildTokenAchievementSummary(
    normalizedEntries.filter((entry) => entry.userId === userId),
    { now: safeNow }
  );
  const effectiveAchievements = rankedUser
    ? {
        level: rankedUser.level,
        badges: rankedUser.badges,
        personalBests: rankedUser.personalBests,
      }
    : achievements;
  const accountUser = accountSummary.users[0]
    ? {
        ...accountSummary.users[0],
        rank: rankedUser?.rank ?? accountSummary.users[0].rank,
        previousRank: rankedUser?.previousRank ?? accountSummary.users[0].previousRank,
        rankDelta: rankedUser?.rankDelta ?? accountSummary.users[0].rankDelta,
        share: rankedUser?.share ?? accountSummary.users[0].share,
        deltaTokens: rankedUser?.deltaTokens ?? accountSummary.users[0].deltaTokens,
        level: effectiveAchievements.level,
        badges: effectiveAchievements.badges,
        personalBests: effectiveAchievements.personalBests,
        efficiency: rankedUser?.efficiency ?? accountSummary.users[0].efficiency,
      }
    : null;
  const previousRank = rankedUser?.previousRank ?? null;
  const rank = rankedUser?.rank ?? null;
  const totalUsers = globalSummary.users.length;

  return {
    range,
    startAt: globalSummary.startAt,
    endAt: globalSummary.endAt,
    user: accountUser,
    level: effectiveAchievements.level,
    badges: effectiveAchievements.badges,
    personalBests: effectiveAchievements.personalBests,
    rank,
    previousRank,
    rankDelta: rank !== null && previousRank !== null ? previousRank - rank : null,
    totalUsers,
    percentile: rank !== null && totalUsers > 0 ? (totalUsers - rank) / totalUsers : null,
    records: accountEntries.length,
    daily: accountSummary.daily,
    models: accountSummary.models,
    tools: accountSummary.tools,
    projects: aggregateProjectUsage(accountEntries),
    sessions: aggregateSessionUsage(accountEntries),
    heatmap: buildActivityHeatmap(accountEntries),
    topHour: topActivityHour(accountEntries),
    topWeekday: topActivityWeekday(accountEntries),
    efficiency: accountEfficiency,
    config: null,
    goals: [],
  };
}

export function parseTokenUsageImport(input: string): {
  entries: TokenUsageEvent[];
  errors: string[];
} {
  const trimmed = input.trim();

  if (!trimmed) {
    return { entries: [], errors: ["没有可导入的数据"] };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonImport(trimmed);
  }

  return parseCsvImport(trimmed);
}

export function dedupeTokenEvents(entries: TokenUsageEvent[]) {
  const byId = new Map<string, TokenUsageEvent>();

  for (const entry of entries) {
    byId.set(entry.id, normalizeTokenUsageEvent(entry));
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function normalizeTokenUsageEvent(value: Partial<TokenUsageEvent>): TokenUsageEvent {
  const record = value as Record<string, unknown>;
  const inputTokens = toFiniteNumber(readField(record, ["inputTokens", "input_tokens"]));
  const cacheCreationInputTokens = cacheCreationInputTokensFromImportRecord(record);
  const cachedInputTokens = firstImportFieldNumber(record, [
    "cachedInputTokens",
    "cached_input_tokens",
    "cachedTokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
  ]);
  const outputTokens = toFiniteNumber(readField(record, ["outputTokens", "output_tokens"]));
  const reasoningOutputTokens = toFiniteNumber(
    readField(record, ["reasoningOutputTokens", "reasoning_output_tokens", "reasoningTokens"])
  );
  const errorCount = optionalImportFieldInteger(record, ["errorCount", "error_count"]);
  const interruptedCount = optionalImportFieldInteger(record, [
    "interruptedCount",
    "interrupted_count",
    "interruptCount",
    "interrupt_count",
    "abortedCount",
    "aborted_count",
  ]);
  const toolCallCount = optionalImportFieldInteger(record, ["toolCallCount", "tool_call_count"]);
  const linesWritten = optionalImportFieldInteger(record, ["linesWritten", "lines_written", "writtenLines", "written_lines"]);
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens <= 0) {
    throw new Error("缺少 inputTokens/outputTokens，不能使用 totalTokens 兜底");
  }

  const userId = normalizeText(value.userId) || normalizeText(value.displayName) || "unknown";
  const timestamp = normalizeDate(value.timestamp);
  const model = normalizeText(value.model) || "unknown";
  const source = normalizeText(value.source) || "manual";
  const sessionId = normalizeText(value.sessionId);
  const sessionTitle = normalizeText(value.sessionTitle).slice(0, 120);
  const upstreamEventId = normalizeText(value.upstreamEventId).slice(0, 160);
  const id =
    normalizeText(value.id) ||
    [
      userId,
      timestamp,
      source,
      model,
      normalizeText(value.project),
      sessionId,
      totalTokens,
    ].join(":");

  return {
    id,
    ...(upstreamEventId ? { upstreamEventId } : {}),
    userId,
    displayName: normalizeText(value.displayName) || userId,
    team: normalizeText(value.team) || "Friends",
    source,
    model,
    project: normalizeText(value.project),
    tool: normalizeText(value.tool) || source,
    timestamp,
    inputTokens,
    cacheCreationInputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    costUsd:
      typeof value.costUsd === "number" && Number.isFinite(value.costUsd)
        ? value.costUsd
        : estimateCostUsd({
            model,
            inputTokens,
            cacheCreationInputTokens,
            cachedInputTokens,
            outputTokens,
          }),
    messages: toFiniteNumber(value.messages),
    sessionId,
    sessionTitle,
    ...(errorCount !== undefined ? { errorCount } : {}),
    ...(interruptedCount !== undefined ? { interruptedCount } : {}),
    ...(toolCallCount !== undefined ? { toolCallCount } : {}),
    ...(linesWritten !== undefined ? { linesWritten } : {}),
  };
}

export function getTokenConsumptionTokens(
  entry: Pick<TokenUsageEvent, "inputTokens" | "outputTokens">
) {
  const inputContextTokens = getInputContextTokens(entry);
  const outputTokens = toFiniteNumber(entry.outputTokens);
  const totalTokens = inputContextTokens + outputTokens;

  if (totalTokens <= 0) {
    throw new Error("缺少 inputTokens/outputTokens，不能使用 totalTokens 兜底");
  }

  return totalTokens;
}

export function getInputContextTokens(entry: Pick<TokenUsageEvent, "inputTokens">) {
  return toFiniteNumber(entry.inputTokens);
}

export function createDemoTokenEntries(now = new Date()): TokenUsageEvent[] {
  const users = [
    { userId: "feng", displayName: "Feng", team: "Frontend Lab", weight: 1.05 },
    { userId: "ava", displayName: "Ava", team: "Solo Builders", weight: 0.84 },
    { userId: "kai", displayName: "Kai", team: "Infra Notes", weight: 0.72 },
    { userId: "mira", displayName: "Mira", team: "Design Systems", weight: 0.58 },
    { userId: "leo", displayName: "Leo", team: "Weekend Apps", weight: 0.49 },
    { userId: "nora", displayName: "Nora", team: "Research Desk", weight: 0.38 },
  ];
  const models = ["gpt-5.5", "claude-sonnet-4-6", "gpt-5.4-mini", "gpt-5.3-codex"];
  const tools = ["Codex CLI", "Claude Code"];
  const projects = ["garden-lab", "token-board", "notes", "side-project"];
  const today = startOfUtcDay(now);
  const entries: TokenUsageEvent[] = [];

  users.forEach((user, userIndex) => {
    for (let day = 0; day < 42; day += 1) {
      if ((day + userIndex) % 5 === 4) {
        continue;
      }

      const intensity = user.weight * (1 + ((day + userIndex) % 4) * 0.16);
      const totalTokens = Math.round((3_200_000 + userIndex * 510_000 + day * 47_000) * intensity);
      const outputTokens = Math.round(totalTokens * (0.075 + (userIndex % 3) * 0.008));
      const reasoningOutputTokens = Math.round(outputTokens * (0.18 + (day % 2) * 0.04));
      const inputTokens = Math.max(0, totalTokens - outputTokens);
      const cachedInputTokens = Math.round(inputTokens * (0.36 + (day % 3) * 0.05));
      const cacheCreationInputTokens = Math.round(inputTokens * (0.03 + (day % 2) * 0.01));
      const timestamp = new Date(
        today.getTime() - day * 24 * 60 * 60 * 1000 + (9 + ((userIndex + day) % 10)) * 60 * 60 * 1000
      );

      entries.push(
        normalizeTokenUsageEvent({
          id: `demo:${user.userId}:${day}`,
          userId: user.userId,
          displayName: user.displayName,
          team: user.team,
          source: tools[(userIndex + day) % tools.length].toLowerCase().replace(/\s+/g, "-"),
          tool: tools[(userIndex + day) % tools.length],
          model: models[(userIndex + day) % models.length],
          project: projects[(userIndex + day) % projects.length],
          timestamp: timestamp.toISOString(),
          inputTokens,
          cacheCreationInputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
          messages: 24 + ((day + userIndex) % 9) * 7,
          sessionId: `demo-session-${user.userId}-${day}`,
        })
      );
    }
  });

  return entries;
}

function parseJsonImport(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];

    if (!records.length) {
      return { entries: [], errors: ["JSON 需要是数组，或包含 entries 数组"] };
    }

    return recordsToEvents(records);
  } catch (error) {
    return { entries: [], errors: [error instanceof Error ? error.message : "JSON 解析失败"] };
  }
}

function parseCsvImport(input: string) {
  const rows = parseCsvRows(input);
  const [headers, ...bodyRows] = rows;

  if (!headers?.length || !bodyRows.length) {
    return { entries: [], errors: ["CSV 需要表头和至少一行数据"] };
  }

  const records = bodyRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [normalizeHeader(header), row[index] ?? ""]))
  );

  return recordsToEvents(records);
}

function recordsToEvents(records: unknown[]) {
  const errors: string[] = [];
  const entries = records.flatMap((record, index) => {
    if (!record || typeof record !== "object") {
      errors.push(`第 ${index + 1} 行不是对象`);
      return [];
    }

    const value = record as Record<string, unknown>;
    const rawTimestamp = readField(value, ["timestamp", "date", "bucketStart", "createdAt"]);
    const timestampMs = parseDateMs(rawTimestamp);
    // A present-but-unparseable timestamp must drop the row, not silently become "now".
    if (rawTimestamp !== undefined && String(rawTimestamp).trim() !== "" && timestampMs === null) {
      errors.push(`第 ${index + 1} 行 timestamp 无法解析`);
      return [];
    }
    const timestamp = new Date(timestampMs ?? Date.now()).toISOString();
    const userId = normalizeText(readField(value, ["userId", "user", "username", "name"]));
    const boardInputTokens = readField(value, ["inputTokens"]);
    const inputFieldTokens = toFiniteNumber(
      boardInputTokens ?? readField(value, ["input_tokens", "promptTokens", "prompt_tokens"])
    );
    // cache_read = discounted reads (billed at the cachedInput rate); cache_creation =
    // premium writes (billed at the full input rate, NOT the discounted cached rate).
    const cacheReadTokens = sumImportFields(value, ["cache_read_input_tokens", "cacheReadInputTokens"]);
    const cacheCreationTokens = cacheCreationInputTokensFromImportRecord(value);
    const cachedInputTokens =
      toFiniteNumber(readField(value, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"])) + cacheReadTokens;
    const inputTokens =
      boardInputTokens === undefined
        ? inputFieldTokens + cacheReadTokens + cacheCreationTokens
        : inputFieldTokens;
    const outputTokens = toFiniteNumber(
      readField(value, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"])
    );

    if (!userId) {
      errors.push(`第 ${index + 1} 行缺少 userId/user`);
      return [];
    }

    if (inputTokens + outputTokens <= 0) {
      errors.push(`第 ${index + 1} 行缺少 inputTokens/outputTokens，已拒绝使用 totalTokens 兜底`);
      return [];
    }

    const rawCostUsd = readField(value, ["costUsd", "cost", "estimatedCostUsd"]);

    return [
      normalizeTokenUsageEvent({
        id: normalizeText(readField(value, ["id", "eventId"])),
        upstreamEventId: normalizeText(readField(value, ["upstreamEventId", "upstream_event_id"])),
        userId,
        displayName: normalizeText(readField(value, ["displayName", "name", "username", "user"])) || userId,
        team: normalizeText(readField(value, ["team", "department", "group"])),
        source: normalizeText(readField(value, ["source", "tool"])),
        tool: normalizeText(readField(value, ["tool", "source"])),
        model: normalizeText(readField(value, ["model"])),
        project: normalizeText(readField(value, ["project", "repo", "workspace"])),
        timestamp,
        inputTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens: toFiniteNumber(readField(value, ["reasoningOutputTokens", "reasoning_output_tokens", "reasoningTokens"])),
        totalTokens: inputTokens + outputTokens,
        costUsd: rawCostUsd === undefined || rawCostUsd === "" ? undefined : toFiniteNumber(rawCostUsd),
        messages: toFiniteNumber(readField(value, ["messages", "messageCount"])),
        sessionId: normalizeText(readField(value, ["sessionId", "session", "conversationId"])),
        sessionTitle: normalizeText(readField(value, ["sessionTitle", "session_title", "conversationTitle"])),
        errorCount: optionalImportFieldInteger(value, ["errorCount", "error_count"]),
        interruptedCount: optionalImportFieldInteger(value, [
          "interruptedCount",
          "interrupted_count",
          "interruptCount",
          "interrupt_count",
          "abortedCount",
          "aborted_count",
        ]),
        toolCallCount: optionalImportFieldInteger(value, ["toolCallCount", "tool_call_count"]),
        linesWritten: optionalImportFieldInteger(value, ["linesWritten", "lines_written", "writtenLines", "written_lines"]),
      }),
    ];
  });

  return { entries: dedupeTokenEvents(entries), errors };
}

function aggregateUsers(
  entries: TokenUsageEvent[],
  previousTokensByUser: Map<string, number>,
  dailyByUser: Map<string, TokenDailyUsagePoint[]>,
  achievementsByUser: Map<string, ReturnType<typeof buildTokenAchievementSummary>>,
  previousRankByUser: Map<string, number>
): TokenLeaderboardUser[] {
  const users = new Map<
    string,
    Omit<
      TokenLeaderboardUser,
      | "rank"
      | "previousRank"
      | "rankDelta"
      | "share"
      | "deltaTokens"
      | "topModel"
      | "topTool"
      | "daily"
      | "level"
      | "badges"
      | "efficiency"
      | "personalBests"
    > & {
      modelTokens: Map<string, number>;
      toolTokens: Map<string, number>;
      days: Set<string>;
      hasLinesWritten: boolean;
      sessionIds: Set<string>;
      lastReportedAt: string;
    }
  >();

  for (const entry of entries) {
    const tokens = getTokenConsumptionTokens(entry);
    const user =
      users.get(entry.userId) ??
      {
        userId: entry.userId,
        displayName: entry.displayName,
        team: entry.team || "Friends",
        tokens: 0,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        costUsd: 0,
        sessions: 0,
        messages: 0,
        records: 0,
        activeDays: 0,
        linesWritten: 0,
        hasLinesWritten: false,
        modelTokens: new Map<string, number>(),
        toolTokens: new Map<string, number>(),
        days: new Set<string>(),
        sessionIds: new Set<string>(),
        lastReportedAt: entry.timestamp,
      };

    user.displayName = entry.displayName || user.displayName;
    user.team = entry.team || user.team;
    user.tokens += tokens;
    user.inputTokens += entry.inputTokens;
    user.cacheCreationInputTokens += entry.cacheCreationInputTokens;
    user.cachedInputTokens += entry.cachedInputTokens;
    user.outputTokens += entry.outputTokens;
    user.reasoningOutputTokens += entry.reasoningOutputTokens;
    user.costUsd += entry.costUsd ?? 0;
    user.messages += entry.messages ?? 0;
    user.records += 1;
    if (entry.linesWritten !== undefined && entry.linesWritten !== null) {
      user.linesWritten = (user.linesWritten ?? 0) + Math.max(0, Math.trunc(entry.linesWritten));
      user.hasLinesWritten = true;
    }
    user.days.add(toDateKey(entry.timestamp));
    user.sessionIds.add(entry.sessionId || entry.id);
    if (new Date(entry.timestamp).getTime() > new Date(user.lastReportedAt).getTime()) {
      user.lastReportedAt = entry.timestamp;
    }
    addMapValue(user.modelTokens, entry.model, tokens);
    addMapValue(user.toolTokens, entry.tool || entry.source, tokens);
    users.set(entry.userId, user);
  }

  return [...users.values()].map((user) => {
    const previousTokens = previousTokensByUser.get(user.userId) ?? 0;
    const achievements = achievementsByUser.get(user.userId) ?? buildEmptyTokenAchievementSummary();

    return {
      rank: 0,
      previousRank: previousRankByUser.get(user.userId) ?? null,
      rankDelta: null,
      userId: user.userId,
      displayName: user.displayName,
      team: user.team,
      level: achievements.level,
      badges: achievements.badges,
      personalBests: achievements.personalBests,
      tokens: user.tokens,
      inputTokens: user.inputTokens,
      cacheCreationInputTokens: user.cacheCreationInputTokens,
      cachedInputTokens: user.cachedInputTokens,
      outputTokens: user.outputTokens,
      reasoningOutputTokens: user.reasoningOutputTokens,
      costUsd: user.costUsd,
      sessions: user.sessionIds.size,
      messages: user.messages,
      records: user.records,
      activeDays: user.days.size,
      linesWritten: user.hasLinesWritten ? user.linesWritten : null,
      efficiency: emptyTokenEfficiencyProfile(),
      lastReportedAt: user.lastReportedAt,
      topModel: topMapEntry(user.modelTokens),
      topTool: topMapEntry(user.toolTokens),
      share: 0,
      deltaTokens: previousTokens > 0 ? (user.tokens - previousTokens) / previousTokens : null,
      daily: dailyByUser.get(user.userId) ?? [],
    };
  });
}

function rankUsers(users: TokenLeaderboardUser[], metric: TokenBoardMetric) {
  return users
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric) || a.displayName.localeCompare(b.displayName))
    .map((user, index) => ({ ...user, rank: index + 1 }));
}

function applyRankDelta(users: TokenLeaderboardUser[]) {
  return users.map((user) => ({
    ...user,
    rankDelta: user.previousRank === null ? null : user.previousRank - user.rank,
  }));
}

function rankEntriesByUser(entries: TokenUsageEvent[], metric: TokenBoardMetric) {
  const values = new Map<
    string,
    {
      costUsd: number;
      days: Set<string>;
      displayName: string;
      linesWritten: number | null;
      messages: number;
      sessions: Set<string>;
      tokens: number;
    }
  >();

  for (const entry of entries) {
    const current =
      values.get(entry.userId) ??
      {
        costUsd: 0,
        days: new Set<string>(),
        displayName: entry.displayName || entry.userId,
        linesWritten: null,
        messages: 0,
        sessions: new Set<string>(),
        tokens: 0,
      };

    current.costUsd += entry.costUsd ?? 0;
    current.days.add(toDateKey(entry.timestamp));
    current.displayName = entry.displayName || current.displayName;
    if (entry.linesWritten !== undefined && entry.linesWritten !== null) {
      current.linesWritten = (current.linesWritten ?? 0) + Math.max(0, Math.trunc(entry.linesWritten));
    }
    current.messages += entry.messages ?? 0;
    current.sessions.add(entry.sessionId || entry.id);
    current.tokens += getTokenConsumptionTokens(entry);
    values.set(entry.userId, current);
  }

  const rankableEntries =
    metric === "lines"
      ? [...values.entries()].filter(([, value]) => value.linesWritten !== null)
      : [...values.entries()];
  const ranked = rankableEntries
    .sort(([, left], [, right]) => {
      const diff = previousMetricValue(right, metric) - previousMetricValue(left, metric);
      return diff || left.displayName.localeCompare(right.displayName);
    })
    .map(([userId], index) => [userId, index + 1] as const);

  return new Map(ranked);
}

function previousMetricValue(
  value: {
    costUsd: number;
    days: Set<string>;
    linesWritten: number | null;
    messages: number;
    sessions: Set<string>;
    tokens: number;
  },
  metric: TokenBoardMetric
) {
  if (metric === "lines") {
    return value.linesWritten ?? -1;
  }

  if (metric === "cost") {
    return value.costUsd;
  }

  if (metric === "sessions") {
    return value.sessions.size;
  }

  if (metric === "messages") {
    return value.messages;
  }

  if (metric === "users") {
    return value.days.size;
  }

  return value.tokens;
}

function metricValue(user: TokenLeaderboardUser, metric: TokenBoardMetric) {
  if (metric === "lines") {
    return user.linesWritten ?? -1;
  }

  if (metric === "cost") {
    return user.costUsd;
  }

  if (metric === "sessions") {
    return user.sessions;
  }

  if (metric === "messages") {
    return user.messages;
  }

  if (metric === "users") {
    return user.activeDays;
  }

  return user.tokens;
}

function aggregateNamedUsage(entries: TokenUsageEvent[], key: "model" | "tool") {
  const totalTokens = entries.reduce((sum, entry) => sum + getTokenConsumptionTokens(entry), 0);
  const usage = new Map<string, { tokens: number; costUsd: number; sessions: Set<string> }>();

  for (const entry of entries) {
    const tokens = getTokenConsumptionTokens(entry);
    const name = key === "model" ? entry.model : entry.tool || entry.source;
    const current = usage.get(name) ?? { tokens: 0, costUsd: 0, sessions: new Set<string>() };
    current.tokens += tokens;
    current.costUsd += entry.costUsd ?? 0;
    current.sessions.add(entry.sessionId || entry.id);
    usage.set(name, current);
  }

  return [...usage.entries()]
    .map(([name, value]) => ({
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      sessions: value.sessions.size,
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 12);
}

export function buildTokenTeamLeaderboard(
  entries: TokenUsageEvent[],
  previousEntries: TokenUsageEvent[] = []
): TokenTeamLeaderboardEntry[] {
  const totalTokens = entries.reduce((sum, entry) => sum + getTokenConsumptionTokens(entry), 0);
  const previousTokensByTeam = sumTokensByTeam(previousEntries);
  const teams = new Map<
    string,
    {
      tokens: number;
      costUsd: number;
      members: Map<string, { displayName: string; tokens: number }>;
    }
  >();

  for (const entry of entries) {
    const teamName = normalizeTeamName(entry.team);
    const tokens = getTokenConsumptionTokens(entry);
    const team = teams.get(teamName) ?? {
      tokens: 0,
      costUsd: 0,
      members: new Map<string, { displayName: string; tokens: number }>(),
    };
    const member = team.members.get(entry.userId) ?? {
      displayName: entry.displayName || entry.userId,
      tokens: 0,
    };

    team.tokens += tokens;
    team.costUsd += entry.costUsd ?? 0;
    member.displayName = entry.displayName || member.displayName;
    member.tokens += tokens;
    team.members.set(entry.userId, member);
    teams.set(teamName, team);
  }

  return [...teams.entries()]
    .map(([name, value]) => {
      const previousTokens = previousTokensByTeam.get(name) ?? 0;
      const activeUsers = value.members.size;
      const members = [...value.members.entries()]
        .map(([userId, member]) => ({
          userId,
          displayName: member.displayName,
          tokens: member.tokens,
          share: value.tokens > 0 ? member.tokens / value.tokens : 0,
        }))
        .sort((left, right) => right.tokens - left.tokens || left.displayName.localeCompare(right.displayName));

      return {
        rank: 0,
        name,
        tokens: value.tokens,
        costUsd: value.costUsd,
        activeUsers,
        tokensPerUser: activeUsers > 0 ? value.tokens / activeUsers : 0,
        deltaTokens: previousTokens > 0 ? (value.tokens - previousTokens) / previousTokens : null,
        share: totalTokens > 0 ? value.tokens / totalTokens : 0,
        members,
      };
    })
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

export function buildTokenProjectLeaderboard(
  entries: TokenUsageEvent[],
  limit = PROJECT_LEADERBOARD_LIMIT
): TokenProjectLeaderboardEntry[] {
  const totalTokens = entries.reduce((sum, entry) => sum + getTokenConsumptionTokens(entry), 0);
  const projects = new Map<
    string,
    {
      tokens: number;
      costUsd: number;
      users: Set<string>;
      sessions: Set<string>;
      modelTokens: Map<string, number>;
      other?: boolean;
    }
  >();

  for (const entry of entries) {
    const projectName = normalizeProjectName(entry.project);
    const tokens = getTokenConsumptionTokens(entry);
    const project = projects.get(projectName) ?? {
      tokens: 0,
      costUsd: 0,
      users: new Set<string>(),
      sessions: new Set<string>(),
      modelTokens: new Map<string, number>(),
    };

    project.tokens += tokens;
    project.costUsd += entry.costUsd ?? 0;
    project.users.add(entry.userId);
    project.sessions.add(entry.sessionId || entry.id);
    addMapValue(project.modelTokens, entry.model || "unknown", tokens);
    projects.set(projectName, project);
  }

  const ranked = [...projects.entries()]
    .sort((left, right) => right[1].tokens - left[1].tokens || left[0].localeCompare(right[0]));
  const topProjects = ranked.slice(0, Math.max(1, limit));
  const overflowProjects = ranked.slice(topProjects.length);

  if (overflowProjects.length) {
    const other = {
      tokens: 0,
      costUsd: 0,
      users: new Set<string>(),
      sessions: new Set<string>(),
      modelTokens: new Map<string, number>(),
      other: true,
    };

    for (const [, project] of overflowProjects) {
      other.tokens += project.tokens;
      other.costUsd += project.costUsd;
      for (const userId of project.users) {
        other.users.add(userId);
      }
      for (const sessionId of project.sessions) {
        other.sessions.add(sessionId);
      }
      for (const [model, tokens] of project.modelTokens) {
        addMapValue(other.modelTokens, model, tokens);
      }
    }

    topProjects.push(["其他项目", other]);
  }

  return topProjects
    .map(([name, value]) => ({
      rank: 0,
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      activeUsers: value.users.size,
      sessions: value.sessions.size,
      topModel: topMapEntry(value.modelTokens) || "unknown",
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
      other: value.other || undefined,
    }))
    .map((project, index) => ({ ...project, rank: index + 1 }));
}

export function buildTokenUsageDistribution(entries: TokenUsageEvent[]): TokenUsageDistribution {
  const tokensByUser = new Map<string, number>();

  for (const entry of entries) {
    addMapValue(tokensByUser, entry.userId, getTokenConsumptionTokens(entry));
  }

  const values = [...tokensByUser.values()].filter((value) => value > 0).sort((left, right) => left - right);
  const totalUsers = values.length;
  const buckets = DISTRIBUTION_BUCKET_DEFS.flatMap((bucket) => {
    const count = values.filter((value) =>
      value >= bucket.minTokens && (bucket.maxTokens === null ? true : value < bucket.maxTokens)
    ).length;

    if (!count) {
      return [];
    }

    return [
      {
        ...bucket,
        count,
        share: totalUsers > 0 ? count / totalUsers : 0,
      },
    ];
  });

  return {
    totalUsers,
    maxTokens: values.at(-1) ?? 0,
    percentiles: {
      p50: percentileNearestRank(values, 50),
      p90: percentileNearestRank(values, 90),
      p99: percentileNearestRank(values, 99),
    },
    buckets,
  };
}

const OTHER_TREND_KEY = "__token-board-other__";

type TrendGroupKind = "model" | "user";
type MutableTrendValue = {
  activeUsers: Set<string>;
  costUsd: number;
  key: string;
  label: string;
  linesWritten: number;
  messages: number;
  other?: boolean;
  sessions: Set<string>;
  tokens: number;
};

export function buildTokenLeaderboardTrends(
  entries: TokenUsageEvent[],
  start: Date,
  end: Date,
  limit = TREND_STACK_LIMIT
): { model: TokenTrendBreakdown; user: TokenTrendBreakdown } {
  return {
    model: buildTrendBreakdown(entries, start, end, "model", limit),
    user: buildTrendBreakdown(entries, start, end, "user", limit),
  };
}

function buildTrendBreakdown(
  entries: TokenUsageEvent[],
  start: Date,
  end: Date,
  kind: TrendGroupKind,
  limit: number
): TokenTrendBreakdown {
  const emptyDailySeries = buildEmptyDailySeries(start, end);
  const dailyDateKeys = new Set(emptyDailySeries.map((point) => point.date));
  const supportedDailySeries = emptyDailySeries.slice(-HOURLY_DRILLDOWN_DAYS);
  const supportedDateKeys = new Set(supportedDailySeries.map((point) => point.date));
  const rawTotals = new Map<string, MutableTrendValue>();

  for (const entry of entries) {
    const key = trendGroupKey(entry, kind);
    const value = getOrCreateMutableTrendValue(rawTotals, key, trendGroupLabel(entry, kind));
    addEntryToTrendValue(value, entry);
  }

  const rankedRawSegments = [...rawTotals.values()].sort(
    (left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label)
  );
  const topRawSegments = rankedRawSegments.slice(0, Math.max(1, limit));
  const topKeys = new Set(topRawSegments.map((segment) => segment.key));
  const hasOther = rankedRawSegments.length > topRawSegments.length;
  const orderedKeys = [
    ...topRawSegments.map((segment) => segment.key),
    ...(hasOther ? [OTHER_TREND_KEY] : []),
  ];
  const labelByKey = new Map(topRawSegments.map((segment) => [segment.key, segment.label] as const));
  if (hasOther) {
    labelByKey.set(OTHER_TREND_KEY, "其他");
  }

  const totalValues = new Map<string, MutableTrendValue>();
  const dailyValues = new Map<string, Map<string, MutableTrendValue>>();
  const dailyTotals = new Map<string, MutableTrendValue>();
  const hourlyValues = new Map<string, Map<string, MutableTrendValue>>();
  const hourlyTotals = new Map<string, MutableTrendValue>();

  for (const entry of entries) {
    const date = toDateKey(entry.timestamp);

    if (!dailyDateKeys.has(date)) {
      continue;
    }

    const rawKey = trendGroupKey(entry, kind);
    const key = topKeys.has(rawKey) ? rawKey : OTHER_TREND_KEY;
    const label = labelByKey.get(key) ?? trendGroupLabel(entry, kind);
    const other = key === OTHER_TREND_KEY;

    addEntryToTrendValue(getOrCreateMutableTrendValue(totalValues, key, label, other), entry);
    addEntryToTrendValue(getOrCreateMutableTrendValue(dailyTotals, date, date), entry);

    const dayValues = dailyValues.get(date) ?? new Map<string, MutableTrendValue>();
    addEntryToTrendValue(getOrCreateMutableTrendValue(dayValues, key, label, other), entry);
    dailyValues.set(date, dayValues);

    if (supportedDateKeys.has(date)) {
      const hour = shanghaiHour(entry.timestamp);
      const hourKey = `${date}:${hour}`;
      const hourValues = hourlyValues.get(hourKey) ?? new Map<string, MutableTrendValue>();
      addEntryToTrendValue(getOrCreateMutableTrendValue(hourValues, key, label, other), entry);
      hourlyValues.set(hourKey, hourValues);
      addEntryToTrendValue(getOrCreateMutableTrendValue(hourlyTotals, hourKey, hourKey), entry);
    }
  }

  const totalTokens = [...totalValues.values()].reduce((sum, value) => sum + value.tokens, 0);
  const segments = orderedKeys.flatMap((key, index) => {
    const value = totalValues.get(key);
    const label = labelByKey.get(key) ?? key;

    if (!value && !label) {
      return [];
    }

    return [trendValueToSegment(value ?? createMutableTrendValue(key, label, key === OTHER_TREND_KEY), index + 1, totalTokens)];
  });
  const rankByKey = new Map(segments.map((segment) => [segment.key, segment.rank] as const));

  return {
    daily: emptyDailySeries.map((point) => {
      const total = dailyTotals.get(point.date) ?? createMutableTrendValue(point.date, point.date);
      const values = dailyValues.get(point.date) ?? new Map<string, MutableTrendValue>();

      return {
        ...point,
        tokens: total.tokens,
        costUsd: total.costUsd,
        sessions: total.sessions.size,
        messages: total.messages,
        activeUsers: total.activeUsers.size,
        linesWritten: total.linesWritten,
        segments: orderedKeys.map((key) =>
          trendValueToSegment(
            values.get(key) ??
              createMutableTrendValue(key, labelByKey.get(key) ?? key, key === OTHER_TREND_KEY),
            rankByKey.get(key) ?? orderedKeys.indexOf(key) + 1,
            totalTokens
          )
        ),
      };
    }),
    hourly: supportedDailySeries.map((day) => ({
      date: day.date,
      startAt: day.startAt,
      endAt: day.endAt,
      points: buildHourlyTrendPoints(day.date, start, end, orderedKeys, labelByKey, rankByKey, hourlyValues, hourlyTotals, totalTokens),
    })),
    hourlySupportedDays: HOURLY_DRILLDOWN_DAYS,
    kind,
    limit,
    segments,
  };
}

function buildHourlyTrendPoints(
  date: string,
  rangeStart: Date,
  rangeEnd: Date,
  orderedKeys: string[],
  labelByKey: Map<string, string>,
  rankByKey: Map<string, number>,
  hourlyValues: Map<string, Map<string, MutableTrendValue>>,
  hourlyTotals: Map<string, MutableTrendValue>,
  totalTokens: number
): TokenHourlyTrendPoint[] {
  const dayStart = shanghaiDayStartUtc(date);

  return Array.from({ length: 24 }, (_, hour) => {
    const bucketStart = new Date(dayStart.getTime() + hour * 60 * 60 * 1000);
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
    const clippedStart = new Date(Math.max(bucketStart.getTime(), rangeStart.getTime()));
    const clippedEnd = new Date(Math.min(bucketEnd.getTime(), rangeEnd.getTime()));
    const hourKey = `${date}:${hour}`;
    const total = hourlyTotals.get(hourKey) ?? createMutableTrendValue(hourKey, hourKey);
    const values = hourlyValues.get(hourKey) ?? new Map<string, MutableTrendValue>();

    return {
      date,
      hour,
      startAt: clippedStart.getTime() <= clippedEnd.getTime() ? clippedStart.toISOString() : bucketStart.toISOString(),
      endAt: clippedStart.getTime() <= clippedEnd.getTime() ? clippedEnd.toISOString() : bucketEnd.toISOString(),
      tokens: total.tokens,
      costUsd: total.costUsd,
      sessions: total.sessions.size,
      messages: total.messages,
      activeUsers: total.activeUsers.size,
      linesWritten: total.linesWritten,
      segments: orderedKeys.map((key) =>
        trendValueToSegment(
          values.get(key) ??
            createMutableTrendValue(key, labelByKey.get(key) ?? key, key === OTHER_TREND_KEY),
          rankByKey.get(key) ?? orderedKeys.indexOf(key) + 1,
          totalTokens
        )
      ),
    };
  });
}

function trendGroupKey(entry: TokenUsageEvent, kind: TrendGroupKind) {
  return kind === "model" ? entry.model || "unknown" : entry.userId || "unknown";
}

function trendGroupLabel(entry: TokenUsageEvent, kind: TrendGroupKind) {
  return kind === "model" ? entry.model || "unknown" : entry.displayName || entry.userId || "unknown";
}

function createMutableTrendValue(key: string, label: string, other = false): MutableTrendValue {
  return {
    activeUsers: new Set<string>(),
    costUsd: 0,
    key,
    label,
    linesWritten: 0,
    messages: 0,
    other,
    sessions: new Set<string>(),
    tokens: 0,
  };
}

function getOrCreateMutableTrendValue(
  values: Map<string, MutableTrendValue>,
  key: string,
  label: string,
  other = false
) {
  const current = values.get(key) ?? createMutableTrendValue(key, label, other);
  values.set(key, current);
  return current;
}

function addEntryToTrendValue(value: MutableTrendValue, entry: TokenUsageEvent) {
  value.tokens += getTokenConsumptionTokens(entry);
  value.costUsd += entry.costUsd ?? 0;
  value.messages += entry.messages ?? 0;
  if (entry.linesWritten !== undefined && entry.linesWritten !== null) {
    value.linesWritten += Math.max(0, Math.trunc(entry.linesWritten));
  }
  value.sessions.add(entry.sessionId || entry.id);
  value.activeUsers.add(entry.userId);
}

function trendValueToSegment(value: MutableTrendValue, rank: number, totalTokens: number): TokenTrendSegment {
  return {
    key: value.key,
    label: value.label,
    other: value.other || undefined,
    rank,
    tokens: value.tokens,
    costUsd: value.costUsd,
    sessions: value.sessions.size,
    messages: value.messages,
    activeUsers: value.activeUsers.size,
    linesWritten: value.linesWritten,
    share: totalTokens > 0 ? value.tokens / totalTokens : 0,
  };
}

function aggregateProjectUsage(entries: TokenUsageEvent[]): TokenUsageProjectBreakdown[] {
  const totalTokens = entries.reduce((sum, entry) => sum + getTokenConsumptionTokens(entry), 0);
  const usage = new Map<
    string,
    {
      tokens: number;
      costUsd: number;
      sessions: Set<string>;
      days: Set<string>;
      models: Set<string>;
      lastReportedAt: string;
    }
  >();

  for (const entry of entries) {
    const tokens = getTokenConsumptionTokens(entry);
    const name = entry.project || "未标记项目";
    const current =
      usage.get(name) ??
      {
        tokens: 0,
        costUsd: 0,
        sessions: new Set<string>(),
        days: new Set<string>(),
        models: new Set<string>(),
        lastReportedAt: entry.timestamp,
      };

    current.tokens += tokens;
    current.costUsd += entry.costUsd ?? 0;
    current.sessions.add(entry.sessionId || entry.id);
    current.days.add(toDateKey(entry.timestamp));
    current.models.add(entry.model || "unknown");
    if (new Date(entry.timestamp).getTime() > new Date(current.lastReportedAt).getTime()) {
      current.lastReportedAt = entry.timestamp;
    }
    usage.set(name, current);
  }

  return [...usage.entries()]
    .map(([name, value]) => ({
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      sessions: value.sessions.size,
      activeDays: value.days.size,
      models: value.models.size,
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
      lastReportedAt: value.lastReportedAt,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 18);
}

function aggregateSessionUsage(entries: TokenUsageEvent[]): TokenUsageSessionBreakdown[] {
  const usage = new Map<
    string,
    {
      tokens: number;
      inputTokens: number;
      cacheCreationInputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      costUsd: number;
      messages: number;
      records: number;
      modelTokens: Map<string, number>;
      toolTokens: Map<string, number>;
      projectTokens: Map<string, number>;
      titleTokens: Map<string, number>;
      startAt: string;
      endAt: string;
    }
  >();

  for (const entry of entries) {
    const tokens = getTokenConsumptionTokens(entry);
    const sessionId = entry.sessionId || entry.id;
    const current =
      usage.get(sessionId) ??
      {
        tokens: 0,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        costUsd: 0,
        messages: 0,
        records: 0,
        modelTokens: new Map<string, number>(),
        toolTokens: new Map<string, number>(),
        projectTokens: new Map<string, number>(),
        titleTokens: new Map<string, number>(),
        startAt: entry.timestamp,
        endAt: entry.timestamp,
      };

    current.tokens += tokens;
    current.inputTokens += entry.inputTokens;
    current.cacheCreationInputTokens += entry.cacheCreationInputTokens;
    current.cachedInputTokens += entry.cachedInputTokens;
    current.outputTokens += entry.outputTokens;
    current.reasoningOutputTokens += entry.reasoningOutputTokens;
    current.costUsd += entry.costUsd ?? 0;
    current.messages += entry.messages ?? 0;
    current.records += 1;
    addMapValue(current.modelTokens, entry.model || "unknown", tokens);
    addMapValue(current.toolTokens, entry.tool || entry.source || "unknown", tokens);
    addMapValue(current.projectTokens, entry.project || "未标记项目", tokens);
    if (entry.sessionTitle) {
      addMapValue(current.titleTokens, entry.sessionTitle, tokens);
    }

    const timestamp = new Date(entry.timestamp).getTime();
    if (timestamp < new Date(current.startAt).getTime()) {
      current.startAt = entry.timestamp;
    }
    if (timestamp > new Date(current.endAt).getTime()) {
      current.endAt = entry.timestamp;
    }

    usage.set(sessionId, current);
  }

  return [...usage.entries()]
    .map(([id, value]) => ({
      id,
      title: topOptionalMapEntry(value.titleTokens),
      tokens: value.tokens,
      inputTokens: value.inputTokens,
      cacheCreationInputTokens: value.cacheCreationInputTokens,
      cachedInputTokens: value.cachedInputTokens,
      outputTokens: value.outputTokens,
      reasoningOutputTokens: value.reasoningOutputTokens,
      costUsd: value.costUsd,
      messages: value.messages,
      records: value.records,
      model: topMapEntry(value.modelTokens),
      tool: topMapEntry(value.toolTokens),
      project: topMapEntry(value.projectTokens),
      models: value.modelTokens.size,
      tools: value.toolTokens.size,
      projects: value.projectTokens.size,
      startAt: value.startAt,
      endAt: value.endAt,
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

function buildActivityHeatmap(entries: TokenUsageEvent[]): TokenUsageActivityCell[] {
  const cells = new Map<
    string,
    {
      weekday: number;
      hour: number;
      tokens: number;
      sessions: Set<string>;
      messages: number;
    }
  >();

  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.set(`${weekday}:${hour}`, { weekday, hour, tokens: 0, sessions: new Set<string>(), messages: 0 });
    }
  }

  for (const entry of entries) {
    const { weekday, hour } = getShanghaiWeekdayHour(entry.timestamp);
    const key = `${weekday}:${hour}`;
    const cell = cells.get(key);

    if (!cell) {
      continue;
    }

    cell.tokens += getTokenConsumptionTokens(entry);
    cell.sessions.add(entry.sessionId || entry.id);
    cell.messages += entry.messages ?? 0;
  }

  return [...cells.values()].map((cell) => ({
    weekday: cell.weekday,
    hour: cell.hour,
    tokens: cell.tokens,
    sessions: cell.sessions.size,
    messages: cell.messages,
  }));
}

function topActivityHour(entries: TokenUsageEvent[]) {
  const hours = new Map<number, number>();

  for (const entry of entries) {
    const { hour } = getShanghaiWeekdayHour(entry.timestamp);
    hours.set(hour, (hours.get(hour) ?? 0) + getTokenConsumptionTokens(entry));
  }

  const hour = [...hours.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return hour === undefined ? "--" : `${String(hour).padStart(2, "0")}:00`;
}

function topActivityWeekday(entries: TokenUsageEvent[]) {
  const weekdays = new Map<number, number>();

  for (const entry of entries) {
    const { weekday } = getShanghaiWeekdayHour(entry.timestamp);
    weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + getTokenConsumptionTokens(entry));
  }

  const weekday = [...weekdays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return weekday === undefined ? "--" : WEEKDAY_LABELS[weekday];
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function getShanghaiWeekdayHour(value: string) {
  const time = new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);

  return {
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

function buildDailySeries(entries: TokenUsageEvent[], start: Date, end: Date): TokenDailyUsagePoint[] {
  const values = new Map(buildEmptyDailySeries(start, end).map((point) => [point.date, point]));

  for (const entry of entries) {
    const key = toDateKey(entry.timestamp);
    const point = values.get(key);

    if (point) {
      point.tokens += getTokenConsumptionTokens(entry);
    }
  }

  return [...values.values()];
}

function buildDailySeriesByUser(
  entries: TokenUsageEvent[],
  start: Date,
  end: Date
): Map<string, TokenDailyUsagePoint[]> {
  const emptyDailySeries = buildEmptyDailySeries(start, end);
  const valuesByUser = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    let values = valuesByUser.get(entry.userId);

    if (!values) {
      values = new Map(emptyDailySeries.map((point) => [point.date, 0]));
      valuesByUser.set(entry.userId, values);
    }

    const key = toDateKey(entry.timestamp);
    values.set(key, (values.get(key) ?? 0) + getTokenConsumptionTokens(entry));
  }

  return new Map(
    [...valuesByUser.entries()].map(([userId, values]) => [
      userId,
      emptyDailySeries.map((point) => ({ ...point, tokens: values.get(point.date) ?? 0 })),
    ])
  );
}

function buildEmptyDailySeries(start: Date, end: Date): TokenDailyUsagePoint[] {
  const points: TokenDailyUsagePoint[] = [];
  const startDay = startOfShanghaiDay(start);
  const endDay = startOfShanghaiDay(end);

  for (let time = startDay.getTime(); time <= endDay.getTime(); time += DAY_MS) {
    const bucketStart = new Date(Math.max(time, start.getTime()));
    const bucketEnd = new Date(Math.min(time + DAY_MS - 1, end.getTime()));

    points.push({
      date: toDateKey(new Date(time).toISOString()),
      startAt: bucketStart.toISOString(),
      endAt: bucketEnd.toISOString(),
      tokens: 0,
    });
  }

  return points;
}

function sumTokensByUser(entries: TokenUsageEvent[]) {
  const result = new Map<string, number>();

  for (const entry of entries) {
    result.set(entry.userId, (result.get(entry.userId) ?? 0) + getTokenConsumptionTokens(entry));
  }

  return result;
}

function sumTokensByTeam(entries: TokenUsageEvent[]) {
  const result = new Map<string, number>();

  for (const entry of entries) {
    const teamName = normalizeTeamName(entry.team);
    result.set(teamName, (result.get(teamName) ?? 0) + getTokenConsumptionTokens(entry));
  }

  return result;
}

function normalizeTeamName(value: unknown) {
  return normalizeText(value) || "Friends";
}

function normalizeProjectName(value: unknown) {
  const normalized = normalizeText(value);

  if (!normalized || normalized.toLowerCase() === "none") {
    return UNKNOWN_PROJECT_LABEL;
  }

  return normalized;
}

function percentileNearestRank(sortedAscendingValues: number[], percentile: number) {
  if (!sortedAscendingValues.length) {
    return 0;
  }

  const index = Math.min(
    sortedAscendingValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedAscendingValues.length) - 1)
  );

  return sortedAscendingValues[index] ?? 0;
}

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(field.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

export function estimateCostUsd({
  model,
  inputTokens,
  cacheCreationInputTokens,
  cachedInputTokens,
  outputTokens,
}: {
  model: string;
  inputTokens: number;
  cacheCreationInputTokens?: number;
  cachedInputTokens: number;
  outputTokens: number;
}) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel || normalizedModel === "hidden") {
    return 0;
  }

  const pricing = resolveModelPricing(normalizedModel);
  const cacheReadTokens = Math.max(0, toFiniteNumber(cachedInputTokens));
  const cacheCreationTokens = Math.max(0, toFiniteNumber(cacheCreationInputTokens));
  const billableInputTokens = Math.max(0, toFiniteNumber(inputTokens) - cacheReadTokens - cacheCreationTokens);
  const output = Math.max(0, toFiniteNumber(outputTokens));
  const cacheReadPrice = pricing.cacheReadInput ?? pricing.cachedInput ?? pricing.input * 0.1;
  const cacheCreationPrice = pricing.cacheCreationInput ?? pricing.input * 1.25;

  return (
    (billableInputTokens / 1_000_000) * pricing.input +
    (cacheCreationTokens / 1_000_000) * cacheCreationPrice +
    (cacheReadTokens / 1_000_000) * cacheReadPrice +
    (output / 1_000_000) * pricing.output
  );
}

export function getUnmatchedTokenPricingModels() {
  return [...unmatchedPricingModels].sort();
}

export function clearUnmatchedTokenPricingModels() {
  unmatchedPricingModels.clear();
}

function resolveModelPricing(model: string) {
  const pricing = loadModelPricing().models.find((item) => matchesModelPricing(item, model));

  if (pricing) {
    return pricing;
  }

  unmatchedPricingModels.add(model);
  const fallback = loadModelPricing().fallback;
  return {
    id: "fallback",
    input: fallback.input,
    output: fallback.output,
    cachedInput: fallback.cachedInput,
    cacheReadInput: fallback.cacheReadInput,
    cacheCreationInput: fallback.cacheCreationInput,
  };
}

function loadModelPricing() {
  const filePath = getPricingFilePath();

  if (pricingFileCache && pricingFileCacheKey === filePath) {
    return pricingFileCache;
  }

  const override = filePath ? readPricingFile(filePath) : null;
  pricingFileCacheKey = filePath;
  pricingFileCache = {
    models: [...(override?.models ?? []), ...DEFAULT_MODEL_PRICING],
    fallback: {
      ...DEFAULT_FALLBACK_PRICING,
      ...(override?.fallback ?? {}),
    },
  };
  return pricingFileCache;
}

function readPricingFile(filePath: string): TokenPricingFile | null {
  try {
    const fs = getNodeFs();
    if (!fs) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const pricing = normalizePricingFile(parsed);
    if (pricing.models?.length || pricing.fallback) {
      return pricing;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`TOKEN_BOARD_PRICING_FILE ignored: ${message}`);
  }

  return null;
}

function normalizePricingFile(value: unknown): TokenPricingFile {
  const record = isRecordLike(value) ? value : {};
  const rawModels = Array.isArray(value)
    ? value
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(record.pricing)
        ? record.pricing
        : [];
  const models = rawModels.flatMap((item) => {
    if (!isRecordLike(item)) {
      return [];
    }

    const id = normalizeText(item.id ?? item.model ?? item.name);
    const input = toFiniteNumber(item.input ?? item.inputUsdPerMillion ?? item.input_per_million);
    const output = toFiniteNumber(item.output ?? item.outputUsdPerMillion ?? item.output_per_million);
    if (!id || input <= 0 || output <= 0) {
      return [];
    }

    const aliases = stringList(item.aliases ?? item.models ?? item.exact);
    const startsWith = stringList(item.startsWith ?? item.prefixes ?? item.prefix);
    const includes = stringList(item.includes ?? item.contains ?? item.match);
    return [
      {
        id,
        ...(aliases.length ? { aliases } : {}),
        ...(startsWith.length ? { startsWith } : {}),
        ...(includes.length ? { includes } : {}),
        input,
        output,
        cachedInput: positiveOptionalNumber(item.cachedInput ?? item.cached_input),
        cacheReadInput: positiveOptionalNumber(item.cacheReadInput ?? item.cache_read_input ?? item.cacheRead),
        cacheCreationInput: positiveOptionalNumber(
          item.cacheCreationInput ?? item.cache_creation_input ?? item.cacheWriteInput ?? item.cache_write_input
        ),
        source: normalizeText(item.source) || "custom",
      },
    ];
  });
  const fallbackRecord = isRecordLike(record.fallback) ? record.fallback : {};
  const fallbackInput = positiveOptionalNumber(fallbackRecord.input);
  const fallbackOutput = positiveOptionalNumber(fallbackRecord.output);
  const fallback =
    fallbackInput !== undefined && fallbackOutput !== undefined
      ? {
          input: fallbackInput,
          output: fallbackOutput,
          cachedInput: positiveOptionalNumber(fallbackRecord.cachedInput ?? fallbackRecord.cached_input),
          cacheReadInput: positiveOptionalNumber(fallbackRecord.cacheReadInput ?? fallbackRecord.cache_read_input),
          cacheCreationInput: positiveOptionalNumber(
            fallbackRecord.cacheCreationInput ?? fallbackRecord.cache_creation_input ?? fallbackRecord.cacheWriteInput
          ),
        }
      : undefined;

  return {
    ...(models.length ? { models } : {}),
    ...(fallback ? { fallback } : {}),
  };
}

function matchesModelPricing(pricing: TokenModelPricing, model: string) {
  const aliases = pricing.aliases ?? [pricing.id];
  if (aliases.some((alias) => model === normalizeModelName(alias))) {
    return true;
  }

  if (pricing.startsWith?.some((prefix) => model.startsWith(normalizeModelName(prefix)))) {
    return true;
  }

  return Boolean(pricing.includes?.length && pricing.includes.every((part) => model.includes(normalizeModelName(part))));
}

function normalizeModelName(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function stringList(value: unknown) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map((item) => normalizeModelName(item)).filter(Boolean);
}

function positiveOptionalNumber(value: unknown) {
  const number = toFiniteNumber(value);
  return number > 0 ? number : undefined;
}

function getPricingFilePath() {
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return typeof processLike?.env?.TOKEN_BOARD_PRICING_FILE === "string"
    ? processLike.env.TOKEN_BOARD_PRICING_FILE.trim()
    : "";
}

function getNodeFs(): { readFileSync: (filePath: string, encoding: "utf8") => string } | null {
  const processLike = (globalThis as {
    process?: { getBuiltinModule?: (name: string) => unknown };
  }).process;
  const fs = processLike?.getBuiltinModule?.("fs") ?? processLike?.getBuiltinModule?.("node:fs");
  return isRecordLike(fs) && typeof fs.readFileSync === "function"
    ? (fs as { readFileSync: (filePath: string, encoding: "utf8") => string })
    : null;
}

function addMapValue(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function topMapEntry(map: Map<string, number>) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function topOptionalMapEntry(map: Map<string, number>) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function readField(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined) {
      return record[name];
    }

    const normalizedName = normalizeHeader(name);
    if (record[normalizedName] !== undefined) {
      return record[normalizedName];
    }
  }

  return undefined;
}

function sumImportFields(record: Record<string, unknown>, names: string[]) {
  return names.reduce((sum, name) => sum + toFiniteNumber(readField(record, [name])), 0);
}

function firstImportFieldNumber(record: Record<string, unknown>, names: string[]) {
  let fallback = 0;

  for (const name of names) {
    const value = readField(record, [name]);
    if (value === undefined) {
      continue;
    }
    const number = toFiniteNumber(value);
    if (number > 0) {
      return number;
    }
    fallback = number;
  }

  return fallback;
}

function optionalImportFieldInteger(record: Record<string, unknown>, names: string[]) {
  const value = readField(record, names);
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = toFiniteNumber(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined;
}

function cacheCreationInputTokensFromImportRecord(record: Record<string, unknown>) {
  const total = sumImportFields(record, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
  if (total > 0) {
    return total;
  }

  const cacheCreation = readField(record, ["cache_creation", "cacheCreation"]);
  const nested = isRecordLike(cacheCreation) ? cacheCreation : {};
  return (
    sumImportFields(record, [
      "cache_creation_input_tokens_5m",
      "cacheCreationInputTokens5m",
      "cache_creation_input_tokens_1h",
      "cacheCreationInputTokens1h",
      "ephemeral_5m_input_tokens",
      "ephemeral5mInputTokens",
      "ephemeral_1h_input_tokens",
      "ephemeral1hInputTokens",
    ]) +
    sumImportFields(nested, [
      "ephemeral_5m_input_tokens",
      "ephemeral5mInputTokens",
      "ephemeral_1h_input_tokens",
      "ephemeral1hInputTokens",
    ])
  );
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeHeader(value: string) {
  return value.trim().replace(/[-\s]+(.)?/g, (_, next: string | undefined) => (next ? next.toUpperCase() : ""));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// Returns epoch milliseconds for a parseable date/number input, or null when the
// value is absent, empty, or present-but-unparseable. Numeric/all-digit values are
// treated as epoch seconds (< 1e12) or milliseconds (>= 1e12).
function parseDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+$/.test(trimmed)) {
      const epoch = Number(trimmed);
      return epoch < 1e12 ? epoch * 1000 : epoch;
    }
    const ms = new Date(trimmed).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

function normalizeDate(value: unknown) {
  const ms = parseDateMs(value);
  return new Date(ms ?? Date.now()).toISOString();
}

function toDateKey(value: string | Date) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);

  return `${shifted.getUTCFullYear()}-${padNumber(shifted.getUTCMonth() + 1)}-${padNumber(shifted.getUTCDate())}`;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfShanghaiDay(value: Date) {
  return shanghaiDayStartUtc(toDateKey(value));
}

function startOfShanghaiWeek(value: Date) {
  const dayStart = startOfShanghaiDay(value);
  const shifted = new Date(dayStart.getTime() + SHANGHAI_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;

  return new Date(dayStart.getTime() - daysSinceMonday * DAY_MS);
}

function startOfShanghaiMonth(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);

  return shanghaiMonthStartUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function addShanghaiMonths(value: Date, months: number) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);

  return shanghaiMonthStartUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1 + months);
}

function shanghaiMonthStartUtc(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1) - SHANGHAI_OFFSET_MS);
}

function shanghaiDayStartUtc(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);

  if (!match) {
    return new Date(0);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - SHANGHAI_OFFSET_MS);
}

function shanghaiHour(value: string) {
  const time = new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);

  return shifted.getUTCHours();
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

// Token counts, message counts and costs are never negative; a negative value is
// corrupt/delta-style data and is clamped to 0 so it cannot silently undercount.
function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}
