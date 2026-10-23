import {
  estimateCostUsd,
  getTokenConsumptionTokens,
  type TokenUsageEvent,
} from "./token-leaderboard";

export type TokenGoalType = "daily_tokens" | "weekly_tokens" | "weekly_cost_cap" | "daily_streak";

export type TokenGoalStatus = "in_progress" | "achieved" | "failed";

export type TokenGoal = {
  id: string;
  type: TokenGoalType;
  target: number;
  createdAt: string;
  updatedAt: string;
};

export type TokenGoalEvaluation = {
  goal: TokenGoal;
  status: TokenGoalStatus;
  progress: number;
  target: number;
  percent: number;
  consecutiveSuccessCount: number;
  unit: "day" | "week";
  window: {
    key: string;
    startAt: string;
    endAt: string;
  };
};

export type TokenGoalValidationResult = {
  goals: TokenGoal[];
  errors: string[];
};

export type WeeklyTokenGoalScorecard = {
  weekKey: string;
  usersWithGoals: number;
  goalCount: number;
  achievedUsers: number;
  failedUsers: number;
  pendingUsers: number;
  achievedGoals: number;
  failedGoals: number;
  pendingGoals: number;
  praise: Array<{
    userId: string;
    displayName: string;
    goal: TokenGoal;
    consecutiveSuccessCount: number;
  }>;
};

const GOAL_TYPES = new Set<TokenGoalType>(["daily_tokens", "weekly_tokens", "weekly_cost_cap", "daily_streak"]);
const MAX_GOALS_PER_USER = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function isTokenGoalType(value: unknown): value is TokenGoalType {
  return typeof value === "string" && GOAL_TYPES.has(value as TokenGoalType);
}

export function sanitizeTokenGoals(
  value: unknown,
  {
    createId,
    now = new Date(),
  }: {
    createId?: () => string;
    now?: Date;
  } = {},
): TokenGoalValidationResult {
  const errors: string[] = [];
  const safeNow = safeDate(now);
  const updatedAt = safeNow.toISOString();

  if (value === undefined || value === null) {
    return { goals: [], errors };
  }

  if (!Array.isArray(value)) {
    return { goals: [], errors: ["goals 必须是数组"] };
  }

  if (value.length > MAX_GOALS_PER_USER) {
    errors.push(`每个用户最多设置 ${MAX_GOALS_PER_USER} 个目标`);
  }

  const seenIds = new Set<string>();
  const goals = value.slice(0, MAX_GOALS_PER_USER).flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`第 ${index + 1} 个目标必须是对象`);
      return [];
    }

    const record = item as Record<string, unknown>;
    if (!isTokenGoalType(record.type)) {
      errors.push(`第 ${index + 1} 个目标类型不合法`);
      return [];
    }

    const target = sanitizeGoalTarget(record.target, record.type);
    if (target === null) {
      errors.push(`第 ${index + 1} 个目标数值必须是正数`);
      return [];
    }

    const fallbackId = createId?.() ?? `goal-${index + 1}`;
    let id = sanitizeGoalId(record.id) || fallbackId;
    while (seenIds.has(id)) {
      id = createId?.() ?? `${id}-${seenIds.size + 1}`;
    }
    seenIds.add(id);

    return [
      {
        id,
        type: record.type,
        target,
        createdAt: sanitizeIsoDate(record.createdAt) || updatedAt,
        updatedAt,
      } satisfies TokenGoal,
    ];
  });

  return { goals, errors };
}

export function normalizeStoredTokenGoals(value: unknown): TokenGoal[] {
  return sanitizeTokenGoals(value).goals;
}

export function evaluateTokenGoals(
  goals: TokenGoal[],
  events: TokenUsageEvent[],
  { now = new Date() }: { now?: Date } = {},
): TokenGoalEvaluation[] {
  const stats = buildUsageStats(events, safeDate(now));
  return goals.map((goal) => evaluateTokenGoalFromStats(goal, stats, safeDate(now), false));
}

