import {
  buildEmptyTokenAchievementSummary,
  getTokenConsumptionTokens,
  type TokenAccountUsageProfile,
  type TokenBoardMetric,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
} from "@open-token-board/core";

import type { InstallGuidePlatform } from "./types";

export function formatTokens(value: number) {
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000_000) {
    return `${formatCompact(value / 1_000_000_000)}B`;
  }

  if (absValue >= 1_000_000) {
    return `${formatCompact(value / 1_000_000)}M`;
  }

  if (absValue >= 1_000) {
    return `${formatCompact(value / 1_000)}K`;
  }

  return formatNumber(value);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

export function formatUtcRange(startAt: string, endAt: string) {
  return `${formatUtcDateTime(startAt)} - ${formatUtcDateTime(endAt)}`;
}

// The window's `endAt` is just "now", so it makes empty/stale ranges look fresh.
// The latest `lastReportedAt` across ranked users is the real data freshness cutoff.
export function latestReportedAt(summary: TokenLeaderboardSummary): string {
  let latest = 0;
  let latestIso = "";

  for (const user of summary.users) {
    if (!user.lastReportedAt) {
      continue;
    }

    const time = new Date(user.lastReportedAt).getTime();
    if (Number.isFinite(time) && time > latest) {
      latest = time;
      latestIso = user.lastReportedAt;
    }
  }

  return latestIso;
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatUsd(value: number) {
  if (value >= 1_000) {
    return `$${formatCompact(value / 1_000)}K`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function normalizeDailyUsageSeries(value: unknown): TokenLeaderboardUser["daily"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((point) => {
    if (!point || typeof point !== "object") {
      return [];
    }

    const item = point as { date?: unknown; endAt?: unknown; startAt?: unknown; tokens?: unknown };
    const date = typeof item.date === "string" ? item.date : "";
    const startAt = normalizeDailyBucketTime(item.startAt, date, 0);
    const endAt = normalizeDailyBucketTime(item.endAt, date, 1);
    const tokens = typeof item.tokens === "number" && Number.isFinite(item.tokens) ? Math.max(0, item.tokens) : 0;

    return date ? [{ date, startAt, endAt, tokens }] : [];
  });
}

export function sanitizeSvgId(value: string) {
  return `spark-${value.replace(/[^a-zA-Z0-9_-]/g, "") || "daily"}`;
}

export function getUserMetricValue(user: TokenLeaderboardUser, metric: TokenBoardMetric) {
  if (metric === "cost") {
    return user.costUsd;
  }

  if (metric === "sessions") {
    return user.sessions;
  }

  if (metric === "messages") {
    return user.messages;
  }

  return getTokenConsumptionTokens(user);
}

export function normalizeRemoteSummary(summary: TokenLeaderboardSummary, metric: TokenBoardMetric): TokenLeaderboardSummary {
  const users = summary.users
    .map((user) => {
      const normalizedUser = normalizeRemoteLeaderboardUser(user);
      return {
        ...normalizedUser,
        daily: normalizeDailyUsageSeries(normalizedUser.daily),
        tokens: getTokenConsumptionTokens(normalizedUser),
      };
    })
    .sort((left, right) => getUserMetricValue(right, metric) - getUserMetricValue(left, metric) || left.displayName.localeCompare(right.displayName))
    .map((user, index) => ({ ...user, rank: index + 1 }));
  const totalTokens = users.reduce((sum, user) => sum + user.tokens, 0);

  return {
    ...summary,
    daily: normalizeDailyUsageSeries(summary.daily),
    totalTokens,
    users: users.map((user) => ({
      ...user,
      share: totalTokens > 0 ? user.tokens / totalTokens : 0,
    })),
  };
}

function normalizeDailyBucketTime(value: unknown, date: string, dayOffset: number) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);

    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const fallback = new Date(`${date}T00:00:00.000Z`);
  fallback.setUTCDate(fallback.getUTCDate() + dayOffset);

  return Number.isFinite(fallback.getTime()) ? fallback.toISOString() : new Date(0).toISOString();
}

function formatUtcDateTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "--";
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    "UTC",
  ].join(" ");
}

