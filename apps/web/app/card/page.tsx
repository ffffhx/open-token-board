import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppNavLinks } from "@/components/app-nav-links";
import { WeeklyReportClient } from "@/components/share/weekly-report-client";
import { TokenBoardLogoMark } from "@/components/token-board-logo";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Token 战报 | Open Token Board",
  description: "一张可分享的 AI 编码 Token 战报卡：排名、消耗、主力模型与活跃趋势，一键导出图片分享。",
};

export default function CardPage() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL;
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
          <TokenBoardLogoMark className="size-7 shrink-0" decorative />
          <span className="truncate">Open Token Board</span>
        </Link>
        <AppNavLinks active="card" className="justify-start sm:justify-end" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
        <Suspense
          fallback={<div className="otb-skeleton h-[560px] w-[420px] max-w-full rounded-lg" />}
        >
          <WeeklyReportClient apiBaseUrl={apiBaseUrl} />
        </Suspense>
      </div>
    </main>
  );
}
