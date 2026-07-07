"use client";

import type { TokenLeaderboardSummary } from "@open-token-board/core";
import { toBlob, toPng } from "html-to-image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildWeeklyReport, WeeklyReportCard, type WeeklyReport } from "@/components/share/weekly-report-card";
import { EmptyStatePanel, Skeleton } from "@/components/token-leaderboard/shared-ui";
import { normalizeApiBaseUrl } from "@/components/token-leaderboard/utils";
import { useI18n } from "@/i18n";

const VALID_RANGES = new Set(["1D", "7D", "30D", "90D", "WEEK", "MONTH", "LASTWEEK", "LASTMONTH"]);

type LoadState = "loading" | "ready" | "empty" | "error";

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w\p{Script=Han}-]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "report";
}

export function WeeklyReportClient({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { dict } = useI18n();
  const searchParams = useSearchParams();
  const user = searchParams.get("user") ?? undefined;
  const rangeParam = (searchParams.get("range") || "7D").toUpperCase();
  const range = VALID_RANGES.has(rangeParam) ? normalizeRangeParam(rangeParam) : "7D";
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

  const [state, setState] = useState<LoadState>("loading");
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hint, setHint] = useState<string>("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`${normalizedApiBaseUrl}/api/usage/stats?range=${range}&metric=tokens`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ summary?: TokenLeaderboardSummary } & Partial<TokenLeaderboardSummary>>;
      })
      .then((payload) => {
        if (cancelled) return;
        const summary = payload.summary ?? (payload as TokenLeaderboardSummary);
        const built = summary ? buildWeeklyReport(summary, user, dict.share.report) : null;
        if (built) {
          setReport(built);
          setState("ready");
        } else {
          setState("empty");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [dict.share.report, normalizedApiBaseUrl, range, user]);

  const download = useCallback(async () => {
    if (!cardRef.current || !report) return;
    setExporting(true);
    setHint("");
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const link = document.createElement("a");
      link.download = `token-report-${safeFileName(report.displayName)}.png`;
      link.href = dataUrl;
      link.click();
      setHint(dict.share.client.imageReady);
    } catch {
      setHint(dict.share.client.imageFailed);
    } finally {
      setExporting(false);
    }
  }, [dict.share.client.imageFailed, dict.share.client.imageReady, report]);

  const copy = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2, cacheBust: true });
      if (!blob) throw new Error("no blob");
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("clipboard unsupported");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setHint(dict.share.client.copied);
    } catch {
      setHint(dict.share.client.copyUnsupported);
    } finally {
      setExporting(false);
    }
  }, [dict.share.client.copied, dict.share.client.copyUnsupported]);

  if (state === "ready" && report) {
    return (
      <>
        <div ref={cardRef} className="w-full max-w-[420px]">
          <WeeklyReportCard report={report} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={download}
            disabled={exporting}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {exporting ? dict.common.actions.generating : dict.share.client.saveImage}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={exporting}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
          >
            {dict.share.client.copyImage}
          </button>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="min-h-5 text-sm text-slate-600" aria-live="polite">
            {hint || dict.share.client.defaultHint}
          </p>
          <Link href="/board" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            {dict.share.client.fullBoard}
          </Link>
        </div>
      </>
    );
  }

  if (state === "loading") {
    return (
      <div className="h-[560px] w-[420px] max-w-full rounded-lg" aria-label={dict.share.client.loadingAria} role="status">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <EmptyStatePanel
        title={state === "empty" ? dict.share.client.emptyTitle : dict.share.client.errorTitle}
        description={state === "empty" ? dict.share.client.emptyDescription : dict.share.client.errorDescription}
        action={
          <Link
            href="/board"
            className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {dict.common.actions.backToBoard}
          </Link>
        }
      />
    </div>
  );
}

function normalizeRangeParam(value: string) {
  return value === "WEEK" || value === "MONTH" || value === "LASTWEEK" || value === "LASTMONTH"
    ? value.toLowerCase()
    : value;
}
