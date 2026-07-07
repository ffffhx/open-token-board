"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CodexRateLimitReport, CodexRateWindow } from "@open-token-board/core/codex-rate-limits";

import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogo } from "@/components/token-board-logo";
import { EmptyStatePanel, Skeleton } from "@/components/token-leaderboard/shared-ui";

const POLL_INTERVAL_MS = 15_000;
const TEAM_SNAPSHOT_STALE_SECONDS = 2 * 60 * 60;

type LoadState = "idle" | "loading" | "ready" | "error";

interface TeamRateLimitWindowSnapshot {
  key: "5h" | "weekly";
  windowMinutes: number;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  resetsInSeconds: number | null;
  observedAt: string;
  staleSeconds: number;
  burnPercentPerHour: number | null;
  burnTokensPerHour: number | null;
  etaSeconds: number | null;
  etaAt: string | null;
  willExhaustBeforeReset: boolean;
}

interface TeamRateLimitToolSnapshot {
  available: boolean;
  plan: string | null;
  generatedAt: string;
  latestEventAt: string | null;
  windows: TeamRateLimitWindowSnapshot[];
}

interface TeamRateLimitUser {
  userId: string;
  login: string;
  displayName: string;
  team: string | null;
  avatarUrl: string | null;
  updatedAt: string;
  snapshotAgeSeconds: number;
  stale: boolean;
  weeklyRemainingPercent: number | null;
  fiveHourRemainingPercent: number | null;
  codex: TeamRateLimitToolSnapshot | null;
  claudeCode: TeamRateLimitToolSnapshot | null;
}

interface TeamRateLimitReport {
  schemaVersion: 1;
  generatedAt: string;
  staleAfterSeconds: number;
  users: TeamRateLimitUser[];
}

// 模块级缓存：在路由切换（额度 ↔ 榜单 ↔ 其它页面）后仍保留上一次的额度快照。
// 组件卸载时这里不会被清空，切回来时能立即用旧数据渲染，再在后台静默刷新，
// 而不是每次都从空白 loading 重新拉取。
const rateLimitReportCache = new Map<string, CodexRateLimitReport>();
const teamRateLimitReportCache = new Map<string, TeamRateLimitReport>();
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

function toneFor(usedPercent: number): {
  bar: string;
  text: string;
  badge: string;
  track: string;
  label: string;
} {
  if (usedPercent >= 90) {
    return {
      bar: "bg-rose-500",
      text: "text-rose-600",
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      track: "bg-rose-100",
      label: "高危",
    };
  }
  if (usedPercent >= 70) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      track: "bg-amber-100",
      label: "预警",
    };
  }
  return {
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    track: "bg-emerald-100",
    label: "正常",
  };
}

function effectiveWindowMetrics(
  w: {
    windowMinutes: number;
    usedPercent: number;
    remainingPercent: number;
    resetsAt: string | null;
    resetsInSeconds: number | null;
    burnPercentPerHour: number | null;
    burnTokensPerHour: number | null;
    etaAt: string | null;
    etaSeconds: number | null;
    willExhaustBeforeReset: boolean;
    estimatedCapacityTokens?: number | null;
  },
  now: number,
) {
  const resetsInSeconds = secondsUntil(w.resetsAt, now) ?? w.resetsInSeconds;
  const averageBurnPercentPerHour = averageBurnSinceWindowStart(w, now);
  const burnPercentPerHour = w.burnPercentPerHour ?? averageBurnPercentPerHour;
  const burnTokensPerHour =
    w.burnTokensPerHour ??
    (burnPercentPerHour !== null && w.estimatedCapacityTokens !== null && w.estimatedCapacityTokens !== undefined
      ? Math.round((w.estimatedCapacityTokens * burnPercentPerHour) / 100)
      : null);

  let etaSeconds = secondsUntil(w.etaAt, now) ?? w.etaSeconds;
  let etaAt = w.etaAt;

  if (etaSeconds === null && burnPercentPerHour !== null && burnPercentPerHour > 0 && w.remainingPercent > 0) {
    etaSeconds = Math.round((w.remainingPercent / burnPercentPerHour) * 3600);
    etaAt = new Date(now + etaSeconds * 1000).toISOString();
  }

  return {
    resetsInSeconds,
    burnPercentPerHour,
    burnTokensPerHour,
    burnIsAverage: w.burnPercentPerHour === null && averageBurnPercentPerHour !== null,
    etaSeconds,
    etaAt,
    willExhaustBeforeReset: etaSeconds !== null && resetsInSeconds !== null ? etaSeconds < resetsInSeconds : w.willExhaustBeforeReset,
  };
}

