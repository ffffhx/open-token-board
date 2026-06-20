import type { Metadata } from "next";

import { BenchmarkAgentApp } from "@/components/benchmark/benchmark-agent-app";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Claude Code 评测 | Open Token Board",
  description: "真实调用 Claude Code 在沙盒编程题集上的 IQ Score、Speed Score、通过率与逐题明细。",
};

export default function ClaudeBenchPage() {
  return <BenchmarkAgentApp agent="claude-code" apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} tab="claude" />;
}
