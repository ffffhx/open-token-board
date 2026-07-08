import type { CodexRateLimitReport, CodexRateWindow } from "../../packages/token-board-core/src/codex-rate-limits";
import type { TokenUsageEvent } from "../../packages/token-board-core/src/token-leaderboard";
import type { TokenBoardIdentity } from "../../packages/token-board-core/src/token-board-auth";

export const TEST_AUTH_SECRET = "open-token-board-e2e-auth-secret";
export const SESSION_COOKIE_NAME = "token_board_session";
export const PRIMARY_LOGIN = "alice-token";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;

export type FixtureUserKey = "alice" | "bob" | "cara" | "drew";

export type TokenBoardTestFixture = {
  currentMonthPeriod: string;
  currentYearPeriod: string;
  customFrom: string;
  customTo: string;
  events: TokenUsageEvent[];
  identities: Record<FixtureUserKey, TokenBoardIdentity>;
  now: Date;
  primaryLogin: string;
  rateLimitConfigs: Record<FixtureUserKey, CodexRateLimitReport | null>;
  usersJson: string;
};

export function createTokenBoardTestFixture(now = new Date()): TokenBoardTestFixture {
  const clock = createShanghaiClock(now);
  const identities: Record<FixtureUserKey, TokenBoardIdentity> = {
    alice: identity("101", PRIMARY_LOGIN, "Platform"),
    bob: identity("102", "bob-cache", "Infra"),
    cara: identity("103", "cara-reason", "Design"),
    drew: identity("104", "drew-small", "Platform"),
  };
  const previousMonth = addShanghaiMonths(clock.currentMonthStart, -1);
  const previousMonthDay15 = shanghaiDate(previousMonth.year, previousMonth.month, 15, 10);
  const previousMonthDay20 = shanghaiDate(previousMonth.year, previousMonth.month, 20, 14);
  const previousMonthDay25 = shanghaiDate(previousMonth.year, previousMonth.month, 25, 16);
  const currentMonthDay1 = shanghaiDate(clock.year, clock.month, 1, 0);

  const events = [
    usageEvent("alice-recent-morning", identities.alice, {
      timestamp: clock.daysAgo(1, 10),
      model: "claude-sonnet-4.5",
      source: "claude-code",
      tool: "Claude Code",
      project: "open-token-board",
      inputTokens: 620_000,
      cacheCreationInputTokens: 90_000,
      cachedInputTokens: 240_000,
      outputTokens: 58_000,
      reasoningOutputTokens: 11_000,
      messages: 18,
      sessionId: "alice-recent-a",
      sessionTitle: "Board polish",
      errorCount: 2,
      interruptedCount: 0,
      toolCallCount: 60,
      linesWritten: 128,
    }),
    usageEvent("alice-recent-evening", identities.alice, {
      timestamp: clock.daysAgo(1, 21),
      model: "gpt-5-codex",
      source: "codex",
      tool: "Codex CLI",
      project: "open-token-board",
      inputTokens: 64_000,
      cacheCreationInputTokens: 8_000,
      cachedInputTokens: 22_000,
      outputTokens: 11_000,
      reasoningOutputTokens: 4_000,
      messages: 9,
      sessionId: "alice-recent-b",
      sessionTitle: "Chart drilldown",
      errorCount: 0,
      interruptedCount: 0,
      toolCallCount: 45,
    }),
    usageEvent("bob-current-month-base", identities.bob, {
      timestamp: currentMonthDay1,
      model: "gemini-2.5-pro",
      source: "gemini-cli",
      tool: "Gemini CLI",
      project: "infra-migration",
      inputTokens: 900_000,
      cacheCreationInputTokens: 120_000,
      cachedInputTokens: 310_000,
      outputTokens: 79_000,
      reasoningOutputTokens: 0,
      messages: 21,
      sessionId: "bob-month-a",
      sessionTitle: "Month opening migration",
      errorCount: 6,
      interruptedCount: 1,
      toolCallCount: 80,
    }),
    usageEvent("cara-recent", identities.cara, {
      timestamp: clock.daysAgo(2, 15),
      model: "claude-haiku-3.5",
      source: "opencode",
      tool: "opencode",
      project: "design-system",
      inputTokens: 145_000,
      cacheCreationInputTokens: 12_000,
      cachedInputTokens: 55_000,
      outputTokens: 22_000,
      reasoningOutputTokens: 1_500,
      messages: 14,
      sessionId: "cara-recent-a",
      sessionTitle: "Badge layout",
      errorCount: 1,
      interruptedCount: 0,
      toolCallCount: 35,
    }),
    usageEvent("drew-recent-small", identities.drew, {
      timestamp: clock.daysAgo(3, 11),
      model: "o4-mini",
      source: "codex",
      tool: "Codex CLI",
      project: "docs",
      inputTokens: 12_000,
      cacheCreationInputTokens: 1_000,
      cachedInputTokens: 2_000,
      outputTokens: 2_600,
      reasoningOutputTokens: 500,
      messages: 4,
      sessionId: "drew-recent-a",
      sessionTitle: "Docs cleanup",
    }),
    usageEvent("alice-previous-month", identities.alice, {
      timestamp: previousMonthDay15,
      model: "claude-sonnet-4.5",
      source: "claude-code",
      tool: "Claude Code",
      project: "wrapped",
      inputTokens: 210_000,
      cacheCreationInputTokens: 35_000,
      cachedInputTokens: 74_000,
      outputTokens: 34_000,
      reasoningOutputTokens: 8_000,
      messages: 12,
      sessionId: "alice-prev-a",
      sessionTitle: "Wrapped fixture",
      linesWritten: 55,
    }),
    usageEvent("bob-previous-month", identities.bob, {
      timestamp: previousMonthDay20,
      model: "gemini-2.5-pro",
      source: "gemini-cli",
      tool: "Gemini CLI",
      project: "infra-migration",
      inputTokens: 330_000,
      cacheCreationInputTokens: 44_000,
      cachedInputTokens: 120_000,
      outputTokens: 48_000,
      reasoningOutputTokens: 0,
      messages: 16,
      sessionId: "bob-prev-a",
      sessionTitle: "Previous month migration",
    }),
    usageEvent("cara-previous-month", identities.cara, {
      timestamp: previousMonthDay25,
      model: "claude-haiku-3.5",
      source: "opencode",
      tool: "opencode",
      project: "design-system",
      inputTokens: 74_000,
      cacheCreationInputTokens: 7_000,
      cachedInputTokens: 25_000,
      outputTokens: 9_000,
      reasoningOutputTokens: 900,
      messages: 7,
      sessionId: "cara-prev-a",
      sessionTitle: "Previous badge work",
    }),
  ];

  return {
    currentMonthPeriod: `${clock.year}-${pad2(clock.month)}`,
    currentYearPeriod: String(clock.year),
    customFrom: dayKey(previousMonthDay15),
    customTo: dayKey(clock.daysAgo(1, 23)),
    events,
    identities,
    now: new Date(now),
    primaryLogin: PRIMARY_LOGIN,
    rateLimitConfigs: {
      alice: rateLimitReport(now, 38, 8),
      bob: rateLimitReport(now, 62, 31),
      cara: rateLimitReport(now, 82, 68),
      drew: null,
    },
    usersJson: JSON.stringify({
      users: Object.values(identities).map((user) => ({
        userId: user.userId,
        displayName: user.displayName,
        team: user.team,
      })),
    }),
  };
}

