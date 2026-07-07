import type { Metadata } from "next";

import { BenchmarkAgentApp } from "@/components/benchmark/benchmark-agent-app";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://124-221-36-36.anyip.dev:8443/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.codexBenchTitle,
  description: zh.common.metadata.codexBenchDescription,
};

export default function CodexBenchPage() {
  return <BenchmarkAgentApp agent="codex" apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} tab="codex" />;
}
