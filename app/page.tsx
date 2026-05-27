import { TokenLeaderboardApp } from "@/components/token-leaderboard-app";

const INITIAL_NOW = "2026-05-14T12:00:00.000Z";
const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export default function HomePage() {
  return (
    <TokenLeaderboardApp
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialNow={INITIAL_NOW}
    />
  );
}
