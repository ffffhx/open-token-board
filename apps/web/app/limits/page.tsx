import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";
import { zh } from "@/i18n/dictionaries/zh";

// 合并后的额度面板同时承载 Codex 与 Claude Code 两个标签，默认指向线上后端；
// 本地自包含调试（pnpm token:server）时用 NEXT_PUBLIC_TOKEN_BOARD_API_URL 覆盖即可。
const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.limitsTitle,
  description: zh.common.metadata.limitsDescription,
};

export default function LimitsPage() {
  return <RateLimitBoard apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />;
}
