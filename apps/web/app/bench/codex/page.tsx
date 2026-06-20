import type { Metadata } from "next";

import { BenchmarkAgentApp } from "@/components/benchmark/benchmark-agent-app";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Codex 评测 | Open Token Board",
  description: "真实调用 Codex 在沙盒编程题集上的 IQ Score、Speed Score、通过率与逐题明细。",
};

export default function CodexBenchPage() {
  return <BenchmarkAgentApp agent="codex" apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} tab="codex" />;
}
