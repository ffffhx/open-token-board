import type { TokenUsageEvent } from "./token-leaderboard";

export type TokenLevelDefinition = {
  id: string;
  name: string;
  thresholdTokens: number;
  emoji: string;
  symbol: string;
  color: string;
};

export type TokenLevelProgress = {
  current: TokenLevelDefinition;
  next: TokenLevelDefinition | null;
  totalTokens: number;
  progress: number;
  tokensIntoLevel: number;
  tokensToNext: number | null;
};

export type TokenAchievementBadge = {
  id: string;
  name: string;
  description: string;
  condition: string;
  icon: string;
  achieved: boolean;
  achievedAt: string | null;
  category: "rhythm" | "efficiency" | "model" | "streak" | "volume";
};

export type TokenPersonalBests = {
  singleDay: {
    date: string | null;
    tokens: number;
  };
  rolling7Day: {
    startDate: string | null;
    endDate: string | null;
    tokens: number;
  };
  longestStreak: {
    days: number;
    startDate: string | null;
    endDate: string | null;
  };
  todayTokens: number;
  brokeDailyPbToday: boolean;
};

export type TokenAchievementSummary = {
  level: TokenLevelProgress;
  badges: TokenAchievementBadge[];
  personalBests: TokenPersonalBests;
};

export const TOKEN_LEVELS: TokenLevelDefinition[] = [
  { id: "spark", name: "火花", thresholdTokens: 0, emoji: "✦", symbol: "火", color: "#64748b" },
  { id: "lamp", name: "燃灯", thresholdTokens: 100_000, emoji: "◐", symbol: "灯", color: "#2563eb" },
  { id: "ember", name: "炉心", thresholdTokens: 500_000, emoji: "◆", symbol: "炉", color: "#0891b2" },
  { id: "forge", name: "熔炉", thresholdTokens: 1_000_000, emoji: "◈", symbol: "熔", color: "#d97706" },
  { id: "workshop", name: "星火工坊", thresholdTokens: 3_000_000, emoji: "✺", symbol: "星", color: "#16a34a" },
  { id: "plasma", name: "等离子", thresholdTokens: 10_000_000, emoji: "✹", symbol: "离", color: "#7c3aed" },
  { id: "corona", name: "日冕", thresholdTokens: 30_000_000, emoji: "☼", symbol: "冕", color: "#ea580c" },
  { id: "pulsar", name: "脉冲星", thresholdTokens: 100_000_000, emoji: "✷", symbol: "脉", color: "#db2777" },
  { id: "stargate", name: "星门", thresholdTokens: 300_000_000, emoji: "◎", symbol: "门", color: "#0f766e" },
  { id: "supernova", name: "超新星", thresholdTokens: 1_000_000_000, emoji: "✸", symbol: "超", color: "#dc2626" },
];

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_PERSONAL_BESTS: TokenPersonalBests = {
  singleDay: { date: null, tokens: 0 },
  rolling7Day: { startDate: null, endDate: null, tokens: 0 },
  longestStreak: { days: 0, startDate: null, endDate: null },
  todayTokens: 0,
  brokeDailyPbToday: false,
};

