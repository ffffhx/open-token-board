import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateTokenGoals,
  type TokenGoal,
  type WeeklyTokenGoalScorecard,
} from "../../packages/token-board-core/src/token-goals";
import {
  buildTokenLeaderboard,
  type TokenUsageEvent,
} from "../../packages/token-board-core/src/token-leaderboard";

import {
  buildDailyReportCard,
  buildReportStateSnapshot,
  buildWeeklyReportCard,
  detectDailyReportEvents,
  type DailyQuotaAlertSection,
} from "../../apps/token-board-api/src/daily-report";

describe("daily report goal events", () => {
  it("announces daily goal milestone chains from report snapshots", () => {
    const goal = tokenGoal("daily_tokens", 1_000, "2026-07-06T00:00:00.000Z");
    const previousNow = new Date("2026-07-07T04:00:00.000Z");
    const currentNow = new Date("2026-07-08T04:00:00.000Z");
    const previousEvents = [
      usage("day-1", "2026-07-06T02:00:00.000Z", 1_200),
      usage("day-2", "2026-07-07T02:00:00.000Z", 1_200),
    ];
    const currentEvents = [
      ...previousEvents,
      usage("day-3", "2026-07-08T02:00:00.000Z", 1_200),
    ];
    const previous = snapshot(previousEvents, goal, previousNow);
    const current = snapshot(currentEvents, goal, currentNow);

    const events = detectDailyReportEvents(current, previous);

    assert.ok(events.some((event) => event.type === "goal" && event.content.includes("连续 3 天达成")));
  });

  it("does not add goal events for users without goals", () => {
    const previousNow = new Date("2026-07-07T04:00:00.000Z");
    const currentNow = new Date("2026-07-08T04:00:00.000Z");
    const previous = snapshot([usage("day-1", "2026-07-07T02:00:00.000Z", 1_200)], null, previousNow);
    const current = snapshot([usage("day-2", "2026-07-08T02:00:00.000Z", 1_200)], null, currentNow);

    const events = detectDailyReportEvents(current, previous);

    assert.equal(events.some((event) => event.type === "goal"), false);
  });
});

describe("weekly report goal scorecard", () => {
  it("renders the goal scorecard section when users have goals", () => {
    const summary = buildTokenLeaderboard([usage("week-1", "2026-07-08T02:00:00.000Z", 2_000)], {
      range: "7D",
      metric: "tokens",
      now: new Date("2026-07-08T04:00:00.000Z"),
    });
    const previousSummary = buildTokenLeaderboard([], {
      range: "7D",
      metric: "tokens",
      now: new Date("2026-07-01T04:00:00.000Z"),
    });
    const goalScorecard: WeeklyTokenGoalScorecard = {
      weekKey: "2026-06-29",
      usersWithGoals: 2,
      goalCount: 3,
      achievedUsers: 1,
      failedUsers: 1,
      pendingUsers: 0,
      achievedGoals: 2,
      failedGoals: 1,
      pendingGoals: 0,
      praise: [
        {
          userId: "github:alice",
          displayName: "alice",
          goal: tokenGoal("weekly_tokens", 1_000, "2026-06-01T00:00:00.000Z"),
          consecutiveSuccessCount: 3,
        },
      ],
    };

    const card = buildWeeklyReportCard(summary, previousSummary, {
      tzOffsetMinutes: 480,
      goalScorecard,
    });
    const text = JSON.stringify(card);

    assert.match(text, /目标成绩单/);
    assert.match(text, /本周 2 人设置 3 个目标/);
    assert.match(text, /连续 3 周/);
  });
});

describe("daily report quota alerts", () => {
  it("renders quota alerts with remaining percent and eta", () => {
    const card = buildDailyReportCard(dailySummary(), {
      tzOffsetMinutes: 480,
      quotaAlerts: quotaAlerts({
        alerts: [
          {
            userId: "github:alice",
            displayName: "alice",
            remainingPercent: 8,
            etaAt: "2026-07-08T12:30:00.000Z",
            toolLabel: "Codex",
          },
        ],
      }),
    });
    const text = JSON.stringify(card);

    assert.match(text, /额度预警/);
    assert.match(text, /alice/);
    assert.match(text, /剩余 8%/);
    assert.match(text, /预计 7\/8 20:30 耗尽/);
  });

  it("omits quota alert section when there are no alerts", () => {
    const card = buildDailyReportCard(dailySummary(), {
      tzOffsetMinutes: 480,
      quotaAlerts: quotaAlerts(),
    });

    assert.doesNotMatch(JSON.stringify(card), /额度预警/);
  });

  it("renders stale quota snapshots separately without alerting", () => {
    const card = buildDailyReportCard(dailySummary(), {
      tzOffsetMinutes: 480,
      quotaAlerts: quotaAlerts({
        staleUsers: [{ userId: "github:bob", displayName: "bob", ageHours: 31 }],
      }),
    });
    const text = JSON.stringify(card);

    assert.match(text, /额度预警/);
    assert.match(text, /数据过旧/);
    assert.match(text, /bob 31h/);
    assert.doesNotMatch(text, /剩余/);
  });
});

function snapshot(events: TokenUsageEvent[], goal: TokenGoal | null, now: Date) {
  const dailySummary = buildTokenLeaderboard(events, { range: "1D", metric: "tokens", now });
  const weeklySummary = buildTokenLeaderboard(events, { range: "7D", metric: "tokens", now });
  const evaluations = goal ? evaluateTokenGoals([goal], events, { now }) : [];

  return buildReportStateSnapshot({
    dailySummary,
    weeklySummary,
    generatedAt: now.toISOString(),
    dayKey: now.toISOString().slice(0, 10),
    goalEvaluationsByUser: new Map([["github:alice", evaluations]]),
  });
}

function dailySummary() {
  return buildTokenLeaderboard([usage("daily-quota", "2026-07-08T02:00:00.000Z", 2_000)], {
    range: "1D",
    metric: "tokens",
    now: new Date("2026-07-08T04:00:00.000Z"),
  });
}

function quotaAlerts(value: Partial<DailyQuotaAlertSection> = {}): DailyQuotaAlertSection {
  return {
    thresholdPercent: 25,
    alerts: [],
    staleUsers: [],
    ...value,
  };
}

function tokenGoal(type: TokenGoal["type"], target: number, createdAt: string): TokenGoal {
  return {
    id: `${type}-${target}`,
    type,
    target,
    createdAt,
    updatedAt: createdAt,
  };
}

function usage(id: string, timestamp: string, tokens: number): TokenUsageEvent {
  return {
    id,
    userId: "github:alice",
    displayName: "alice",
    team: "Platform",
    source: "codex",
    model: "gpt-5-codex",
    project: "goals",
    tool: "Codex CLI",
    timestamp,
    inputTokens: tokens,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
    costUsd: 0,
    messages: 1,
  };
}
