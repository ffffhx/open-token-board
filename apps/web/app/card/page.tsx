import type { Metadata } from "next";
import { Suspense } from "react";

import { WeeklyReportClient } from "@/components/share/weekly-report-client";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Token 战报 | Open Token Board",
  description: "一张可分享的 AI 编码 Token 周战报卡：排名、消耗、主力模型与活跃趋势。",
};

export default function CardPage() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL;
  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center gap-6 bg-slate-100 px-4 py-12">
      <Suspense
        fallback={<div className="h-[560px] w-[420px] max-w-full animate-pulse rounded-3xl bg-slate-200" />}
      >
        <WeeklyReportClient apiBaseUrl={apiBaseUrl} />
      </Suspense>
    </main>
  );
}
