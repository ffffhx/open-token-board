"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CodexRateLimitReport, CodexRateWindow } from "@open-token-board/core/codex-rate-limits";

import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogo } from "@/components/token-board-logo";

const POLL_INTERVAL_MS = 15_000;

type LoadState = "idle" | "loading" | "ready" | "error";

// 模块级缓存：在路由切换（额度 ↔ 榜单 ↔ 其它页面）后仍保留上一次的额度快照。
// 组件卸载时这里不会被清空，切回来时能立即用旧数据渲染，再在后台静默刷新，
// 而不是每次都从空白 loading 重新拉取。
const rateLimitReportCache = new Map<string, CodexRateLimitReport>();
function rateLimitCacheKey(base: string, endpoint: string): string {
  return `${base}||${endpoint}`;
}

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
          style={{ width: `${Math.min(100, w.remainingPercent)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        剩余 <span className="font-semibold text-slate-700">{w.remainingPercent.toFixed(0)}%</span>
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

function useRateLimitReport(apiBaseUrl: string, endpoint = "/api/usage/rate-limits"): RateLimitData {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const key = rateLimitCacheKey(base, endpoint);
  const [report, setReport] = useState<CodexRateLimitReport | null>(() => rateLimitReportCache.get(key) ?? null);
  const [state, setState] = useState<LoadState>(() => (rateLimitReportCache.has(key) ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback(async () => {
    if (!base) {
      setState("error");
      setError("未配置 API 地址。");
      return;
    }
    const cacheKey = rateLimitCacheKey(base, endpoint);
    // 已有缓存时不回到 loading，保持旧数据展示直到新数据到达。
    if (!rateLimitReportCache.has(cacheKey)) setState("loading");
    try {
      const res = await fetch(`${base}${endpoint}`, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CodexRateLimitReport;
      rateLimitReportCache.set(cacheKey, data);
      setReport(data);
      setNow(Date.now());
      setState("ready");
      setError(null);
    } catch (err) {
      // 已有缓存时后台刷新失败不打断展示，继续显示旧快照。
      if (rateLimitReportCache.has(cacheKey)) return;
      setState("error");
      setError(err instanceof Error ? err.message : "请求失败");
    }
  }, [base, endpoint]);

  // 切换数据源（Codex ↔ Claude）时，用对应缓存立即回填；没缓存才回到 loading。
  // 既避免把上一个工具的额度显示在新标题下，也避免每次都从空白重新加载。
  useEffect(() => {
    const cached = rateLimitReportCache.get(key) ?? null;
    setReport(cached);
    setState(cached ? "ready" : "loading");
  }, [key]);

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
 * 嵌入式额度面板：用于 /board 个人区域。未登录、未安装 agent 或还没有
 * 额度快照时静默隐藏，避免给公开榜单的访客显示报错。
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
          <p className="mt-1 text-xs text-slate-500">安装 token-board-agent 后自动同步本机 5 小时与每周额度。</p>
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

export type LimitTab = "codex" | "claude";

interface TabConfig {
  label: string;
  endpoint: string;
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  loadingText: string;
  errorHint: (base: string) => React.ReactNode;
  emptyTitle: string;
  emptyExtra: (report: CodexRateLimitReport) => React.ReactNode;
  loginLabel: string;
  waitingLabel: string;
}

const TAB_CONFIG: Record<LimitTab, TabConfig> = {
  codex: {
    label: "Codex",
    endpoint: "/api/usage/rate-limits",
    eyebrow: "Codex rate limits",
    title: "Codex 额度面板",
    description: (
      <>
        安装 <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">token-board-agent</code> 后，
        后台任务会像 token 统计一样定时上传本机 <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">~/.codex</code>
        里的 5 小时与每周额度快照。百分比与重置时间是 Codex 上报的精确值，token 容量为估算值。
      </>
    ),
    loadingText: "正在读取 Codex 日志…",
    errorHint: (base) => (
      <p className="mt-3 text-rose-600">
        请确认本机已启动 Token Board API（<code className="font-mono">pnpm token:server</code>），
        且面板的 <code className="font-mono">NEXT_PUBLIC_TOKEN_BOARD_API_URL</code> 指向它（当前：{base || "未配置"}）。
        该面板需要运行在跑 Codex 的同一台机器上。
      </p>
    ),
    emptyTitle: "未找到限额数据",
    emptyExtra: (report) => (
      <>
        <p className="mt-3 text-amber-700">
          当前读取的是 API 服务所在机器的 Codex 日志，不是浏览器所在电脑的文件系统。若这里出现
          <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">/home/node</code>
          之类路径，说明你正在看远端容器的日志路径。
        </p>
        {report.sourcePaths.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-white/60 px-4 py-3">
            <p className="font-semibold text-amber-900">当前读取路径</p>
            <ul className="mt-2 space-y-1 font-mono text-xs leading-5 text-amber-800">
              {report.sourcePaths.map((sourcePath) => (
                <li key={sourcePath}>{sourcePath}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-amber-700">
          要读取你这台电脑的额度，请在本机运行
          <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">npx --yes token-board-agent install</code>
          或
          <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">npx --yes token-board-agent upload</code>。
          之后后台任务会每 5 分钟同步一次，无需再启动本机 API。
        </p>
      </>
    ),
    loginLabel: "GitHub 登录后读取 agent 快照",
    waitingLabel: "已登录 ✓，正在等待 token-board-agent 上传你的额度快照",
  },
  claude: {
    label: "Claude Code",
    endpoint: "/api/usage/claude-rate-limits",
    eyebrow: "Claude Code rate limits",
    title: "Claude Code 额度面板",
    description: (
      <>
        Claude Code 不把额度写进本地日志，而是随状态栏 JSON 实时下发。token-board-agent 会读取由状态栏捕获脚本落盘的
        <code className="mx-1 rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">~/.token-board-agent/claude-rate-limits.json</code>
        并定时上传。百分比与重置时间为 Claude 订阅额度的精确值。
      </>
    ),
    loadingText: "正在读取 Claude Code 额度…",
    errorHint: (base) => (
      <p className="mt-3 text-rose-600">
        请确认面板的 <code className="font-mono">NEXT_PUBLIC_TOKEN_BOARD_API_URL</code> 指向后端（当前：{base || "未配置"}）。
      </p>
    ),
    emptyTitle: "未找到 Claude Code 额度",
    emptyExtra: () => (
      <p className="mt-3 text-amber-700">
        需要订阅（Pro/Max）账号，且在本机为 Claude Code 配置「状态栏捕获」后，agent 才能拿到精确额度并上传。
      </p>
    ),
    loginLabel: "GitHub 登录后读取 Claude Code 快照",
    waitingLabel: "已登录 ✓，正在等待 token-board-agent 上传你的 Claude Code 额度快照",
  },
};

function LimitTabSwitcher({ tab, onChange }: { tab: LimitTab; onChange: (next: LimitTab) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="额度数据源">
      {(Object.keys(TAB_CONFIG) as LimitTab[]).map((key) => {
        const isActive = key === tab;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={
              isActive
                ? "min-h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow transition"
                : "min-h-9 rounded-lg px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            }
          >
            {TAB_CONFIG[key].label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 全页额度面板：/limits 路由。Codex 与 Claude Code 合并为一个页面，用页内分段
 * 切换数据源。`initialTab` 让 /claude-limits 旧链接预选 Claude 标签。
 */
export function RateLimitBoard({
  apiBaseUrl,
  initialTab = "codex",
}: {
  apiBaseUrl: string;
  initialTab?: LimitTab;
}) {
  const [tab, setTab] = useState<LimitTab>(initialTab);
  const config = TAB_CONFIG[tab];
  const { report, state, error, now, base, reload } = useRateLimitReport(apiBaseUrl, config.endpoint);
  // null = 尚未确定登录态；用它区分「未登录」与「已登录但还没有 agent 快照」，
  // 避免给已登录用户显示误导性的「GitHub 登录」按钮。
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    if (!base) {
      setAuthenticated(null);
      return;
    }
    let active = true;
    fetch(`${base}/api/auth/me`, { cache: "no-store", credentials: "include" })
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((payload: { authenticated?: boolean }) => {
        if (active) setAuthenticated(Boolean(payload.authenticated));
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, [base]);

  const loginWithGitHub = useCallback(() => {
    if (!base || typeof window === "undefined") {
      return;
    }

    window.location.href = `${base}/api/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`;
  }, [base]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <nav className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link href="/" className="text-slate-900">
          <TokenBoardLogo />
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <AppNavLinks active="limits" />
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
        <div className="mt-2">
          <LimitTabSwitcher tab={tab} onChange={setTab} />
        </div>

        <header className="mt-5">
          <p className="font-mono text-xs font-semibold uppercase text-blue-600">{config.eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{config.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{config.description}</p>
        </header>

        {state === "loading" && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            {config.loadingText}
          </div>
        )}

        {state === "error" && (
          <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            <p className="font-semibold">无法获取额度数据</p>
            <p className="mt-1">{error}</p>
            {config.errorHint(base)}
          </div>
        )}

        {state === "ready" && report && !report.available && (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <p className="font-semibold">{config.emptyTitle}</p>
            {report.notes.map((note) => (
              <p key={note} className="mt-1">
                {note}
              </p>
            ))}
            {config.emptyExtra(report)}
            {authenticated === true ? (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
                {config.waitingLabel}
              </p>
            ) : authenticated === false ? (
              <button
                type="button"
                onClick={loginWithGitHub}
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700"
              >
                {config.loginLabel}
              </button>
            ) : null}
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
