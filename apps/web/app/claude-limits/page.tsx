import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.claudeLimitsTitle,
  description: zh.common.metadata.claudeLimitsDescription,
};

// 旧链接 /claude-limits 保留可用：复用合并后的额度面板，默认预选 Claude Code 标签。
export default function ClaudeLimitsPage() {
  return (
    <RateLimitBoard
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialTab="claude"
    />
  );
}
