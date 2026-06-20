import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Claude Code 额度面板 | Open Token Board",
  description: "实时查看 Claude Code 订阅的 5 小时与每周额度剩余、重置倒计时（来自状态栏精确上报）。",
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
