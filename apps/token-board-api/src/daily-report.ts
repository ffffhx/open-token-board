import { createHmac } from "node:crypto";

import {
  buildTokenAchievementSummariesByUser,
  type TokenGoalEvaluation,
  type TokenGoalType,
  type TokenAchievementBadge,
  type TokenLeaderboardSummary,
  type WeeklyTokenGoalScorecard,
  type TokenUsageEvent,
} from "@open-token-board/core";

/**
 * Daily leaderboard digest pushed to a Feishu (Lark) custom-bot webhook.
 *
 * Pure data in, an interactive card out — no headless browser, no app
 * credentials. Everything here is side-effect free except `sendFeishuCard`,
 * which performs the single outbound POST.
 */

export type DailyReportConfig = {
  webhookUrl: string;
  /** Optional "签名校验" secret configured on the custom bot. */
  secret?: string;
  /** Minutes east of UTC used to render date labels (e.g. 480 for UTC+8). */
  tzOffsetMinutes: number;
  /** Public site URL linked in the card footer. */
  siteUrl?: string;
  timeoutMs?: number;
};

const RANGE_LABEL: Record<string, string> = {
  "1D": "近 24 小时",
  "7D": "近 7 天",
  "30D": "近 30 天",
  "90D": "近 90 天",
  week: "本周",
  month: "本月",
  lastweek: "上周",
  lastmonth: "上月",
  custom: "自定义区间",
};

const MEDALS = ["🥇", "🥈", "🥉"];
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportStateSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  dayKey: string;
  users: ReportUserSnapshot[];
};

export type ReportUserSnapshot = {
  userId: string;
  displayName: string;
  dailyTokens: number;
  levelId: string;
  levelName: string;
  levelThresholdTokens: number;
  achievedBadges: Array<{ id: string; name: string; icon: string; category: TokenAchievementBadge["category"] }>;
  singleDayPbDate: string | null;
  singleDayPbTokens: number;
  todayTokens: number;
  ranks: {
    daily?: number;
    weekly?: number;
  };
  goals: ReportGoalSnapshot[];
};

export type ReportGoalSnapshot = {
  id: string;
  type: TokenGoalType;
  target: number;
  status: TokenGoalEvaluation["status"];
  progress: number;
  percent: number;
  consecutiveSuccessCount: number;
  unit: TokenGoalEvaluation["unit"];
  windowKey: string;
  windowEndAt: string;
};

export type DailyReportEvent = {
  type: "pb" | "level" | "badge" | "overtake" | "goal";
  priority: number;
  content: string;
};

export type WeeklyReportHighlight = {
  type: "pb" | "level";
  priority: number;
  content: string;
};

export type DailyQuotaAlert = {
  userId: string;
  displayName: string;
  remainingPercent: number;
  etaAt: string | null;
  toolLabel?: string;
};

export type DailyQuotaStaleUser = {
  userId: string;
  displayName: string;
  ageHours: number;
};

export type DailyQuotaAlertSection = {
  thresholdPercent: number;
  alerts: DailyQuotaAlert[];
  staleUsers: DailyQuotaStaleUser[];
};

