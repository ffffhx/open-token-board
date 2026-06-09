import type { Metadata } from "next";

import { CodexBenchmarkApp } from "@/components/codex-benchmark-app";

export const metadata: Metadata = {
  title: "Codex Health | Open Token Board",
  description: "固定每日题库评测 Codex 的 IQ Score、Speed Score、稳定性和任务明细。",
};

export default function BenchPage() {
  return <CodexBenchmarkApp />;
}