function identity(id: string, login: string, team: string): TokenBoardIdentity {
  return {
    userId: `github:${login}`,
    displayName: login,
    team,
    githubId: Number(id),
    githubLogin: login,
    avatarUrl: `https://github.com/${login}.png`,
  };
}

function usageEvent(
  id: string,
  user: TokenBoardIdentity,
  value: {
    cacheCreationInputTokens: number;
    cachedInputTokens: number;
    inputTokens: number;
    messages: number;
    model: string;
    outputTokens: number;
    project: string;
    reasoningOutputTokens: number;
    sessionId: string;
    sessionTitle: string;
    source: string;
    timestamp: Date;
    tool: string;
    errorCount?: number;
    interruptedCount?: number;
    toolCallCount?: number;
    linesWritten?: number | null;
  }
): TokenUsageEvent {
  return {
    id,
    userId: user.userId,
    displayName: user.displayName,
    team: user.team,
    source: value.source,
    model: value.model,
    project: value.project,
    tool: value.tool,
    timestamp: value.timestamp.toISOString(),
    inputTokens: value.inputTokens,
    cacheCreationInputTokens: value.cacheCreationInputTokens,
    cachedInputTokens: value.cachedInputTokens,
    outputTokens: value.outputTokens,
    reasoningOutputTokens: value.reasoningOutputTokens,
    totalTokens: value.inputTokens + value.outputTokens,
    messages: value.messages,
    sessionId: value.sessionId,
    sessionTitle: value.sessionTitle,
    ...(value.errorCount === undefined ? {} : { errorCount: value.errorCount }),
    ...(value.interruptedCount === undefined ? {} : { interruptedCount: value.interruptedCount }),
    ...(value.toolCallCount === undefined ? {} : { toolCallCount: value.toolCallCount }),
    ...(value.linesWritten === undefined ? {} : { linesWritten: value.linesWritten }),
  };
}