export function formatCompact(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function formatUsd(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Render a YYYY-MM-DD(...) ISO instant as `M/D` in the configured timezone. */
export function formatDateLabel(iso: string, tzOffsetMinutes: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + tzOffsetMinutes * 60_000);
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()}`;
}

function pct(share: number): string {
  return `${Math.round((Number.isFinite(share) ? share : 0) * 100)}%`;
}

/** Build the Feishu interactive-card payload for a whole-board daily digest. */
export function buildDailyReportCard(
  summary: TokenLeaderboardSummary,
  options: { tzOffsetMinutes: number; siteUrl?: string; events?: DailyReportEvent[]; quotaAlerts?: DailyQuotaAlertSection },
): Record<string, unknown> {
  const { tzOffsetMinutes, siteUrl, events = [], quotaAlerts } = options;
  const rangeLabel = RANGE_LABEL[summary.range] ?? summary.range;
  const start = formatDateLabel(summary.startAt, tzOffsetMinutes);
  const end = formatDateLabel(summary.endAt, tzOffsetMinutes);
  const dateRange = start && end ? (start === end ? end : `${start}–${end}`) : "";
  const topModel = summary.activeUsers > 0 && summary.topModel !== "unknown" ? summary.topModel : "";
  const topTool = summary.activeUsers > 0 && summary.topTool !== "unknown" ? summary.topTool : "";

  const MAX_DETAIL = 10;
  const detailUsers = summary.users.slice(0, MAX_DETAIL);
  const detailLines = detailUsers.length
    ? detailUsers
        .map((user, index) => {
          const medal = MEDALS[index] ?? `#${user.rank}`;
          const rankMove = formatRankMove(user.rankDelta);
          const level = user.level.current.symbol || user.level.current.emoji || "";
          const levelMark = level ? `【${escapeMd(level)}】` : "";
          const head = `${medal} ${levelMark} **${escapeMd(user.displayName)}** ${rankMove} · ${formatCompact(user.tokens)} tokens (${pct(user.share)})`;
          const model = user.topModel ? escapeMd(user.topModel) : "—";
          const tool = user.topTool ? ` / ${escapeMd(user.topTool)}` : "";
          // Per-user detail line: cost · sessions · top model/tool.
          const sub = `　└ 四类估算 ${formatUsd(user.costUsd)} · ${formatCompact(user.sessions)} 会话 · ${model}${tool}`;
          return `${head}\n${sub}`;
        })
        .join("\n")
    : "_今日暂无上榜数据_";
  const restCount = summary.users.length - detailUsers.length;
  const detailFooter = restCount > 0 ? `\n_…等共 ${summary.users.length} 位选手_` : "";

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${rangeLabel}**${dateRange ? ` · ${dateRange}` : ""} · 共 **${summary.activeUsers}** 位选手`,
      },
    },
    {
      tag: "div",
      fields: [
        shortField("📦 总消耗", `${formatCompact(summary.totalTokens)} tokens`),
        shortField("💰 四类估算成本", formatUsd(summary.totalCostUsd)),
        shortField("💬 总会话", formatCompact(summary.totalSessions)),
        shortField("🤖 主力模型", topModel || "—"),
      ],
    },
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `🎬 **今日事件**\n${formatDailyEventLines(events)}` } },
  ];

  if (shouldRenderQuotaAlerts(quotaAlerts)) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `🚨 **额度预警**\n${formatQuotaAlertLines(quotaAlerts, tzOffsetMinutes)}`,
      },
    });
  }

  elements.push({ tag: "hr" });
  elements.push({ tag: "div", text: { tag: "lark_md", content: `🏆 **排行榜 · 个人明细**\n${detailLines}${detailFooter}` } });

  if (topModel || topTool) {
    const bits: string[] = [];
    if (topModel) bits.push(`主力模型 \`${escapeMd(topModel)}\``);
    if (topTool) bits.push(`主力工具 \`${escapeMd(topTool)}\``);
    elements.push({ tag: "hr" });
    elements.push({ tag: "div", text: { tag: "lark_md", content: `✨ **今日亮点**\n${bits.join(" · ")}` } });
  }

  const noteText = siteUrl ? `open-token-board · 自动推送 · ${siteUrl}` : "open-token-board · 自动推送";
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: noteText }] });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "📊 每日 Token 战报" },
      },
      elements,
    },
  };
}