export function evaluateTokenGoal(
  goal: TokenGoal,
  events: TokenUsageEvent[],
  { now = new Date() }: { now?: Date } = {},
): TokenGoalEvaluation {
  const safeNow = safeDate(now);
  return evaluateTokenGoalFromStats(goal, buildUsageStats(events, safeNow), safeNow, false);
}

export function buildWeeklyTokenGoalScorecard({
  configs,
  events,
  now = new Date(),
}: {
  configs: Array<{ userId: string; displayName?: string; goals: TokenGoal[] }>;
  events: TokenUsageEvent[];
  now?: Date;
}): WeeklyTokenGoalScorecard {
  const safeNow = safeDate(now);
  const weekStartKey = previousShanghaiWeekStartKey(safeNow);
  const weekStart = shanghaiDayStartUtc(weekStartKey);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1);
  const eventsByUser = groupEventsByUser(events.filter((event) => eventTimeMs(event) <= weekEnd.getTime()));
  const names = latestDisplayNames(events);
  const praise: WeeklyTokenGoalScorecard["praise"] = [];
  let usersWithGoals = 0;
  let achievedUsers = 0;
  let failedUsers = 0;
  let pendingUsers = 0;
  let goalCount = 0;
  let achievedGoals = 0;
  let failedGoals = 0;
  let pendingGoals = 0;

  for (const config of configs) {
    const goals = normalizeStoredTokenGoals(config.goals);
    if (!goals.length) {
      continue;
    }

    usersWithGoals += 1;
    goalCount += goals.length;

    const stats = buildUsageStats(eventsByUser.get(config.userId) ?? [], weekEnd);
    const evaluations = goals.map((goal) =>
      evaluateTokenGoalForCompletedWeek(goal, stats, weekStart, weekEnd, weekStartKey)
    );
    const hasFailed = evaluations.some((evaluation) => evaluation.status === "failed");
    const allAchieved = evaluations.every((evaluation) => evaluation.status === "achieved");

    if (allAchieved) {
      achievedUsers += 1;
    } else if (hasFailed) {
      failedUsers += 1;
    } else {
      pendingUsers += 1;
    }

    for (const evaluation of evaluations) {
      if (evaluation.status === "achieved") {
        achievedGoals += 1;
        if (evaluation.consecutiveSuccessCount >= 2) {
          praise.push({
            userId: config.userId,
            displayName: config.displayName || names.get(config.userId) || config.userId,
            goal: evaluation.goal,
            consecutiveSuccessCount: evaluation.consecutiveSuccessCount,
          });
        }
      } else if (evaluation.status === "failed") {
        failedGoals += 1;
      } else {
        pendingGoals += 1;
      }
    }
  }

  return {
    weekKey: weekStartKey,
    usersWithGoals,
    goalCount,
    achievedUsers,
    failedUsers,
    pendingUsers,
    achievedGoals,
    failedGoals,
    pendingGoals,
    praise: praise
      .sort((left, right) => right.consecutiveSuccessCount - left.consecutiveSuccessCount || left.displayName.localeCompare(right.displayName))
      .slice(0, 6),
  };
}

