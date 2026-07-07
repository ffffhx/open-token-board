import type { TokenBoardRange, TokenDailyUsagePoint } from "@open-token-board/core";

export type PublicProfileRanking = {
  range: TokenBoardRange;
  rank: number | null;
  share: number;
  tokens: number;
  totalUsers: number;
};

export type PublicProfileNamedUsage = {
  name: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  share: number;
};

export type PublicProfileResponse = {
  schemaVersion: 1;
  source: "server";
  records: number;
  totalRecords: number;
  generatedAt: string;
  user: {
    userId: string;
    login: string;
    githubLogin: string;
    displayName: string;
    team: string;
    avatarUrl: string;
  };
  profile: {
    joinedAt: string | null;
    lastReportedAt: string | null;
    totals: {
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
    };
    daily365: TokenDailyUsagePoint[];
    models: PublicProfileNamedUsage[];
    tools: PublicProfileNamedUsage[];
    rankings: PublicProfileRanking[];
  };
};