/** Build the Feishu interactive-card payload for a 7-day weekly digest. */
export function buildWeeklyReportCard(
  summary: TokenLeaderboardSummary,
  previousSummary: TokenLeaderboardSummary,
  options: { tzOffsetMinutes: number; siteUrl?: string; highlights?: WeeklyReportHighlight[]; goalScorecard?: WeeklyTokenGoalScorecard },
): Record<string, unknown> {
  const { tzOffsetMinutes, siteUrl, highlights = [], goalScorecard } = options;
  const start = formatDateLabel(summary.startAt, tzOffsetMinutes);
  const end = formatDateLabel(summary.endAt, tzOffsetMinutes);
  const dateRange = start && end ? (start === end ? end : `${start}–${end}`) : "";
  const champion = summary.users[0];
  const championText = champion
    ? `${champion.level.current.symbol ? `【${escapeMd(champion.level.current.symbol)}】` : ""}${escapeMd(champion.displayName)} · ${formatCompact(champion.tokens)} tokens`
    : "暂无";
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**7 天窗口**${dateRange ? ` · ${dateRange}` : ""} · 共 **${summary.activeUsers}** 位选手`,
      },
    },
    {
      tag: "div",
      fields: [
        shortField("👑 周冠军", championText),
        shortField("📦 周总量", `${formatCompact(summary.totalTokens)} tokens`),
        shortField("💰 四类估算成本", formatUsd(summary.totalCostUsd)),
        shortField("📈 环比上周", `${formatChange(summary.totalTokens, previousSummary.totalTokens)} / ${formatChange(summary.totalCostUsd, previousSummary.totalCostUsd)}`),
      ],
    },
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `📊 **每日趋势**\n${formatWeeklyTrend(summary, tzOffsetMinutes)}` } },
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `🔥 **本周荣誉**\n${formatWeeklyHighlightLines(highlights)}` } },
  ];

  if (goalScorecard && goalScorecard.usersWithGoals > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "div", text: { tag: "lark_md", content: `🎯 **目标成绩单**\n${formatWeeklyGoalScorecard(goalScorecard)}` } });
  }

  const topUsers = summary.users.slice(0, 5);
  if (topUsers.length) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `🏁 **周榜 Top5**\n${topUsers
          .map((user, index) => {
            const medal = MEDALS[index] ?? `#${user.rank}`;
            const level = user.level.current.symbol ? `【${escapeMd(user.level.current.symbol)}】` : "";
            return `${medal} ${level}${escapeMd(user.displayName)} · ${formatCompact(user.tokens)} tokens · ${formatUsd(user.costUsd)}`;
          })
          .join("\n")}`,
      },
    });
  }

  const noteText = siteUrl ? `open-token-board · 自动周报 · ${siteUrl}` : "open-token-board · 自动周报";
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: noteText }] });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: "📈 每周 Token 周报" },
      },
      elements,
    },
  };
}

export function buildReportStateSnapshot({
  dailySummary,
  weeklySummary,
  generatedAt,
  dayKey,
  goalEvaluationsByUser,
}: {
  dailySummary: TokenLeaderboardSummary;
  weeklySummary: TokenLeaderboardSummary;
  generatedAt: string;
  dayKey: string;
  goalEvaluationsByUser?: Map<string, TokenGoalEvaluation[]>;
}): ReportStateSnapshot {
  const users = new Map<string, ReportUserSnapshot>();

  for (const user of weeklySummary.users) {
    users.set(user.userId, snapshotUser(user, 0, undefined, user.rank, goalEvaluationsByUser?.get(user.userId) ?? []));
  }

  for (const user of dailySummary.users) {
    const existing = users.get(user.userId);
    users.set(user.userId, snapshotUser(user, user.tokens, user.rank, existing?.ranks.weekly, goalEvaluationsByUser?.get(user.userId) ?? []));
  }

  return {
    schemaVersion: 1,
    generatedAt,
    dayKey,
    users: [...users.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}

export function detectDailyReportEvents(
  current: ReportStateSnapshot,
  previous: ReportStateSnapshot | null | undefined,
): DailyReportEvent[] {
  if (!previous) {
    return [];
  }

  const previousUsers = new Map(previous.users.map((user) => [user.userId, user]));
  const pbEvents: DailyReportEvent[] = [];
  const levelEvents: DailyReportEvent[] = [];
  const badgeEvents: DailyReportEvent[] = [];
  const goalEvents: DailyReportEvent[] = [];
  const overtakeEvents: DailyReportEvent[] = [];

  for (const user of current.users) {
    const prior = previousUsers.get(user.userId);
    if (!prior || user.dailyTokens <= 0) {
      continue;
    }

    if (
      prior.singleDayPbTokens > 0 &&
      user.todayTokens === user.singleDayPbTokens &&
      user.singleDayPbTokens > prior.singleDayPbTokens
    ) {
      const gainRatio = user.singleDayPbTokens / Math.max(1, prior.singleDayPbTokens);
      pbEvents.push({
        type: "pb",
        priority: 4_000 + gainRatio,
        content: `🏆 ${escapeMd(user.displayName)} 刷新单日 PB：${formatCompact(user.singleDayPbTokens)}（旧纪录 ${formatCompact(prior.singleDayPbTokens)}）`,
      });
    }

    if (user.levelThresholdTokens > prior.levelThresholdTokens) {
      levelEvents.push({
        type: "level",
        priority: 3_000 + Math.log10(Math.max(10, user.levelThresholdTokens)),
        content: `⬆️ ${escapeMd(user.displayName)} 升级到「${escapeMd(user.levelName)}」`,
      });
    }

    const priorBadgeIds = new Set(prior.achievedBadges.map((badge) => badge.id));
    for (const badge of user.achievedBadges) {
      if (priorBadgeIds.has(badge.id)) {
        continue;
      }
      badgeEvents.push({
        type: "badge",
        priority: 2_000 + badgePriority(badge.category, badge.id),
        content: `🎖️ ${escapeMd(user.displayName)} 新点亮「${escapeMd(badge.icon ? `${badge.icon} ${badge.name}` : badge.name)}」`,
      });
    }

    const priorGoals = new Map((prior.goals ?? []).map((goal) => [goal.id, goal]));
    for (const goal of user.goals ?? []) {
      const priorGoal = priorGoals.get(goal.id);
      if (isDailyGoalType(goal.type) && goal.status === "achieved" && isGoalMilestone(goal.consecutiveSuccessCount)) {
        if ((priorGoal?.consecutiveSuccessCount ?? 0) < goal.consecutiveSuccessCount) {
          goalEvents.push({
            type: "goal",
            priority: 2_500 + goal.consecutiveSuccessCount,
            content: `🎯 ${escapeMd(user.displayName)} 连续 ${goal.consecutiveSuccessCount} 天达成「${escapeMd(formatGoalName(goal.type, goal.target))}」目标`,
          });
        }
      }

      if (
        goal.type === "weekly_tokens" &&
        goal.status === "achieved" &&
        priorGoal?.status !== "achieved" &&
        Date.parse(goal.windowEndAt) > Date.parse(current.generatedAt)
      ) {
        goalEvents.push({
          type: "goal",
          priority: 2_400 + Math.min(100, goal.percent * 100),
          content: `🎯 ${escapeMd(user.displayName)} 提前达成本周目标「${escapeMd(formatGoalName(goal.type, goal.target))}」`,
        });
      }
    }
  }

  overtakeEvents.push(...detectOvertakeEvents(current, previous, "daily"));
  overtakeEvents.push(...detectOvertakeEvents(current, previous, "weekly"));

  return [
    ...topEvents(pbEvents, 3),
    ...topEvents(levelEvents, 3),
    ...topEvents(badgeEvents, 3),
    ...topEvents(goalEvents, 4),
    ...topEvents(overtakeEvents, 3),
  ].sort((left, right) => right.priority - left.priority);
}

export function buildWeeklyReportHighlights(
  events: TokenUsageEvent[],
  { now = new Date(), tzOffsetMinutes }: { now?: Date; tzOffsetMinutes: number },
): WeeklyReportHighlight[] {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const start = new Date(safeNow.getTime() - 7 * DAY_MS);
  const currentEntries = events.filter((event) => isFiniteTime(event.timestamp) && new Date(event.timestamp).getTime() <= safeNow.getTime());
  const previousEntries = currentEntries.filter((event) => new Date(event.timestamp).getTime() < start.getTime());
  const currentAchievements = buildTokenAchievementSummariesByUser(currentEntries, { now: safeNow });
  const previousAchievements = buildTokenAchievementSummariesByUser(previousEntries, { now: start });
  const names = latestDisplayNames(currentEntries);
  const startDay = localDayKey(start, tzOffsetMinutes);
  const endDay = localDayKey(safeNow, tzOffsetMinutes);
  const highlights: WeeklyReportHighlight[] = [];

  for (const [userId, current] of currentAchievements) {
    const previous = previousAchievements.get(userId);
    const name = names.get(userId) ?? userId;

    if (
      current.personalBests.singleDay.date &&
      current.personalBests.singleDay.date >= startDay &&
      current.personalBests.singleDay.date <= endDay &&
      current.personalBests.singleDay.tokens > (previous?.personalBests.singleDay.tokens ?? 0)
    ) {
      const oldTokens = previous?.personalBests.singleDay.tokens ?? 0;
      highlights.push({
        type: "pb",
        priority: 2_000 + current.personalBests.singleDay.tokens / Math.max(1, oldTokens || 1),
        content: `🏆 ${escapeMd(name)} 本周单日 PB ${formatCompact(current.personalBests.singleDay.tokens)}${oldTokens > 0 ? `（旧 ${formatCompact(oldTokens)}）` : ""}`,
      });
    }

    if (current.level.current.thresholdTokens > (previous?.level.current.thresholdTokens ?? 0)) {
      highlights.push({
        type: "level",
        priority: 1_000 + current.level.current.thresholdTokens,
        content: `⬆️ ${escapeMd(name)} 本周升至「${escapeMd(current.level.current.name)}」`,
      });
    }
  }

  return topEvents(highlights, 8);
}

function shortField(label: string, value: string): Record<string, unknown> {
  return { is_short: true, text: { tag: "lark_md", content: `**${label}**\n${value}` } };
}

function snapshotUser(
  user: TokenLeaderboardSummary["users"][number],
  dailyTokens: number,
  dailyRank: number | undefined,
  weeklyRank: number | undefined,
  goals: TokenGoalEvaluation[],
): ReportUserSnapshot {
  return {
    userId: user.userId,
    displayName: user.displayName,
    dailyTokens,
    levelId: user.level.current.id,
    levelName: user.level.current.name,
    levelThresholdTokens: user.level.current.thresholdTokens,
    achievedBadges: user.badges
      .filter((badge) => badge.achieved)
      .map((badge) => ({
        id: badge.id,
        name: badge.name,
        icon: badge.icon,
        category: badge.category,
      })),
    singleDayPbDate: user.personalBests.singleDay.date,
    singleDayPbTokens: user.personalBests.singleDay.tokens,
    todayTokens: user.personalBests.todayTokens,
    ranks: {
      ...(dailyRank ? { daily: dailyRank } : {}),
      ...(weeklyRank ? { weekly: weeklyRank } : {}),
    },
    goals: goals.map(snapshotGoal),
  };
}

function snapshotGoal(evaluation: TokenGoalEvaluation): ReportGoalSnapshot {
  return {
    id: evaluation.goal.id,
    type: evaluation.goal.type,
    target: evaluation.goal.target,
    status: evaluation.status,
    progress: evaluation.progress,
    percent: evaluation.percent,
    consecutiveSuccessCount: evaluation.consecutiveSuccessCount,
    unit: evaluation.unit,
    windowKey: evaluation.window.key,
    windowEndAt: evaluation.window.endAt,
  };
}

function detectOvertakeEvents(
  current: ReportStateSnapshot,
  previous: ReportStateSnapshot,
  range: "daily" | "weekly",
): DailyReportEvent[] {
  const label = range === "daily" ? "日榜" : "7 天榜";
  const previousUsers = new Map(previous.users.map((user) => [user.userId, user]));
  const currentByUser = new Map(current.users.map((user) => [user.userId, user]));
  const events: DailyReportEvent[] = [];

  for (const user of current.users) {
    const currentRank = user.ranks[range];
    const priorRank = previousUsers.get(user.userId)?.ranks[range];

    if (!currentRank || !priorRank || currentRank > 5 || priorRank <= currentRank) {
      continue;
    }

    const target = previous.users
      .filter((candidate) => candidate.userId !== user.userId)
      .map((candidate) => {
        const candidatePriorRank = candidate.ranks[range];
        const candidateCurrentRank = currentByUser.get(candidate.userId)?.ranks[range];
        return {
          candidate,
          candidatePriorRank,
          candidateCurrentRank,
        };
      })
      .filter(
        ({ candidatePriorRank, candidateCurrentRank }) =>
          candidatePriorRank !== undefined &&
          candidateCurrentRank !== undefined &&
          candidatePriorRank < priorRank &&
          candidateCurrentRank > currentRank &&
          (candidatePriorRank <= 5 || currentRank <= 5),
      )
      .sort((left, right) => {
        const leftSeatDistance = Math.abs((left.candidatePriorRank ?? 99) - currentRank);
        const rightSeatDistance = Math.abs((right.candidatePriorRank ?? 99) - currentRank);
        return leftSeatDistance - rightSeatDistance || (left.candidatePriorRank ?? 99) - (right.candidatePriorRank ?? 99);
      })[0]?.candidate;

    if (!target) {
      continue;
    }

    events.push({
      type: "overtake",
      priority: 1_000 + (range === "daily" ? 100 : 0) + (6 - currentRank) * 10 + (priorRank - currentRank),
      content: `⚔️ ${escapeMd(user.displayName)} 超越 ${escapeMd(target.displayName)} 升至第 ${currentRank}（${label}）`,
    });
  }

  return events;
}

function formatDailyEventLines(events: DailyReportEvent[]) {
  if (!events.length) {
    return "_今日暂无荣誉事件，排行榜还在蓄力。_";
  }

  return events.map((event) => event.content).join("\n");
}

function shouldRenderQuotaAlerts(quotaAlerts: DailyQuotaAlertSection | undefined) {
  return Boolean(quotaAlerts && (quotaAlerts.alerts.length || quotaAlerts.staleUsers.length));
}

function formatQuotaAlertLines(quotaAlerts: DailyQuotaAlertSection | undefined, tzOffsetMinutes: number) {
  if (!quotaAlerts) {
    return "";
  }

  const alertLines = quotaAlerts.alerts.map((alert) => {
    const tool = alert.toolLabel ? ` · ${escapeMd(alert.toolLabel)}` : "";
    return `⚠️ **${escapeMd(alert.displayName)}**${tool} · 剩余 ${formatPercentValue(alert.remainingPercent)} · 预计 ${formatQuotaEta(alert.etaAt, tzOffsetMinutes)} 耗尽`;
  });
  const staleLine = quotaAlerts.staleUsers.length
    ? `_数据过旧（>24h）未计入：${quotaAlerts.staleUsers
        .map((user) => `${escapeMd(user.displayName)} ${Math.max(24, Math.round(user.ageHours))}h`)
        .join("、")}_`
    : "";

  return [...alertLines, staleLine].filter(Boolean).join("\n");
}

function formatQuotaEta(etaAt: string | null, tzOffsetMinutes: number) {
  if (!etaAt) {
    return "暂无法估算";
  }

  const ms = Date.parse(etaAt);
  if (!Number.isFinite(ms)) {
    return "暂无法估算";
  }

  const local = new Date(ms + tzOffsetMinutes * 60_000);
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()} ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function formatPercentValue(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.max(0, Math.min(100, safe)).toFixed(safe < 10 && safe % 1 !== 0 ? 1 : 0)}%`;
}