export function normalizeRemoteAccountProfile(profile: TokenAccountUsageProfile): TokenAccountUsageProfile {
  const achievements = normalizeRemoteAchievements(profile);

  return {
    ...profile,
    ...achievements,
    config: normalizeRemoteUserConfig(profile.config),
    daily: normalizeDailyUsageSeries(profile.daily),
    sessions: Array.isArray(profile.sessions) ? profile.sessions.map(normalizeRemoteSession) : [],
    user: profile.user
      ? (() => {
          const normalizedUser = normalizeRemoteLeaderboardUser(profile.user);
          return {
            ...normalizedUser,
            daily: normalizeDailyUsageSeries(normalizedUser.daily),
            tokens: getTokenConsumptionTokens(normalizedUser),
          };
        })()
      : null,
  };
}

function normalizeRemoteLeaderboardUser(user: TokenLeaderboardUser): TokenLeaderboardUser {
  const achievements = normalizeRemoteAchievements(user);

  return {
    ...user,
    ...achievements,
    previousRank: finiteNumberOrNull(user.previousRank),
    rankDelta: finiteNumberOrNull(user.rankDelta),
    inputTokens: finiteNumberOrZero(user.inputTokens),
    cacheCreationInputTokens: finiteNumberOrZero(user.cacheCreationInputTokens),
    cachedInputTokens: finiteNumberOrZero(user.cachedInputTokens),
    outputTokens: finiteNumberOrZero(user.outputTokens),
    reasoningOutputTokens: finiteNumberOrZero(user.reasoningOutputTokens),
    costUsd: finiteNumberOrZero(user.costUsd),
    sessions: finiteNumberOrZero(user.sessions),
    messages: finiteNumberOrZero(user.messages),
    records: finiteNumberOrZero(user.records),
    activeDays: finiteNumberOrZero(user.activeDays),
  };
}

export function normalizeRemoteUserConfig(config: TokenAccountUsageProfile["config"]): TokenAccountUsageProfile["config"] {
  if (!config || typeof config !== "object") {
    return null;
  }

  return {
    updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : new Date().toISOString(),
    agent: config.agent,
    codex: config.codex
      ? {
          model: typeof config.codex.model === "string" ? config.codex.model : undefined,
          modelReasoningEffort:
            typeof config.codex.modelReasoningEffort === "string" ? config.codex.modelReasoningEffort : undefined,
          modelContextWindow: finiteNumberOrUndefined(config.codex.modelContextWindow),
          modelAutoCompactTokenLimit: finiteNumberOrUndefined(config.codex.modelAutoCompactTokenLimit),
          modelCacheContextWindow: finiteNumberOrUndefined(config.codex.modelCacheContextWindow),
          modelMaxContextWindow: finiteNumberOrUndefined(config.codex.modelMaxContextWindow),
          effectiveContextWindowPercent: finiteNumberOrUndefined(config.codex.effectiveContextWindowPercent),
        }
      : undefined,
  };
}

export function normalizeRemoteSession(session: TokenAccountUsageProfile["sessions"][number]): TokenAccountUsageProfile["sessions"][number] {
  return {
    ...session,
    title: typeof session.title === "string" && session.title.trim() ? session.title.trim() : undefined,
    tokens: Number.isFinite(session.tokens) ? session.tokens : 0,
    inputTokens: Number.isFinite(session.inputTokens) ? session.inputTokens : 0,
    cacheCreationInputTokens: Number.isFinite(session.cacheCreationInputTokens) ? session.cacheCreationInputTokens : 0,
    cachedInputTokens: Number.isFinite(session.cachedInputTokens) ? session.cachedInputTokens : 0,
    outputTokens: Number.isFinite(session.outputTokens) ? session.outputTokens : 0,
    reasoningOutputTokens: Number.isFinite(session.reasoningOutputTokens) ? session.reasoningOutputTokens : 0,
    costUsd: Number.isFinite(session.costUsd) ? session.costUsd : 0,
    messages: Number.isFinite(session.messages) ? session.messages : 0,
    records: Number.isFinite(session.records) ? session.records : 0,
    models: Number.isFinite(session.models) ? session.models : 0,
    tools: Number.isFinite(session.tools) ? session.tools : 0,
    projects: Number.isFinite(session.projects) ? session.projects : 0,
  };
}

export function finiteNumberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRemoteAchievements(value: {
  badges?: unknown;
  level?: unknown;
  personalBests?: unknown;
}) {
  const fallback = buildEmptyTokenAchievementSummary();

  return {
    level: isLevelProgress(value.level) ? value.level : fallback.level,
    badges: Array.isArray(value.badges) ? value.badges : fallback.badges,
    personalBests: isPersonalBests(value.personalBests) ? value.personalBests : fallback.personalBests,
  };
}

