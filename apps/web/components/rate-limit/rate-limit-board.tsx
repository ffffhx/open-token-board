"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CodexRateLimitReport, CodexRateWindow } from "@open-token-board/core/codex-rate-limits";

import { TokenBoardLogo } from "@/components/token-board-logo";

const POLL_INTERVAL_MS = 15_000;

type LoadState = "idle" | "loading" | "ready" | "error";

function fmtTokens(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return `${value}`;
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds <= 0) return "已到期";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}天 ${h}小时 ${m}分`;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function secondsUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(iso) - now) / 1000);
}

function toneFor(percent: number): { bar: string; text: string } {
  if (percent >= 85) return { bar: "bg-rose-500", text: "text-rose-600" };
  if (percent >= 60) return { bar: "bg-amber-500", text: "text-amber-600" };
  return { bar: "bg-emerald-500", text: "text-emerald-600" };
}

function WindowCard({ window: w, now }: { window: CodexRateWindow; now: number }) {
  const tone = toneFor(w.usedPercent);
  const resetsIn = secondsUntil(w.resetsAt, now);
  const etaIn = secondsUntil(w.etaAt, now);

  let etaNode: React.ReactNode;
  if (etaIn === null) {
    etaNode = <span className="text-emerald-600">当前速度下本周期不会耗尽</span>;
  } else if (w.willExhaustBeforeReset) {
    etaNode = (
      <span className="text-rose-600">
        约 {fmtDuration(etaIn)}后耗尽 <span className="text-slate-400">(早于重置)</span>
      </span>
    );
  } else {
    etaNode = (
      <span className="text-amber-600">
        约 {fmtDuration(etaIn)}后耗尽 <span className="text-slate-400">(晚于重置，会先刷新)</span>
      </span>
    );
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{w.label}窗口</h3>
        <span className="font-mono text-xs text-slate-400">{w.windowMinutes} 分钟</span>
      </div>

      <div className="mt-5 flex items-end gap-3">
        <span className={`text-5xl font-semibold tabular-nums ${tone.text}`}>
          {w.remainingPercent.toFixed(0)}
          <span className="text-2xl">%</span>
        </span>
        <span className="pb-1 text-sm text-slate-500">剩余额度</span>
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${tone.bar} transition-[width] duration-700`}
          style={{ width: `${Math.min(100, w.usedPercent)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        已用 <span className="font-semibold text-slate-700">{w.usedPercent.toFixed(0)}%</span>
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-slate-400">重置倒计时</dt>
          <dd className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">{fmtDuration(resetsIn)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">消耗速度</dt>
          <dd className="mt-1 font-semibold text-slate-900">
            {w.burnPercentPerHour !== null ? `${w.burnPercentPerHour.toFixed(1)}%/小时` : "空闲"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-400">预计耗尽</dt>
          <dd className="mt-1 font-semibold">{etaNode}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        <span className="font-semibold text-slate-600">容量估算</span> ≈ {fmtTokens(w.estimatedCapacityTokens)} tokens
        <span className="text-slate-300"> · </span>
        剩余 ≈ {fmtTokens(w.estimatedRemainingTokens)}
        <span className="text-slate-300"> · </span>
        本机本周期已用 ≈ {fmtTokens(w.localConsumedTokensThisWindow)}
      </div>
    </article>
  );
}

interface RateLimitData {
  report: CodexRateLimitReport | null;
  state: LoadState;
  error: string | null;
  now: number;
  base: string;
  reload: () => void;
}

function useRateLimitReport(apiBaseUrl: string): RateLimitData {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const [report, setReport] = useState<CodexRateLimitReport | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const firstLoad = useRef(true);

  const reload = useCallback(async () => {
    if (!base) {
      setState("error");
      setError("未配置 API 地址。");
      return;
    }
    if (firstLoad.current) setState("loading");
    try {
      const res = await fetch(`${base}/api/usage/rate-limits`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CodexRateLimitReport;
      setReport(data);
      setNow(Date.now());
      setState("ready");
      setError(null);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      firstLoad.current = false;
    }
  }, [base]);

  useEffect(() => {
    void reload();
    const poll = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [reload]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return { report, state, error, now, base, reload: () => void reload() };
}

function StatusLine({ report, now }: { report: CodexRateLimitReport; now: number }) {
  const latestAgeSec = report.latestEventAt ? Math.round((now - Date.parse(report.latestEventAt)) / 1000) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
      {report.plan && (
        <span>
          计划 <span className="font-semibold text-slate-700">{report.plan}</span>
        </span>
      )}
      {report.recentTokensPerHour !== null && (
        <span>
          最近一小时吞吐 <span className="font-semibold text-slate-700">{fmtTokens(report.recentTokensPerHour)}/小时</span>
        </span>
      )}
      {latestAgeSec !== null && (
        <span>
          最近活动 <span className="font-semibold text-slate-700">{fmtDuration(latestAgeSec)}前</span>
        </span>
      )}
      <span className="text-slate-400">每 15 秒自动刷新</span>
    </div>
  );
}

function WindowGrid({ report, now }: { report: CodexRateLimitReport; now: number }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {report.windows.map((w) => (
        <WindowCard key={w.key} window={w} now={now} />
      ))}
    </div>
  );
}

/**
 * 嵌入式额度面板：用于 /board 个人区域。本机没有限额数据（远程访客、未启动
 * 本地 API）时静默隐藏，避免给公开榜单的访客显示报错。
 */
export function RateLimitPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { report, state, now } = useRateLimitReport(apiBaseUrl);

  if (state !== "ready" || !report || !report.available || report.windows.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-stone-950/10 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Codex 额度面板</h2>
          <p className="mt-1 text-xs text-slate-500">本机 ~/.codex 的 5 小时与每周额度，实时刷新。</p>
        </div>
        <Link href="/limits" className="font-mono text-xs font-semibold text-blue-600 hover:text-blue-700">
          独立页面 →
        </Link>
      </div>
      <div className="mt-4">
        <StatusLine report={report} now={now} />
      </div>
      <div className="mt-4">
        <WindowGrid report={report} now={now} />
      </div>
    </section>
  );
}

/** 全页额度面板：/limits 路由。 */
export function RateLimitBoard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { report, state, error, now, base, reload } = useRateLimitReport(apiBaseUrl);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="text-slate-900">
          <TokenBoardLogo />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/board"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            排行榜
          </Link>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            刷新
          </button>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <header className="mt-2">
          <p className="font-mono text-xs font-semibold uppercase text-blue-600">Codex rate limits</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Codex 额度面板</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            实时读取本机 <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">~/.codex</code> 日志，
            展示 5 小时与每周额度的剩余、重置倒计时和预计耗尽时间。百分比与重置时间是 Codex 上报的精确值，
            token 容量为估算值。窗口按重置点切分，已计入提前充值。
          </p>
        </header>

        {state === "loading" && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            正在读取 Codex 日志…
          </div>
        )}

        {state === "error" && (
          <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            <p className="font-semibold">无法获取额度数据</p>
            <p className="mt-1">{error}</p>
            <p className="mt-3 text-rose-600">
              请确认本机已启动 Token Board API（<code className="font-mono">pnpm token:server</code>），
              且面板的 <code className="font-mono">NEXT_PUBLIC_TOKEN_BOARD_API_URL</code> 指向它（当前：{base || "未配置"}）。
              该面板需要运行在跑 Codex 的同一台机器上。
            </p>
          </div>
        )}

        {state === "ready" && report && !report.available && (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <p className="font-semibold">未找到限额数据</p>
            {report.notes.map((note) => (
              <p key={note} className="mt-1">
                {note}
              </p>
            ))}
          </div>
        )}

        {report && report.available && (
          <>
            <div className="mt-6">
              <StatusLine report={report} now={now} />
            </div>
            <div className="mt-5">
              <WindowGrid report={report} now={now} />
            </div>
            {report.notes.map((note) => (
              <p key={note} className="mt-5 text-xs leading-5 text-slate-400">
                注：{note}
              </p>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
