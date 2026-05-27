import type { Metadata } from "next";

import { TokenLeaderboardApp } from "@/components/token-leaderboard-app";

const INITIAL_NOW = "2026-05-14T12:00:00.000Z";
const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Token Board | Open Token Board",
  description: "查看朋友间的 AI 编码 Token 排名、费用估算、模型消耗、工具分布与效率指标。",
};

export default function BoardPage() {
  return (
    <TokenLeaderboardApp
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialNow={INITIAL_NOW}
    />
  );
}