function rateLimitReport(now: Date, fiveHourRemaining: number, weeklyRemaining: number): CodexRateLimitReport {
  const generatedAt = now.toISOString();
  return {
    generatedAt,
    available: true,
    plan: "Pro",
    latestEventAt: generatedAt,
    recentTokensPerHour: 42_000,
    notes: ["e2e fixture"],
    sourcePaths: ["/tmp/open-token-board-e2e/codex"],
    windows: [
      rateLimitWindow("5h", 300, "5 小时", fiveHourRemaining, now),
      rateLimitWindow("weekly", 10_080, "每周", weeklyRemaining, now),
    ],
  };
}

function rateLimitWindow(
  key: CodexRateWindow["key"],
  windowMinutes: number,
  label: string,
  remainingPercent: number,
  now: Date
): CodexRateWindow {
  const usedPercent = 100 - remainingPercent;
  const resetsAt = new Date(now.getTime() + windowMinutes * 60_000).toISOString();
  const burnPercentPerHour = key === "weekly" ? 2.4 : 7.5;
  const estimatedCapacityTokens = key === "weekly" ? 18_000_000 : 3_000_000;

  return {
    key,
    windowMinutes,
    label,
    usedPercent,
    remainingPercent,
    resetsAt,
    resetsInSeconds: windowMinutes * 60,
    observedAt: now.toISOString(),
    staleSeconds: 30,
    burnPercentPerHour,
    burnTokensPerHour: Math.round((estimatedCapacityTokens * burnPercentPerHour) / 100),
    etaSeconds: Math.round((remainingPercent / burnPercentPerHour) * 3600),
    etaAt: new Date(now.getTime() + (remainingPercent / burnPercentPerHour) * HOUR_MS).toISOString(),
    willExhaustBeforeReset: key === "5h" && remainingPercent < 50,
    estimatedCapacityTokens,
    estimatedRemainingTokens: Math.round((estimatedCapacityTokens * remainingPercent) / 100),
    localConsumedTokensThisWindow: Math.round((estimatedCapacityTokens * usedPercent) / 100),
  };
}

function createShanghaiClock(now: Date) {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const currentMonthStart = { year, month };

  return {
    year,
    month,
    day,
    currentMonthStart,
    daysAgo(days: number, hour: number, minute = 0) {
      return new Date(shanghaiDate(year, month, day, hour, minute).getTime() - days * DAY_MS);
    },
  };
}

function shanghaiDate(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS);
}

function addShanghaiMonths(value: { year: number; month: number }, delta: number) {
  const date = new Date(Date.UTC(value.year, value.month - 1 + delta, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function dayKey(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