function averageBurnSinceWindowStart(
  w: Pick<CodexRateWindow, "windowMinutes" | "usedPercent" | "resetsAt">,
  now: number,
): number | null {
  if (!w.resetsAt || w.usedPercent <= 0) return null;
  const resetMs = Date.parse(w.resetsAt);
  if (!Number.isFinite(resetMs) || resetMs <= now) return null;
  const windowMs = w.windowMinutes * 60 * 1000;
  const startMs = resetMs - windowMs;
  if (startMs >= now) return null;
  const elapsedHours = (now - startMs) / 3600 / 1000;
  return elapsedHours > 0 ? w.usedPercent / elapsedHours : null;
}

function burnLabel(metrics: ReturnType<typeof effectiveWindowMetrics>): string {
  if (metrics.burnPercentPerHour === null) return "空闲";
  const tokens = metrics.burnTokensPerHour !== null ? `≈ ${fmtTokens(metrics.burnTokensPerHour)} tokens/小时` : "tokens/小时 —";
  return `${metrics.burnPercentPerHour.toFixed(1)}%/小时 · ${tokens}${metrics.burnIsAverage ? " · 周期平均" : ""}`;
}

function ProgressBar({ usedPercent, height = "h-2.5" }: { usedPercent: number; height?: string }) {
  const tone = toneFor(usedPercent);
  return (
    <div className={`${height} w-full overflow-hidden rounded-full ${tone.track}`}>
      <div
        className={`h-full rounded-full ${tone.bar} transition-[width] duration-700`}
        style={{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }}
      />
    </div>
  );
}

