import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.claudeLimitsTitle,
  description: zh.common.metadata.claudeLimitsDescription,
};

// Keep the legacy /claude-limits URL working by preselecting Claude Code.
export default function ClaudeLimitsPage() {
  return (
    <RateLimitBoard
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialTab="claude"
    />
  );
}
