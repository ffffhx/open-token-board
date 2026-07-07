import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";
import { zh } from "@/i18n/dictionaries/zh";

// The merged quota board serves both Codex and Claude Code, defaulting to the
// hosted backend unless NEXT_PUBLIC_TOKEN_BOARD_API_URL overrides it locally.
const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.limitsTitle,
  description: zh.common.metadata.limitsDescription,
};

export default function LimitsPage() {
  return <RateLimitBoard apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />;
}
