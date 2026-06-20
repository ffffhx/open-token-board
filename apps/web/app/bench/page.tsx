import type { Metadata } from "next";

import { BenchmarkCompareApp } from "@/components/benchmark/benchmark-compare-app";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Codex vs Claude Code | Open Token Board",
  description: "同一套沙盒编程题，真实调用 Codex 与 Claude Code 跑测并对比 IQ、速度、通过率与耗时。",
};

export default function BenchPage() {
  return <BenchmarkCompareApp apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />;
}
