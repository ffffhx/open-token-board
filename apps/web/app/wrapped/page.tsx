import type { Metadata } from "next";
import { Suspense } from "react";

import { WrappedClient } from "@/components/wrapped/wrapped-client";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://124-221-36-36.anyip.dev:8443/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.wrappedTitle,
  description: zh.common.metadata.wrappedDescription,
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
