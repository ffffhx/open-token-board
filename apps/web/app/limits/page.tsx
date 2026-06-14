import type { Metadata } from "next";

import { RateLimitBoard } from "@/components/rate-limit/rate-limit-board";

const DEFAULT_API_URL = "http://127.0.0.1:8787";

export const metadata: Metadata = {
  title: "Codex 额度面板 | Open Token Board",
  description: "实时查看本机 Codex CLI 的 5 小时与每周额度剩余、重置倒计时与预计耗尽时间。",
};

export default function LimitsPage() {
  return <RateLimitBoard apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />;
}