export function currentShanghaiWeekStartKey(value: Date): string {
  const local = new Date(safeDate(value).getTime() + SHANGHAI_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayLocalUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - daysSinceMonday * DAY_MS;
  const monday = new Date(mondayLocalUtcMs);
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

export function previousShanghaiWeekStartKey(value: Date): string {
  return addDaysKey(currentShanghaiWeekStartKey(value), -7);
}

export function shanghaiDayKey(value: Date | string): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  const local = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
}

function evaluateTokenGoalFromStats(
  goal: TokenGoal,
  stats: UsageStats,
  now: Date,
  completedPeriod: boolean,
): TokenGoalEvaluation {
  if (goal.type === "daily_tokens") {
    return evaluateDailyTokensGoal(goal, stats, now);
  }

  if (goal.type === "daily_streak") {
    return evaluateDailyStreakGoal(goal, stats, now);
  }

  return evaluateWeeklyGoal(goal, stats, now, completedPeriod);
}

function evaluateDailyTokensGoal(goal: TokenGoal, stats: UsageStats, now: Date): TokenGoalEvaluation {
  const todayKey = shanghaiDayKey(now);
  const start = shanghaiDayStartUtc(todayKey);
  const end = new Date(start.getTime() + DAY_MS - 1);
  const progress = stats.days.get(todayKey)?.tokens ?? 0;
  const achieved = progress >= goal.target;
  const countFromKey = achieved ? todayKey : addDaysKey(todayKey, -1);
  const consecutiveSuccessCount = countConsecutiveDays(
    countFromKey,
    (dayKey) => isDayOnOrAfterGoalCreated(goal, dayKey) && (stats.days.get(dayKey)?.tokens ?? 0) >= goal.target
  );

  return {
    goal,
    status: achieved ? "achieved" : "in_progress",
    progress,
    target: goal.target,
    percent: percent(progress, goal.target),
    consecutiveSuccessCount,
    unit: "day",
    window: {
      key: todayKey,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    },
  };
}

function evaluateDailyStreakGoal(goal: TokenGoal, stats: UsageStats, now: Date): TokenGoalEvaluation {
  const todayKey = shanghaiDayKey(now);
  const start = shanghaiDayStartUtc(todayKey);
  const end = new Date(start.getTime() + DAY_MS - 1);
  const todayActive = (stats.days.get(todayKey)?.tokens ?? 0) > 0;
  const countFromKey = todayActive ? todayKey : addDaysKey(todayKey, -1);
  const progress = countConsecutiveDays(
    countFromKey,
    (dayKey) => isDayOnOrAfterGoalCreated(goal, dayKey) && (stats.days.get(dayKey)?.tokens ?? 0) > 0
  );

  return {
    goal,
    status: progress >= goal.target ? "achieved" : "in_progress",
    progress,
    target: goal.target,
    percent: percent(progress, goal.target),
    consecutiveSuccessCount: progress,
    unit: "day",
    window: {
      key: todayKey,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    },
  };
}

function evaluateWeeklyGoal(
  goal: TokenGoal,
  stats: UsageStats,
  now: Date,
  completedPeriod: boolean,
): TokenGoalEvaluation {
  const weekKey = currentShanghaiWeekStartKey(now);
  const start = shanghaiDayStartUtc(weekKey);
  const end = new Date(start.getTime() + WEEK_MS - 1);
  const week = weekUsage(stats, start, end);
  const progress = goal.type === "weekly_cost_cap" ? week.costUsd : week.tokens;
  const achieved = goal.type === "weekly_cost_cap" ? completedPeriod && progress <= goal.target : progress >= goal.target;
  const failed = goal.type === "weekly_cost_cap" ? progress > goal.target : completedPeriod && progress < goal.target;
  const currentSuccess = goal.type === "weekly_cost_cap" ? completedPeriod && progress <= goal.target : achieved;
  const countFromKey = currentSuccess ? weekKey : addDaysKey(weekKey, -7);
  const consecutiveSuccessCount = countConsecutiveWeeks(countFromKey, (key) => isWeekGoalSuccessful(goal, stats, key));

  return {
    goal,
    status: achieved ? "achieved" : failed ? "failed" : "in_progress",
    progress,
    target: goal.target,
    percent: goal.type === "weekly_cost_cap" ? percent(progress, goal.target) : percent(progress, goal.target),
    consecutiveSuccessCount,
    unit: "week",
    window: {
      key: weekKey,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    },
  };
}

function evaluateTokenGoalForCompletedWeek(
  goal: TokenGoal,
  stats: UsageStats,
  weekStart: Date,
  weekEnd: Date,
  weekKey: string,
): TokenGoalEvaluation {
  if (goal.type === "weekly_tokens" || goal.type === "weekly_cost_cap") {
    const week = weekUsage(stats, weekStart, weekEnd);
    const progress = goal.type === "weekly_cost_cap" ? week.costUsd : week.tokens;
    const achieved = goal.type === "weekly_cost_cap" ? progress <= goal.target : progress >= goal.target;

    return {
      goal,
      status: achieved ? "achieved" : "failed",
      progress,
      target: goal.target,
      percent: percent(progress, goal.target),
      consecutiveSuccessCount: countConsecutiveWeeks(achieved ? weekKey : addDaysKey(weekKey, -7), (key) =>
        isWeekGoalSuccessful(goal, stats, key)
      ),
      unit: "week",
      window: {
        key: weekKey,
        startAt: weekStart.toISOString(),
        endAt: weekEnd.toISOString(),
      },
    };
  }

  const days = Array.from({ length: 7 }, (_, index) => addDaysKey(weekKey, index)).filter((dayKey) =>
    isDayOnOrAfterGoalCreated(goal, dayKey)
  );
  const progress =
    goal.type === "daily_tokens"
      ? days.filter((dayKey) => (stats.days.get(dayKey)?.tokens ?? 0) >= goal.target).length
      : longestActiveStreakWithinDays(stats, days);
  const target = goal.type === "daily_tokens" ? Math.max(1, days.length) : goal.target;
  const achieved = progress >= target;

  return {
    goal,
    status: achieved ? "achieved" : "failed",
    progress,
    target,
    percent: percent(progress, target),
    consecutiveSuccessCount:
      goal.type === "daily_tokens"
        ? countConsecutiveWeeks(achieved ? weekKey : addDaysKey(weekKey, -7), (key) =>
            isWeekOnOrAfterGoalCreated(goal, key) &&
            Array.from({ length: 7 }, (_, index) => addDaysKey(key, index))
              .filter((dayKey) => isDayOnOrAfterGoalCreated(goal, dayKey))
              .every(
              (dayKey) => (stats.days.get(dayKey)?.tokens ?? 0) >= goal.target
            )
          )
        : countConsecutiveWeeks(achieved ? weekKey : addDaysKey(weekKey, -7), (key) =>
            isWeekOnOrAfterGoalCreated(goal, key) &&
            longestActiveStreakWithinDays(stats, Array.from({ length: 7 }, (_, index) => addDaysKey(key, index))) >= goal.target
          ),
    unit: "week",
    window: {
      key: weekKey,
      startAt: weekStart.toISOString(),
      endAt: weekEnd.toISOString(),
    },
  };
}

function isWeekGoalSuccessful(goal: TokenGoal, stats: UsageStats, weekKey: string) {
  if (!isWeekOnOrAfterGoalCreated(goal, weekKey)) {
    return false;
  }

  const start = shanghaiDayStartUtc(weekKey);
  const end = new Date(start.getTime() + WEEK_MS - 1);
  const week = weekUsage(stats, start, end);

  if (goal.type === "weekly_cost_cap") {
    return week.costUsd <= goal.target;
  }

  return week.tokens >= goal.target;
}

function isDayOnOrAfterGoalCreated(goal: TokenGoal, dayKey: string) {
  return shanghaiDayStartUtc(dayKey).getTime() >= shanghaiDayStartUtc(shanghaiDayKey(goal.createdAt)).getTime();
}

function isWeekOnOrAfterGoalCreated(goal: TokenGoal, weekKey: string) {
  const created = sanitizeIsoDate(goal.createdAt) ? new Date(goal.createdAt) : new Date(0);
  return shanghaiDayStartUtc(weekKey).getTime() >= shanghaiDayStartUtc(currentShanghaiWeekStartKey(created)).getTime();
}

type UsageStats = {
  days: Map<string, { tokens: number; costUsd: number }>;
};

function buildUsageStats(events: TokenUsageEvent[], now: Date): UsageStats {
  const days = new Map<string, { tokens: number; costUsd: number }>();
  const nowMs = now.getTime();

  for (const event of events) {
    const time = eventTimeMs(event);
    if (!Number.isFinite(time) || time > nowMs) {
      continue;
    }

    const key = shanghaiDayKey(new Date(time));
    const current = days.get(key) ?? { tokens: 0, costUsd: 0 };
    current.tokens += safeConsumptionTokens(event);
    current.costUsd += safeCostUsd(event);
    days.set(key, current);
  }

  return { days };
}

function weekUsage(stats: UsageStats, start: Date, end: Date) {
  const startDay = shanghaiDayKey(start);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime() + 1) / DAY_MS));
  let tokens = 0;
  let costUsd = 0;

  for (let index = 0; index < days; index += 1) {
    const day = stats.days.get(addDaysKey(startDay, index));
    tokens += day?.tokens ?? 0;
    costUsd += day?.costUsd ?? 0;
  }

  return { tokens, costUsd };
}