function isLevelProgress(value: unknown): value is ReturnType<typeof buildEmptyTokenAchievementSummary>["level"] {
  const level = value as ReturnType<typeof buildEmptyTokenAchievementSummary>["level"];

  return Boolean(value && typeof value === "object" && level.current && typeof level.current.name === "string");
}

function isPersonalBests(value: unknown): value is ReturnType<typeof buildEmptyTokenAchievementSummary>["personalBests"] {
  const personalBests = value as ReturnType<typeof buildEmptyTokenAchievementSummary>["personalBests"];

  return (
    Boolean(value && typeof value === "object") &&
    Boolean(personalBests.singleDay) &&
    Boolean(personalBests.rolling7Day) &&
    Boolean(personalBests.longestStreak)
  );
}

function finiteNumberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function formatMetricValue(value: number, metric: TokenBoardMetric) {
  if (metric === "cost") {
    return formatUsd(value);
  }

  if (metric === "sessions" || metric === "messages") {
    return formatNumber(value);
  }

  return formatTokens(value);
}

export function buildLeaderboardInsight(summary: TokenLeaderboardSummary, cacheHitRate: number) {
  const leader = summary.users[0];
  const runnerUp = summary.users[1];
  const peak = summary.daily.reduce(
    (best, point) => (point.tokens > best.tokens ? point : best),
    { date: "", tokens: 0 }
  );
  const parts: string[] = [];

  if (leader && runnerUp) {
    parts.push(`${leader.displayName} 领先 ${runnerUp.displayName} ${formatTokens(Math.max(0, leader.tokens - runnerUp.tokens))}`);
  } else if (leader) {
    parts.push(`${leader.displayName} 暂列榜首`);
  } else {
    parts.push("当前区间还没有可展示的用户");
  }

  if (peak.date) {
    parts.push(`${peak.date.slice(5)} 峰值 ${formatTokens(peak.tokens)}`);
  }

  parts.push(`缓存命中率 ${formatPercent(cacheHitRate)}`);

  if (summary.activeUsers) {
    parts.push(`${formatNumber(summary.activeUsers)} 位参与`);
  }

  return `${parts.join("；")}。`;
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}

export function formatRankDelta(value: number | null) {
  if (value === null) {
    return "--";
  }

  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

export function rankDeltaTone(value: number | null) {
  if (value === null || value === 0) {
    return "text-slate-500";
  }

  return value > 0 ? "text-emerald-600" : "text-red-600";
}

export function heatColor(intensity: number) {
  if (intensity <= 0) {
    return "#f1f5f9";
  }

  if (intensity < 0.18) {
    return "#dbeafe";
  }

  if (intensity < 0.38) {
    return "#bfdbfe";
  }

  if (intensity < 0.62) {
    return "#93c5fd";
  }

  if (intensity < 0.82) {
    return "#60a5fa";
  }

  return "#2563eb";
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatSessionLabel(value: string) {
  const sessionId = value.replace(/^session:/, "") || "unknown";

  return sessionId.length > 22 ? `${sessionId.slice(0, 10)}…${sessionId.slice(-8)}` : sessionId;
}

export function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;

  if (!Number.isFinite(diffMs)) {
    return "--";
  }

  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  for (const [unit, unitMs] of units) {
    if (absMs >= unitMs) {
      return formatter.format(Math.round(-diffMs / unitMs), unit);
    }
  }

  return "刚刚";
}

export function normalizeApiBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") || "";
}

export function detectInstallGuidePlatform(): InstallGuidePlatform {
  if (typeof navigator === "undefined") {
    return "macos";
  }

  const browserNavigator = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = [
    browserNavigator.userAgentData?.platform,
    browserNavigator.platform,
    browserNavigator.userAgent,
  ].join(" ");

  return /win/i.test(platform) ? "windows" : "macos";
}

export function isTokenLeaderboardSummary(value: unknown): value is TokenLeaderboardSummary {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as TokenLeaderboardSummary).users) &&
    Array.isArray((value as TokenLeaderboardSummary).daily)
  );
}

export function isTokenAccountUsageProfile(value: unknown): value is TokenAccountUsageProfile {
  const profile = value as Partial<TokenAccountUsageProfile>;

  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(profile.daily) &&
    Array.isArray(profile.models) &&
    Array.isArray(profile.tools) &&
    Array.isArray(profile.projects) &&
    Array.isArray(profile.heatmap) &&
    (profile.sessions === undefined || Array.isArray(profile.sessions))
  );
}