function WindowCard({ window: w, now }: { window: CodexRateWindow; now: number }) {
  const tone = toneFor(w.usedPercent);
  const metrics = effectiveWindowMetrics(w, now);

  let etaNode: React.ReactNode;
  if (metrics.etaSeconds === null) {
    etaNode = <span className="text-emerald-600">当前速度下本周期不会耗尽</span>;
  } else if (metrics.willExhaustBeforeReset) {
    etaNode = (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
        约 {fmtDuration(metrics.etaSeconds)}后耗尽 <span className="text-rose-500">(早于重置)</span>
      </span>
    );
  } else {
    etaNode = (
      <span className="text-amber-600">
        约 {fmtDuration(metrics.etaSeconds)}后耗尽 <span className="text-slate-400">(晚于重置，会先刷新)</span>
      </span>
    );
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{w.label}窗口</h3>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${tone.badge}`}>
          {tone.label} · 已用 {w.usedPercent.toFixed(0)}%
        </span>
      </div>

      <div className="mt-5 flex items-end gap-3">
        <span className={`text-5xl font-semibold tabular-nums ${tone.text}`}>
          {w.remainingPercent.toFixed(0)}
          <span className="text-2xl">%</span>
        </span>
        <span className="pb-1 text-sm text-slate-500">剩余额度</span>
      </div>

      <div className="mt-4">
        <ProgressBar usedPercent={w.usedPercent} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        已用 <span className={`font-semibold ${tone.text}`}>{w.usedPercent.toFixed(0)}%</span>
        <span className="text-slate-300"> · </span>
        剩余 <span className="font-semibold text-slate-700">{w.remainingPercent.toFixed(0)}%</span>
        <span className="text-slate-300"> · </span>
        <span className="font-mono">{w.windowMinutes} 分钟</span>
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-slate-400">重置倒计时</dt>
          <dd className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">{fmtDuration(metrics.resetsInSeconds)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">消耗速度</dt>
          <dd className="mt-1 font-semibold text-slate-900">{burnLabel(metrics)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-400">预计耗尽</dt>
          <dd className="mt-1 font-semibold">{etaNode}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
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

function useRateLimitReport(apiBaseUrl: string, endpoint = "/api/usage/rate-limits", enabled = true): RateLimitData {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const key = rateLimitCacheKey(base, endpoint);
  const [report, setReport] = useState<CodexRateLimitReport | null>(() => rateLimitReportCache.get(key) ?? null);
  const [state, setState] = useState<LoadState>(() => (rateLimitReportCache.has(key) ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }
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
  }, [base, endpoint, enabled]);

  // 切换数据源（Codex ↔ Claude）时，用对应缓存立即回填；没缓存才回到 loading。
  // 既避免把上一个工具的额度显示在新标题下，也避免每次都从空白重新加载。
  useEffect(() => {
    if (!enabled) {
      setReport(null);
      setState("idle");
      setError(null);
      return;
    }
    const cached = rateLimitReportCache.get(key) ?? null;
    setReport(cached);
    setState(cached ? "ready" : "loading");
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    void reload();
    const poll = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [enabled, reload]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return { report, state, error, now, base, reload: () => void reload() };
}

interface TeamRateLimitData {
  report: TeamRateLimitReport | null;
  state: LoadState;
  error: string | null;
  now: number;
  base: string;
  reload: () => void;
}

function useTeamRateLimitReport(apiBaseUrl: string, enabled: boolean): TeamRateLimitData {
  const endpoint = "/api/usage/rate-limits/team";
  const base = apiBaseUrl.replace(/\/+$/, "");
  const key = rateLimitCacheKey(base, endpoint);
  const [report, setReport] = useState<TeamRateLimitReport | null>(() => teamRateLimitReportCache.get(key) ?? null);
  const [state, setState] = useState<LoadState>(() => (teamRateLimitReportCache.has(key) ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback(async () => {
    if (!enabled) return;
    if (!base) {
      setState("error");
      setError("未配置 API 地址。");
      return;
    }
    const cacheKey = rateLimitCacheKey(base, endpoint);
    if (!teamRateLimitReportCache.has(cacheKey)) setState("loading");
    try {
      const res = await fetch(`${base}${endpoint}`, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TeamRateLimitReport;
      teamRateLimitReportCache.set(cacheKey, data);
      setReport(data);
      setNow(Date.now());
      setState("ready");
      setError(null);
    } catch (err) {
      if (teamRateLimitReportCache.has(cacheKey)) return;
      setState("error");
      setError(err instanceof Error ? err.message : "请求失败");
    }
  }, [base, enabled]);

  useEffect(() => {
    if (!enabled) {
      setReport(null);
      setState("idle");
      setError(null);
      return;
    }
    const cached = teamRateLimitReportCache.get(key) ?? null;
    setReport(cached);
    setState(cached ? "ready" : "loading");
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    void reload();
    const poll = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [enabled, reload]);

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

function LimitLoadingState({ label }: { label: string }) {
  return (
    <div className="mt-8 space-y-5" role="status" aria-label={label}>
      <div className="otb-panel rounded-lg p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-5 h-12 w-32" />
              <Skeleton className="mt-4 h-3 w-full rounded-full" />
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">{label}</p>
    </div>
  );
}

function TeamRateLimitSection({
  data,
  authenticated,
  loginWithGitHub,
}: {
  data: TeamRateLimitData;
  authenticated: boolean | null;
  loginWithGitHub: () => void;
}) {
  const authBox = (
    <div className="mt-8">
      <EmptyStatePanel
        title="团队额度墙需要 GitHub 登录"
        description="登录后可查看团队内 agent 最近上传的 Codex 与 Claude Code 额度百分比。没登录时，这面墙只是一面墙。"
        action={
          <button
            type="button"
            onClick={loginWithGitHub}
            className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            GitHub 登录后查看团队墙
          </button>
        }
      />
    </div>
  );

  if (authenticated === false) {
    return authBox;
  }

  if (data.state === "loading") {
    return <LimitLoadingState label="正在汇总团队额度快照…" />;
  }

  if (data.state === "error") {
    if (data.error === "HTTP 401") return authBox;
    return (
      <div className="mt-8">
        <EmptyStatePanel
          title="无法获取团队额度墙"
          description={data.error || "额度快照暂时读不到，可以刷新或稍后再试。"}
        />
      </div>
    );
  }

  if (!data.report || data.report.users.length === 0) {
    return (
      <div className="mt-8">
        <EmptyStatePanel
          title="暂无团队额度快照"
          description="还没有成员上传额度。等第一台 agent 把 5 小时和每周窗口送上来，这里就会亮起来。"
        />
      </div>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {data.report.users.length} 人 · 按每周窗口剩余额度升序 · 快照超过 {fmtDuration(data.report.staleAfterSeconds)} 标记为数据过旧
        </span>
        <span className="text-slate-400">每 15 秒自动刷新</span>
      </div>
      <div className="mt-4 space-y-3">
        {data.report.users.map((user) => (
          <TeamRateLimitRow key={user.userId} user={user} now={data.now} />
        ))}
      </div>
    </section>
  );
}

function TeamRateLimitRow({ user, now }: { user: TeamRateLimitUser; now: number }) {
  return (
    <article
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition ${
        user.stale ? "opacity-60 grayscale" : ""
      }`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(12rem,16rem)_1fr] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="size-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 font-mono text-xs font-semibold text-slate-500">
              {user.login.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.displayName}</p>
            <p className="truncate font-mono text-xs text-slate-500">@{user.login}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {user.team && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{user.team}</span>
              )}
              <span
                className={
                  user.stale
                    ? "rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-500"
                    : "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700"
                }
              >
                {user.stale ? "数据过旧" : "新鲜"} · {fmtDuration(user.snapshotAgeSeconds)}前
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TeamToolQuota title="Codex" snapshot={user.codex} now={now} />
          <TeamToolQuota title="Claude Code" snapshot={user.claudeCode} now={now} />
        </div>
      </div>
    </article>
  );
}

