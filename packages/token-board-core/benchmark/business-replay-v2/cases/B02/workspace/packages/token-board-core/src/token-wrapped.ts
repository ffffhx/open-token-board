import type {
  TokenAchievementBadge,
  TokenLevelDefinition,
} from "./token-achievements";
import type { TokenDailyUsagePoint } from "./token-leaderboard";

export type TokenWrappedPeriodType = "month" | "year";

export type TokenWrappedNamedUsage = {
  name: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  share: number;
};

export type TokenWrappedProjectUsage = TokenWrappedNamedUsage & {
  activeDays: number;
};

export type TokenWrappedLevelUp = {
  id: string;
  name: string;
  symbol: string;
  color: string;
  thresholdTokens: number;
  reachedAt: string;
};

export type TokenWrappedResponse = {
  schemaVersion: 1;
  source: "server";
  generatedAt: string;
  records: number;
  totalRecords: number;
  user: {
    userId: string;
    login: string;
    githubLogin: string;
    displayName: string;
    team: string;
    avatarUrl: string;
  };
  period: {
    type: TokenWrappedPeriodType;
    value: string;
    label: string;
    startAt: string;
    endAt: string;
    timezone: "Asia/Shanghai";
    days: number;
  };
  totals: {
    tokens: number;
    costUsd: number;
    sessions: number;
    messages: number;
    linesWritten: number | null;
    records: number;
    activeDays: number;
  };
  streak: {
    days: number;
    startDate: string | null;
    endDate: string | null;
  };
  topModels: TokenWrappedNamedUsage[];
  topProjects: TokenWrappedProjectUsage[];
  peakDay: {
    date: string | null;
    tokens: number;
  };
  night: {
    tokens: number;
    ratio: number;
  };
  achievements: {
    newBadges: TokenAchievementBadge[];
    levelUps: TokenWrappedLevelUp[];
    levelBefore: TokenLevelDefinition;
    levelAfter: TokenLevelDefinition;
  };
  daily: TokenDailyUsagePoint[];
  ranking: {
    team: string;
    rank: number | null;
    totalUsers: number;
    tokens: number;
    share: number;
    percentile: number | null;
  };
};