export function buildTokenAchievementSummary(
  entries: TokenUsageEvent[],
  { now = new Date() }: { now?: Date } = {}
): TokenAchievementSummary {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const sortedEntries = [...entries]
    .filter((entry) => Number.isFinite(new Date(entry.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const totalTokens = sortedEntries.reduce((sum, entry) => sum + consumptionTokens(entry), 0);
  const personalBests = buildPersonalBests(sortedEntries, safeNow);

  return {
    level: buildTokenLevelProgress(totalTokens),
    badges: buildAchievementBadges(sortedEntries, totalTokens, personalBests),
    personalBests,
  };
}

export function buildTokenAchievementSummariesByUser(
  entries: TokenUsageEvent[],
  { now = new Date() }: { now?: Date } = {}
): Map<string, TokenAchievementSummary> {
  const entriesByUser = new Map<string, TokenUsageEvent[]>();

  for (const entry of entries) {
    const userEntries = entriesByUser.get(entry.userId) ?? [];
    userEntries.push(entry);
    entriesByUser.set(entry.userId, userEntries);
  }

  return new Map(
    [...entriesByUser.entries()].map(([userId, userEntries]) => [
      userId,
      buildTokenAchievementSummary(userEntries, { now }),
    ])
  );
}

export function buildEmptyTokenAchievementSummary(now = new Date()): TokenAchievementSummary {
  return buildTokenAchievementSummary([], { now });
}

export function buildTokenLevelProgress(totalTokens: number): TokenLevelProgress {
  const safeTotal = Math.max(0, Number.isFinite(totalTokens) ? totalTokens : 0);
  const current =
    [...TOKEN_LEVELS].reverse().find((level) => safeTotal >= level.thresholdTokens) ?? TOKEN_LEVELS[0];
  const currentIndex = TOKEN_LEVELS.findIndex((level) => level.id === current.id);
  const next = TOKEN_LEVELS[currentIndex + 1] ?? null;
  const span = next ? next.thresholdTokens - current.thresholdTokens : 1;
  const tokensIntoLevel = Math.max(0, safeTotal - current.thresholdTokens);

  return {
    current,
    next,
    totalTokens: safeTotal,
    progress: next ? Math.min(1, tokensIntoLevel / Math.max(1, span)) : 1,
    tokensIntoLevel,
    tokensToNext: next ? Math.max(0, next.thresholdTokens - safeTotal) : null,
  };
}

function buildAchievementBadges(
  entries: TokenUsageEvent[],
  totalTokens: number,
  personalBests: TokenPersonalBests
): TokenAchievementBadge[] {
  const totalInputTokens = entries.reduce((sum, entry) => sum + finiteNumber(entry.inputTokens), 0);
  const totalCachedInputTokens = entries.reduce((sum, entry) => sum + finiteNumber(entry.cachedInputTokens), 0);
  const nightTokens = entries.reduce((sum, entry) => sum + (isNightEntry(entry) ? consumptionTokens(entry) : 0), 0);
  const weekendTokens = entries.reduce((sum, entry) => sum + (isWeekendEntry(entry) ? consumptionTokens(entry) : 0), 0);
  const gptTokens = modelTokens(entries, (model) => isGptModel(model));
  const opusTokens = modelTokens(entries, (model) => /opus/i.test(model));
  const cacheRatio = totalInputTokens > 0 ? totalCachedInputTokens / totalInputTokens : 0;
  const nightRatio = totalTokens > 0 ? nightTokens / totalTokens : 0;
  const weekendRatio = totalTokens > 0 ? weekendTokens / totalTokens : 0;
  const gptRatio = totalTokens > 0 ? gptTokens / totalTokens : 0;
  const opusRatio = totalTokens > 0 ? opusTokens / totalTokens : 0;

  return [
    badge({
      id: "night-owl",
      name: "夜猫子",
      description: "深夜也在烧 token。",
      condition: "00:00-06:00 的 token 占比达到 25%，且深夜消耗不少于 50 万。",
      icon: "◑",
      category: "rhythm",
      achieved: nightTokens >= 500_000 && nightRatio >= 0.25,
      achievedAt: firstRatioAchievementAt(entries, {
        minNumerator: 500_000,
        minRatio: 0.25,
        numerator: (entry) => (isNightEntry(entry) ? consumptionTokens(entry) : 0),
        denominator: consumptionTokens,
      }),
    }),
    badge({
      id: "weekend-warrior",
      name: "周末战士",
      description: "别人休息时你还在推进。",
      condition: "周末 token 占比达到 30%，且周末消耗不少于 50 万。",
      icon: "◆",
      category: "rhythm",
      achieved: weekendTokens >= 500_000 && weekendRatio >= 0.3,
      achievedAt: firstRatioAchievementAt(entries, {
        minNumerator: 500_000,
        minRatio: 0.3,
        numerator: (entry) => (isWeekendEntry(entry) ? consumptionTokens(entry) : 0),
        denominator: consumptionTokens,
      }),
    }),
    badge({
      id: "cache-master",
      name: "缓存大师",
      description: "上下文复用效率拉满。",
      condition: "缓存命中率达到 45%，且缓存命中输入不少于 100 万 token。",
      icon: "▣",
      category: "efficiency",
      achieved: totalCachedInputTokens >= 1_000_000 && cacheRatio >= 0.45,
      achievedAt: firstRatioAchievementAt(entries, {
        minNumerator: 1_000_000,
        minRatio: 0.45,
        numerator: (entry) => finiteNumber(entry.cachedInputTokens),
        denominator: (entry) => finiteNumber(entry.inputTokens),
      }),
    }),
    badge({
      id: "gpt-party",
      name: "GPT 党",
      description: "OpenAI 系模型是你的主战场。",
      condition: "GPT / o 系模型 token 占比达到 55%，且相关消耗不少于 50 万。",
      icon: "G",
      category: "model",
      achieved: gptTokens >= 500_000 && gptRatio >= 0.55,
      achievedAt: firstRatioAchievementAt(entries, {
        minNumerator: 500_000,
        minRatio: 0.55,
        numerator: (entry) => (isGptModel(entry.model) ? consumptionTokens(entry) : 0),
        denominator: consumptionTokens,
      }),
    }),
    badge({
      id: "opus-party",
      name: "Opus 党",
      description: "大模型火力直接拉满。",
      condition: "Opus token 占比达到 35%，且 Opus 消耗不少于 30 万。",
      icon: "O",
      category: "model",
      achieved: opusTokens >= 300_000 && opusRatio >= 0.35,
      achievedAt: firstRatioAchievementAt(entries, {
        minNumerator: 300_000,
        minRatio: 0.35,
        numerator: (entry) => (/opus/i.test(entry.model) ? consumptionTokens(entry) : 0),
        denominator: consumptionTokens,
      }),
    }),
    streakBadge("streak-7", "七日热机", "连续打卡 7 天。", 7, personalBests),
    streakBadge("streak-30", "三十日炉温", "连续打卡 30 天。", 30, personalBests),
    streakBadge("streak-100", "百日恒星", "连续打卡 100 天。", 100, personalBests),
    volumeBadge("club-10m", "10M Club", "累计总 token 达到 1,000 万。", 10_000_000, entries, totalTokens),
    volumeBadge("club-100m", "100M Club", "累计总 token 达到 1 亿。", 100_000_000, entries, totalTokens),
    volumeBadge("club-1b", "1B Club", "累计总 token 达到 10 亿。", 1_000_000_000, entries, totalTokens),
  ];
}

function badge(input: TokenAchievementBadge): TokenAchievementBadge {
  return {
    ...input,
    achievedAt: input.achieved ? input.achievedAt : null,
  };
}

function streakBadge(
  id: string,
  name: string,
  description: string,
  days: number,
  personalBests: TokenPersonalBests
): TokenAchievementBadge {
  const achieved = personalBests.longestStreak.days >= days;

  return badge({
    id,
    name,
    description,
    condition: `连续 ${days} 个自然日有 token 上报。`,
    icon: `${days}`,
    category: "streak",
    achieved,
    achievedAt: achieved ? firstStreakAchievementDate(personalBests, days) : null,
  });
}

function volumeBadge(
  id: string,
  name: string,
  description: string,
  threshold: number,
  entries: TokenUsageEvent[],
  totalTokens: number
): TokenAchievementBadge {
  return badge({
    id,
    name,
    description,
    condition: `累计总 token 达到 ${formatThreshold(threshold)}。`,
    icon: threshold >= 1_000_000_000 ? "B" : threshold >= 100_000_000 ? "M+" : "M",
    category: "volume",
    achieved: totalTokens >= threshold,
    achievedAt: firstCumulativeTokenDate(entries, threshold),
  });
}

function buildPersonalBests(entries: TokenUsageEvent[], now: Date): TokenPersonalBests {
  if (!entries.length) {
    return { ...EMPTY_PERSONAL_BESTS };
  }

  const todayKey = toLocalDayKey(now.toISOString());
  const dailyTokens = new Map<string, number>();

  for (const entry of entries) {
    const key = toLocalDayKey(entry.timestamp);
    dailyTokens.set(key, (dailyTokens.get(key) ?? 0) + consumptionTokens(entry));
  }

  const activeDays = [...dailyTokens.keys()].sort();
  const firstDay = activeDays[0] ?? todayKey;
  const lastActivityDay = activeDays[activeDays.length - 1] ?? todayKey;
  const lastDay = maxDayKey(lastActivityDay, todayKey);
  const allDays = enumerateDayKeys(firstDay, lastDay);
  const singleDay = bestDailyRecord(dailyTokens);
  const previousDailyTokens = new Map([...dailyTokens.entries()].filter(([date]) => date !== todayKey));
  const previousSingleDay = bestDailyRecord(previousDailyTokens);
  const todayTokens = dailyTokens.get(todayKey) ?? 0;
  const longestStreak = longestActiveStreak(activeDays);
  const rolling7Day = bestRolling7Day(allDays, dailyTokens);

  return {
    singleDay,
    rolling7Day,
    longestStreak,
    todayTokens,
    brokeDailyPbToday: todayTokens > 0 && todayTokens > previousSingleDay.tokens,
  };
}

function bestDailyRecord(dailyTokens: Map<string, number>): TokenPersonalBests["singleDay"] {
  let bestDate: string | null = null;
  let bestTokens = 0;

  for (const [date, tokens] of dailyTokens) {
    if (tokens > bestTokens || (tokens === bestTokens && bestDate !== null && date < bestDate)) {
      bestDate = date;
      bestTokens = tokens;
    }
  }

  return { date: bestDate, tokens: bestTokens };
}

function bestRolling7Day(
  allDays: string[],
  dailyTokens: Map<string, number>
): TokenPersonalBests["rolling7Day"] {
  let bestStartDate: string | null = null;
  let bestEndDate: string | null = null;
  let bestTokens = 0;

  for (let index = 0; index < allDays.length; index += 1) {
    const startIndex = Math.max(0, index - 6);
    const windowDays = allDays.slice(startIndex, index + 1);
    const tokens = windowDays.reduce((sum, day) => sum + (dailyTokens.get(day) ?? 0), 0);

    if (tokens > bestTokens) {
      bestTokens = tokens;
      bestStartDate = windowDays[0] ?? null;
      bestEndDate = windowDays[windowDays.length - 1] ?? null;
    }
  }

  return {
    startDate: bestStartDate,
    endDate: bestEndDate,
    tokens: bestTokens,
  };
}

function longestActiveStreak(activeDays: string[]): TokenPersonalBests["longestStreak"] {
  if (!activeDays.length) {
    return { days: 0, startDate: null, endDate: null };
  }

  let bestStart = activeDays[0];
  let bestEnd = activeDays[0];
  let currentStart = activeDays[0];
  let currentEnd = activeDays[0];

  for (const day of activeDays.slice(1)) {
    if (dayToTime(day) - dayToTime(currentEnd) === DAY_MS) {
      currentEnd = day;
    } else {
      if (streakLength(currentStart, currentEnd) > streakLength(bestStart, bestEnd)) {
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
      currentStart = day;
      currentEnd = day;
    }
  }

  if (streakLength(currentStart, currentEnd) > streakLength(bestStart, bestEnd)) {
    bestStart = currentStart;
    bestEnd = currentEnd;
  }

  return {
    days: streakLength(bestStart, bestEnd),
    startDate: bestStart,
    endDate: bestEnd,
  };
}

function firstStreakAchievementDate(personalBests: TokenPersonalBests, days: number) {
  if (!personalBests.longestStreak.startDate || personalBests.longestStreak.days < days) {
    return null;
  }

  return addDays(personalBests.longestStreak.startDate, days - 1);
}

function firstCumulativeTokenDate(entries: TokenUsageEvent[], threshold: number) {
  let total = 0;

  for (const entry of entries) {
    total += consumptionTokens(entry);
    if (total >= threshold) {
      return entry.timestamp;
    }
  }

  return null;
}

function firstRatioAchievementAt(
  entries: TokenUsageEvent[],
  {
    denominator,
    minNumerator,
    minRatio,
    numerator,
  }: {
    denominator: (entry: TokenUsageEvent) => number;
    minNumerator: number;
    minRatio: number;
    numerator: (entry: TokenUsageEvent) => number;
  }
) {
  let numeratorTotal = 0;
  let denominatorTotal = 0;

  for (const entry of entries) {
    numeratorTotal += numerator(entry);
    denominatorTotal += denominator(entry);

    if (denominatorTotal > 0 && numeratorTotal >= minNumerator && numeratorTotal / denominatorTotal >= minRatio) {
      return entry.timestamp;
    }
  }

  return null;
}

function modelTokens(entries: TokenUsageEvent[], predicate: (model: string) => boolean) {
  return entries.reduce((sum, entry) => sum + (predicate(entry.model) ? consumptionTokens(entry) : 0), 0);
}

function isGptModel(model: string) {
  return /\b(gpt|o[1-9])/i.test(model);
}

function isNightEntry(entry: TokenUsageEvent) {
  const hour = localDateParts(entry.timestamp).hour;
  return hour >= 0 && hour < 6;
}

function isWeekendEntry(entry: TokenUsageEvent) {
  const weekday = localDateParts(entry.timestamp).weekday;
  return weekday === 0 || weekday === 6;
}

function consumptionTokens(entry: Pick<TokenUsageEvent, "inputTokens" | "outputTokens">) {
  return finiteNumber(entry.inputTokens) + finiteNumber(entry.outputTokens);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function toLocalDayKey(value: string) {
  const { year, month, day } = localDateParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDateParts(value: string) {
  const time = new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

function enumerateDayKeys(startDay: string, endDay: string) {
  const days: string[] = [];
  const endTime = dayToTime(endDay);

  for (let time = dayToTime(startDay); time <= endTime; time += DAY_MS) {
    days.push(timeToDayKey(time));
  }

  return days;
}

function maxDayKey(left: string, right: string) {
  return dayToTime(left) >= dayToTime(right) ? left : right;
}

function addDays(day: string, days: number) {
  return timeToDayKey(dayToTime(day) + days * DAY_MS);
}

function streakLength(startDate: string, endDate: string) {
  return Math.floor((dayToTime(endDate) - dayToTime(startDate)) / DAY_MS) + 1;
}

function dayToTime(day: string) {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

function timeToDayKey(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function formatThreshold(value: number) {
  if (value >= 1_000_000_000) {
    return "10 亿";
  }

  if (value >= 100_000_000) {
    return "1 亿";
  }

  if (value >= 10_000_000) {
    return "1,000 万";
  }

  return String(value);
}