function formatWeeklyHighlightLines(highlights: WeeklyReportHighlight[]) {
  if (!highlights.length) {
    return "_本周暂无升级或 PB，先把炉温养起来。_";
  }

  return highlights.map((event) => event.content).join("\n");
}

function formatWeeklyGoalScorecard(scorecard: WeeklyTokenGoalScorecard) {
  const summary = `本周 ${scorecard.usersWithGoals} 人设置 ${scorecard.goalCount} 个目标：达成 ${scorecard.achievedGoals} 个，未达成 ${scorecard.failedGoals} 个${scorecard.pendingGoals ? `，进行中 ${scorecard.pendingGoals} 个` : ""}。`;
  const userSummary = `达成全部目标 ${scorecard.achievedUsers} 人；有目标未达成 ${scorecard.failedUsers} 人。`;
  const praise = scorecard.praise.length
    ? `\n连续达成：${scorecard.praise
        .map((item) => `${escapeMd(item.displayName)} 连续 ${item.consecutiveSuccessCount} 周「${escapeMd(formatGoalName(item.goal.type, item.goal.target))}」`)
        .join("；")}`
    : "";

  return `${summary}\n${userSummary}${praise}`;
}

function formatWeeklyTrend(summary: TokenLeaderboardSummary, tzOffsetMinutes: number) {
  const points = summary.daily.slice(-7);
  const maxTokens = Math.max(...points.map((point) => point.tokens), 0);

  if (!points.length || maxTokens <= 0) {
    return "_暂无趋势数据_";
  }

  return points
    .map((point) => {
      const length = Math.max(1, Math.round((point.tokens / maxTokens) * 12));
      const bar = point.tokens > 0 ? "▇".repeat(length) : "·";
      return `${formatDateLabel(point.startAt, tzOffsetMinutes)} ${bar} ${formatCompact(point.tokens)}`;
    })
    .join("\n");
}

