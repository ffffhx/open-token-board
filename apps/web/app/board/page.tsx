import type { Metadata } from "next";

import { TokenLeaderboardApp } from "@/components/token-leaderboard-app";
import { zh } from "@/i18n/dictionaries/zh";

const INITIAL_NOW = "2026-05-14T12:00:00.000Z";
const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Token Board | Open Token Board",
  description: zh.common.metadata.boardDescription,
};

export default function BoardPage() {
  return (
    <TokenLeaderboardApp
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialNow={INITIAL_NOW}
    />
  );
}
