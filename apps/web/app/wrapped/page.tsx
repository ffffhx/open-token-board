import type { Metadata } from "next";
import { Suspense } from "react";

import { WrappedClient } from "@/components/wrapped/wrapped-client";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export const metadata: Metadata = {
  title: "Wrapped 战报 | Open Token Board",
  description: "Open Token Board 月度/年度 Wrapped：总消耗、模型偏好、活跃节奏、荣誉升级与一键分享图。",
};

export default function WrappedPage() {
  return (
    <Suspense fallback={<WrappedPageFallback />}>
      <WrappedClient apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />
    </Suspense>
  );
}

function WrappedPageFallback() {
  return (
    <main className="min-h-[100svh] bg-slate-950 px-4 py-6 text-white">
      <div className="otb-skeleton mx-auto h-[calc(100svh-3rem)] max-w-5xl rounded-lg bg-white/10" />
    </main>
  );
}