function formatRankMove(rankDelta: number | null) {
  if (rankDelta === null || rankDelta === 0) return "→";
  return rankDelta > 0 ? `↑${rankDelta}` : `↓${Math.abs(rankDelta)}`;
}

function formatChange(current: number, previous: number) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrevious = Number.isFinite(previous) ? previous : 0;

  if (safePrevious <= 0) {
    return safeCurrent > 0 ? "新增" : "持平";
  }

  const change = (safeCurrent - safePrevious) / safePrevious;
  const sign = change > 0 ? "+" : "";
  return `${sign}${Math.round(change * 100)}%`;
}

function badgePriority(category: TokenAchievementBadge["category"], id: string) {
  if (category === "volume") return 90;
  if (category === "streak") return 80;
  if (id === "cache-master") return 70;
  if (category === "rhythm") return 60;
  if (category === "model") return 50;
  return 40;
}

function isDailyGoalType(type: TokenGoalType) {
  return type === "daily_tokens" || type === "daily_streak";
}

function isGoalMilestone(value: number) {
  return value === 3 || value === 7 || value === 14 || value === 30;
}

function formatGoalName(type: TokenGoalType, target: number) {
  if (type === "daily_tokens") return `每日 ≥ ${formatCompact(target)}`;
  if (type === "weekly_tokens") return `本周 ≥ ${formatCompact(target)}`;
  if (type === "weekly_cost_cap") return `本周花费 ≤ ${formatUsd(target)}`;
  return `连续活跃 ${Math.round(target)} 天`;
}