function longestActiveStreakWithinDays(stats: UsageStats, days: string[]) {
  let current = 0;
  let longest = 0;

  for (const dayKey of days) {
    if ((stats.days.get(dayKey)?.tokens ?? 0) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function countConsecutiveDays(fromKey: string, predicate: (dayKey: string) => boolean) {
  let count = 0;
  let cursor = fromKey;

  while (predicate(cursor) && count < 400) {
    count += 1;
    cursor = addDaysKey(cursor, -1);
  }

  return count;
}

function countConsecutiveWeeks(fromKey: string, predicate: (weekKey: string) => boolean) {
  let count = 0;
  let cursor = fromKey;

  while (predicate(cursor) && count < 120) {
    count += 1;
    cursor = addDaysKey(cursor, -7);
  }

  return count;
}

function groupEventsByUser(events: TokenUsageEvent[]) {
  const result = new Map<string, TokenUsageEvent[]>();

  for (const event of events) {
    const current = result.get(event.userId) ?? [];
    current.push(event);
    result.set(event.userId, current);
  }

  return result;
}

function latestDisplayNames(events: TokenUsageEvent[]) {
  const latest = new Map<string, { displayName: string; time: number }>();

  for (const event of events) {
    const time = eventTimeMs(event);
    const current = latest.get(event.userId);
    if (!current || time > current.time) {
      latest.set(event.userId, { displayName: event.displayName || event.userId, time });
    }
  }

  return new Map([...latest].map(([userId, value]) => [userId, value.displayName]));
}

function safeConsumptionTokens(event: TokenUsageEvent) {
  try {
    return getTokenConsumptionTokens(event);
  } catch {
    return Math.max(0, finiteNumber(event.totalTokens));
  }
}

function safeCostUsd(event: TokenUsageEvent) {
  if (typeof event.costUsd === "number" && Number.isFinite(event.costUsd)) {
    return event.costUsd;
  }

  return estimateCostUsd({
    model: event.model,
    inputTokens: event.inputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
  });
}

function sanitizeGoalTarget(value: unknown, type: TokenGoalType) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return type === "daily_streak" ? Math.max(1, Math.floor(number)) : number;
}

function sanitizeGoalId(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(normalized) ? normalized : "";
}

function sanitizeIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function percent(progress: number, target: number) {
  if (!Number.isFinite(progress) || !Number.isFinite(target) || target <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, progress / target));
}

function eventTimeMs(event: TokenUsageEvent) {
  return Date.parse(event.timestamp);
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function safeDate(value: Date) {
  return Number.isFinite(value.getTime()) ? value : new Date();
}

function shanghaiDayStartUtc(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) {
    return new Date(0);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - SHANGHAI_OFFSET_MS);
}

function addDaysKey(dayKey: string, days: number) {
  return shanghaiDayKey(new Date(shanghaiDayStartUtc(dayKey).getTime() + days * DAY_MS + SHANGHAI_OFFSET_MS));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
