"use client";

import type { TokenLeaderboardSummary } from "@open-token-board/core";
import { toBlob, toPng } from "html-to-image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildWeeklyReport, WeeklyReportCard, type WeeklyReport } from "@/components/share/weekly-report-card";
import { normalizeApiBaseUrl } from "@/components/token-leaderboard/utils";

const VALID_RANGES = new Set(["1D", "7D", "30D", "90D"]);

type LoadState = "loading" | "ready" | "empty" | "error";

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w一-龥-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "report";
}

export function WeeklyReportClient({ apiBaseUrl }: { apiBaseUrl: string }) {
  const searchParams = useSearchParams();
  const user = searchParams.get("user") ?? undefined;
  const rangeParam = (searchParams.get("range") || "7D").toUpperCase();
  const range = VALID_RANGES.has(rangeParam) ? rangeParam : "7D";
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
        const built = summary ? buildWeeklyReport(summary, user) : null;
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
  }, [normalizedApiBaseUrl, range, user]);

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
      setHint("已生成图片，去下载里查看吧。");
    } catch {
      setHint("生成图片失败，可以直接对卡片截图。");
    } finally {
      setExporting(false);
    }
  }, [report]);

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
      setHint("已复制到剪贴板，直接粘贴到飞书/微信即可。");
    } catch {
      setHint("当前浏览器不支持复制图片，改用「保存为图片」。");
    } finally {
      setExporting(false);
    }
  }, []);

  if (state === "ready" && report) {
    return (
      <>
        <div ref={cardRef} className="w-fit">
          <WeeklyReportCard report={report} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={download}
            disabled={exporting}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {exporting ? "生成中…" : "保存为图片"}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={exporting}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
          >
            复制图片
          </button>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="min-h-5 text-sm text-slate-600" aria-live="polite">
            {hint || "导出后发到飞书、微信或群里，晒一晒你的战报。"}
          </p>
          <Link href="/board" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            查看完整榜单 →
          </Link>
        </div>
      </>
    );
  }

  if (state === "loading") {
    return (
      <div className="h-[560px] w-[420px] max-w-full animate-pulse rounded-3xl bg-slate-200" aria-label="加载战报中" />
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-900">
        {state === "empty" ? "该用户在当前区间没有记录" : "暂时拿不到战报数据"}
      </p>
      <p className="mt-2 text-sm text-slate-500">
        {state === "empty" ? "换一个用户名或时间区间试试。" : "榜单后端不可达，稍后再试。"}
      </p>
      <Link href="/board" className="mt-4 inline-block text-sm font-semibold text-blue-600 hover:text-blue-700">
        返回榜单 →
      </Link>
    </div>
  );
}