function topEvents<T extends { priority: number }>(events: T[], limit: number): T[] {
  return [...events].sort((left, right) => right.priority - left.priority).slice(0, limit);
}

function latestDisplayNames(events: TokenUsageEvent[]) {
  const latest = new Map<string, { displayName: string; timestamp: string }>();

  for (const event of events) {
    const current = latest.get(event.userId);
    if (!current || new Date(event.timestamp).getTime() > new Date(current.timestamp).getTime()) {
      latest.set(event.userId, { displayName: event.displayName || event.userId, timestamp: event.timestamp });
    }
  }

  return new Map([...latest.entries()].map(([userId, value]) => [userId, value.displayName]));
}

function localDayKey(value: Date, offsetMin: number): string {
  const local = new Date(value.getTime() + offsetMin * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function isFiniteTime(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

/** Feishu custom-bot signature: base64(HMAC-SHA256(key=`${ts}\n${secret}`, msg="")). */
export function signFeishu(timestampSec: number, secret: string): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

export type FeishuSendResult = { ok: boolean; status: number; code?: number; msg?: string };

/** POST a prepared card payload to the Feishu custom-bot webhook. */
export async function sendFeishuCard(
  payload: Record<string, unknown>,
  config: DailyReportConfig,
): Promise<FeishuSendResult> {
  const body: Record<string, unknown> = { ...payload };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = signFeishu(timestamp, config.secret);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let code: number | undefined;
    let msg: string | undefined;
    try {
      const json = (await response.json()) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };
      code = json.code ?? json.StatusCode;
      msg = json.msg ?? json.StatusMessage;
    } catch {
      // Non-JSON body — fall back to HTTP status only.
    }
    // Feishu returns code/StatusCode === 0 on success.
    const ok = response.ok && (code === undefined || code === 0);
    return { ok, status: response.status, code, msg };
  } finally {
    clearTimeout(timer);
  }
}

function escapeMd(value: string): string {
  // Keep card markdown from breaking on user-controlled display names / model ids.
  return String(value ?? "").replace(/[*_`[\]]/g, "\\$&");
}
