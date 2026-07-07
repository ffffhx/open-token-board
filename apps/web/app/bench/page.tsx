import type { Metadata } from "next";

import { BenchmarkCompareApp } from "@/components/benchmark/benchmark-compare-app";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.benchTitle,
  description: zh.common.metadata.benchDescription,
};

export default function BenchPage() {
  return <BenchmarkCompareApp apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />;
}