function TeamToolQuota({
  title,
  snapshot,
  now,
}: {
  title: string;
  snapshot: TeamRateLimitToolSnapshot | null;
  now: number;
}) {
  const fiveHour = snapshot?.windows.find((w) => w.key === "5h") ?? null;
  const weekly = snapshot?.windows.find((w) => w.key === "weekly") ?? null;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        {snapshot?.plan && <span className="truncate font-mono text-[11px] text-slate-400">{snapshot.plan}</span>}
      </div>
      {snapshot ? (
        <div className="mt-3 space-y-2.5">
          <TeamWindowBar label="5h" window={fiveHour} now={now} />
          <TeamWindowBar label="周" window={weekly} now={now} />
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">暂无快照</p>
      )}
    </div>
  );
}

function TeamWindowBar({
  label,
  window,
  now,
}: {
  label: string;
  window: TeamRateLimitWindowSnapshot | null;
  now: number;
}) {
  if (!window) {
    return (
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs text-slate-400">
        <span className="font-mono font-semibold">{label}</span>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" />
        <span className="text-right">—</span>
      </div>
    );
  }

  const tone = toneFor(window.usedPercent);
  const metrics = effectiveWindowMetrics(window, now);

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
        <span className="font-mono font-semibold text-slate-500">{label}</span>
        <ProgressBar usedPercent={window.usedPercent} height="h-2" />
        <span className={`text-right font-mono font-semibold ${tone.text}`}>{window.usedPercent.toFixed(0)}%</span>
      </div>
      <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 pl-10 text-[11px] leading-4 text-slate-500">
        <span>剩余 {window.remainingPercent.toFixed(0)}%</span>
        <span>重置 {fmtDuration(metrics.resetsInSeconds)}</span>
        {metrics.burnPercentPerHour !== null && <span>{metrics.burnPercentPerHour.toFixed(1)}%/小时</span>}
      </div>
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

export type LimitTab = "codex" | "claude" | "team";
type PersonalLimitTab = Exclude<LimitTab, "team">;

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

const TAB_CONFIG: Record<PersonalLimitTab, TabConfig> = {
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
  const tabs: Array<{ key: LimitTab; label: string }> = [
    { key: "codex", label: TAB_CONFIG.codex.label },
    { key: "claude", label: TAB_CONFIG.claude.label },
    { key: "team", label: "团队" },
  ];
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.key === tab));

  return (
    <div
      className="relative inline-grid overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
      role="tablist"
      aria-label="额度数据源"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 z-0 h-0.5 rounded-full bg-blue-600 transition-transform"
        style={{
          width: `calc((100% - 0.5rem) / ${tabs.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {tabs.map(({ key, label }) => {
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
                ? "relative z-10 min-h-11 rounded-lg px-4 text-sm font-semibold text-blue-700 transition"
                : "relative z-10 min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            }
          >
            {label}
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
  initialTab?: PersonalLimitTab;
}) {
  const [tab, setTab] = useState<LimitTab>(initialTab);
  const personalTab: PersonalLimitTab = tab === "team" ? "codex" : tab;
  const config = TAB_CONFIG[personalTab];
  const personalData = useRateLimitReport(apiBaseUrl, config.endpoint, tab !== "team");
  const teamData = useTeamRateLimitReport(apiBaseUrl, tab === "team");
  const { report, state, error, now, base } = personalData;
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
            onClick={tab === "team" ? teamData.reload : personalData.reload}
            className="otb-energy-bg inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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
          {tab === "team" ? (
            <>
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">Team rate limit wall</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">团队额度墙</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                汇总团队成员最近一次 agent 上传的 Codex 与 Claude Code 额度快照，按每周窗口剩余从低到高排列。
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">{config.eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{config.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{config.description}</p>
            </>
          )}
        </header>

        {tab === "team" ? (
          <TeamRateLimitSection data={teamData} authenticated={authenticated} loginWithGitHub={loginWithGitHub} />
        ) : state === "loading" && (
          <LimitLoadingState label={config.loadingText} />
        )}

        {tab !== "team" && state === "error" && (
          <div className="mt-8">
            <EmptyStatePanel
              title="无法获取额度数据"
              description={
                <>
                  <span>{error || "额度接口暂时没有回应。"}</span>
                  {config.errorHint(base)}
                </>
              }
            />
          </div>
        )}

        {tab !== "team" && state === "ready" && report && !report.available && (
          <div className="mt-8">
            <EmptyStatePanel
              title={config.emptyTitle}
              description={
                <>
                  <span>额度侦察机还没发现可用快照。运行 agent 后等一次同步，这里就会出现倒计时和剩余额度。</span>
                  {report.notes.map((note) => (
                    <span key={note} className="mt-1 block">
                      {note}
                    </span>
                  ))}
                </>
              }
              action={
                authenticated === true ? (
                  <span className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-100 px-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100">
                    {config.waitingLabel}
                  </span>
                ) : authenticated === false ? (
                  <button
                    type="button"
                    onClick={loginWithGitHub}
                    className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {config.loginLabel}
                  </button>
                ) : null
              }
            />
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-400/25 dark:bg-amber-950/30 dark:text-amber-100">
              {config.emptyExtra(report)}
            </div>
          </div>
        )}

        {tab !== "team" && report && report.available && (
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
