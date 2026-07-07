import type { TokenLeaderboardSummary } from "@open-token-board/core";

import { TokenBoardWebsiteClient, type HeroStats } from "@/components/token-board-website-client";

const DEFAULT_API_URL = "https://124-221-36-36.anyip.dev:8443/token-board";

export async function TokenBoardWebsite() {
  const stats = await loadHeroStats();

  return <TokenBoardWebsiteClient stats={stats} />;
}

async function loadHeroStats(): Promise<HeroStats | null> {
  const base = (process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/api/usage/stats?range=7D&metric=tokens`, {
      // Landing page is cacheable; refresh the hero highlights every few minutes.
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      summary?: TokenLeaderboardSummary;
    } & Partial<TokenLeaderboardSummary>;
    const summary = payload.summary ?? (payload as TokenLeaderboardSummary);
    const leader = summary?.users?.[0];
    if (!summary || !leader || summary.activeUsers <= 0) {
      return null;
    }
    return {
      activeUsers: summary.activeUsers,
      leaderName: leader.displayName,
      leaderTokens: leader.tokens,
      topModel: summary.topModel || "-",
      totalTokens: summary.totalTokens,
    };
  } catch {
    return null;
  }
}
