"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CodexRateLimitReport, CodexRateWindow } from "@open-token-board/core/codex-rate-limits";

import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogo } from "@/components/token-board-logo";
import { EmptyStatePanel, Skeleton } from "@/components/token-leaderboard/shared-ui";
import { useI18n } from "@/i18n";
import type { Dictionary } from "@/i18n/dictionaries";

const POLL_INTERVAL_MS = 15_000;
const TEAM_SNAPSHOT_STALE_SECONDS = 2 * 60 * 60;
const AGENT_SYNC_NOTE_RE = /^\u5df2\u4ece (.+) \u7684 token-board-agent \u540e\u53f0\u540c\u6b65\u8bfb\u53d6\u3002$/;

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

function fmtDuration(seconds: number | null, duration: Dictionary["limits"]["duration"]): string {
  if (seconds === null) return "—";
  if (seconds <= 0) return duration.expired;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return duration.daysHoursMinutes(d, h, m);
  if (h > 0) return duration.hoursMinutes(h, m);
  if (m > 0) return duration.minutesSeconds(m, s);
  return duration.seconds(s);
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
  labelKey: keyof Dictionary["limits"]["tone"];
} {
  if (usedPercent >= 90) {
    return {
      bar: "bg-rose-500",
      text: "text-rose-600",
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      track: "bg-rose-100",
      labelKey: "danger",
    };
  }
  if (usedPercent >= 70) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      track: "bg-amber-100",
      labelKey: "warning",
    };
  }
  return {
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    track: "bg-emerald-100",
    labelKey: "normal",
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

function burnLabel(metrics: ReturnType<typeof effectiveWindowMetrics>, burn: Dictionary["limits"]["burn"]): string {
  if (metrics.burnPercentPerHour === null) return burn.idle;
  const tokens = metrics.burnTokensPerHour !== null ? burn.tokensPerHour(fmtTokens(metrics.burnTokensPerHour)) : burn.emptyTokensPerHour;
  return burn.label(metrics.burnPercentPerHour.toFixed(1), tokens, metrics.burnIsAverage);
}

function limitWindowLabel(w: Pick<CodexRateWindow, "key" | "label">, copy: Dictionary["limits"]): string {
  if (w.key === "5h") return copy.window.labels.fiveHour;
  if (w.key === "weekly") return copy.window.labels.weekly;
  return w.label;
}

function formatLimitNote(note: string, copy: Dictionary["limits"]): string {
  const match = AGENT_SYNC_NOTE_RE.exec(note);
  return match ? copy.page.agentSyncedNote(match[1]) : note;
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
  const { dict } = useI18n();
  const copy = dict.limits;
  const tone = toneFor(w.usedPercent);
  const metrics = effectiveWindowMetrics(w, now);
  const windowSummary = copy.window.usedRemainingWindow(w.usedPercent.toFixed(0), w.remainingPercent.toFixed(0), w.windowMinutes);

  let etaNode: React.ReactNode;
  if (metrics.etaSeconds === null) {
    etaNode = <span className="text-emerald-600">{copy.window.noExhaust}</span>;
  } else if (metrics.willExhaustBeforeReset) {
    etaNode = (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
        {copy.window.exhaustBeforeReset(fmtDuration(metrics.etaSeconds, copy.duration))} <span className="text-rose-500">{copy.window.beforeReset}</span>
      </span>
    );
  } else {
    etaNode = (
      <span className="text-amber-600">
        {copy.window.exhaustAfterReset(fmtDuration(metrics.etaSeconds, copy.duration))} <span className="text-slate-400">{copy.window.afterReset}</span>
      </span>
    );
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{copy.window.title(limitWindowLabel(w, copy))}</h3>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${tone.badge}`}>
          {copy.tone[tone.labelKey]} · {copy.window.used(w.usedPercent.toFixed(0))}
        </span>
      </div>

      <div className="mt-5 flex items-end gap-3">
        <span className={`text-5xl font-semibold tabular-nums ${tone.text}`}>
          {w.remainingPercent.toFixed(0)}
          <span className="text-2xl">%</span>
        </span>
        <span className="pb-1 text-sm text-slate-500">{copy.window.remainingQuota}</span>
      </div>

      <div className="mt-4">
        <ProgressBar usedPercent={w.usedPercent} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <span className={`font-semibold ${tone.text}`}>{windowSummary.used}</span>
        <span className="text-slate-300"> · </span>
        <span className="font-semibold text-slate-700">{windowSummary.remaining}</span>
        <span className="text-slate-300"> · </span>
        <span className="font-mono">{windowSummary.minutes}</span>
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-slate-400">{copy.window.resetCountdown}</dt>
          <dd className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">{fmtDuration(metrics.resetsInSeconds, copy.duration)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">{copy.window.burnRate}</dt>
          <dd className="mt-1 font-semibold text-slate-900">{burnLabel(metrics, copy.burn)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-400">{copy.window.eta}</dt>
          <dd className="mt-1 font-semibold">{etaNode}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        {copy.window.capacity(fmtTokens(w.estimatedCapacityTokens), fmtTokens(w.estimatedRemainingTokens), fmtTokens(w.localConsumedTokensThisWindow))}
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
  const { dict } = useI18n();
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
      setError(dict.limits.status.apiMissing);
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
      setError(err instanceof Error ? err.message : dict.limits.status.requestFailed);
    }
  }, [base, dict.limits.status.apiMissing, dict.limits.status.requestFailed, endpoint, enabled]);

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
  const { dict } = useI18n();
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
      setError(dict.limits.status.apiMissing);
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
      setError(err instanceof Error ? err.message : dict.limits.status.requestFailed);
    }
  }, [base, dict.limits.status.apiMissing, dict.limits.status.requestFailed, enabled]);

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
  const { dict } = useI18n();
  const copy = dict.limits;
  const latestAgeSec = report.latestEventAt ? Math.round((now - Date.parse(report.latestEventAt)) / 1000) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
      {report.plan && (
        <span>
          {copy.status.plan(report.plan)}
        </span>
      )}
      {report.recentTokensPerHour !== null && (
        <span>
          {copy.status.recentThroughput(fmtTokens(report.recentTokensPerHour))}
        </span>
      )}
      {latestAgeSec !== null && (
        <span>
          {copy.status.latestActivity(fmtDuration(latestAgeSec, copy.duration))}
        </span>
      )}
      <span className="text-slate-400">{copy.status.autoRefresh}</span>
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
  const { dict } = useI18n();
  const copy = dict.limits;
  const authBox = (
    <div className="mt-8">
      <EmptyStatePanel
        title={copy.team.loginTitle}
        description={copy.team.loginDescription}
        action={
          <button
            type="button"
            onClick={loginWithGitHub}
            className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {copy.team.loginCta}
          </button>
        }
      />
    </div>
  );

  if (authenticated === false) {
    return authBox;
  }

  if (data.state === "loading") {
    return <LimitLoadingState label={copy.status.loadingTeam} />;
  }

  if (data.state === "error") {
    if (data.error === "HTTP 401") return authBox;
    return (
      <div className="mt-8">
        <EmptyStatePanel
          title={copy.team.errorTitle}
          description={data.error || copy.team.errorDescription}
        />
      </div>
    );
  }

  if (!data.report || data.report.users.length === 0) {
    return (
      <div className="mt-8">
        <EmptyStatePanel
          title={copy.team.emptyTitle}
          description={copy.team.emptyDescription}
        />
      </div>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {copy.team.summary(data.report.users.length, fmtDuration(data.report.staleAfterSeconds, copy.duration))}
        </span>
        <span className="text-slate-400">{copy.status.autoRefresh}</span>
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
  const { dict } = useI18n();
  const copy = dict.limits;
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
                {user.stale ? copy.team.stale : copy.team.fresh} · {copy.team.ago(fmtDuration(user.snapshotAgeSeconds, copy.duration))}
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
  const { dict } = useI18n();
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
          <TeamWindowBar label={dict.limits.team.weekShort} window={weekly} now={now} />
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">{dict.limits.team.noSnapshot}</p>
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
  const { dict } = useI18n();
  const copy = dict.limits;
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
        <span>{copy.team.remaining(window.remainingPercent.toFixed(0))}</span>
        <span>{copy.team.reset(fmtDuration(metrics.resetsInSeconds, copy.duration))}</span>
        {metrics.burnPercentPerHour !== null && <span>{burnLabel(metrics, copy.burn)}</span>}
      </div>
    </div>
  );
}

/**
 * 嵌入式额度面板：用于 /board 个人区域。未登录、未安装 agent 或还没有
 * 额度快照时静默隐藏，避免给公开榜单的访客显示报错。
 */
export function RateLimitPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { dict } = useI18n();
  const { report, state, now } = useRateLimitReport(apiBaseUrl);

  if (state !== "ready" || !report || !report.available || report.windows.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-stone-950/10 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{dict.limits.embedded.title}</h2>
          <p className="mt-1 text-xs text-slate-500">{dict.limits.embedded.description}</p>
        </div>
        <Link href="/limits" className="font-mono text-xs font-semibold text-blue-600 hover:text-blue-700">
          {dict.limits.embedded.pageLink}
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
  description: string;
  loadingText: string;
  errorHint: (base: string) => string;
  emptyTitle: string;
  emptyIntro: string;
  installHint: string;
  sourcePaths: string;
  loginLabel: string;
  waitingLabel: string;
}

const TAB_ENDPOINTS: Record<PersonalLimitTab, string> = {
  codex: "/api/usage/rate-limits",
  claude: "/api/usage/claude-rate-limits",
};

function buildTabConfig(tab: PersonalLimitTab, dict: Dictionary): TabConfig {
  return {
    ...dict.limits.config[tab],
    endpoint: TAB_ENDPOINTS[tab],
  };
}

function LimitTabSwitcher({ tab, onChange }: { tab: LimitTab; onChange: (next: LimitTab) => void }) {
  const { dict } = useI18n();
  const tabs: Array<{ key: LimitTab; label: string }> = [
    { key: "codex", label: dict.limits.config.codex.label },
    { key: "claude", label: dict.limits.config.claude.label },
    { key: "team", label: dict.limits.tabs.team },
  ];
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.key === tab));

  return (
    <div
      className="relative inline-grid overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
      role="tablist"
      aria-label={dict.limits.tabs.aria}
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

function LimitEmptyExtra({ config, report }: { config: TabConfig; report: CodexRateLimitReport }) {
  return (
    <>
      <p>{config.emptyIntro}</p>
      {report.sourcePaths.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/60 px-4 py-3">
          <p className="font-semibold text-amber-900">{config.sourcePaths}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs leading-5 text-amber-800">
            {report.sourcePaths.map((sourcePath) => (
              <li key={sourcePath}>{sourcePath}</li>
            ))}
          </ul>
        </div>
      )}
      {config.installHint ? <p className="mt-3">{config.installHint}</p> : null}
    </>
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
  const { dict } = useI18n();
  const [tab, setTab] = useState<LimitTab>(initialTab);
  const personalTab: PersonalLimitTab = tab === "team" ? "codex" : tab;
  const config = buildTabConfig(personalTab, dict);
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
            {dict.limits.page.refresh}
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
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">{dict.limits.page.teamEyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{dict.limits.page.teamTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {dict.limits.page.teamDescription}
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
              title={dict.limits.page.unavailableTitle}
              description={
                <>
                  <span>{error || dict.limits.page.unavailableDescription}</span>
                  <p className="mt-3 text-rose-600">{config.errorHint(base)}</p>
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
                  <span>{dict.limits.page.emptyDescription}</span>
                  {report.notes.map((note) => (
                    <span key={note} className="mt-1 block">
                      {formatLimitNote(note, dict.limits)}
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
              <LimitEmptyExtra config={config} report={report} />
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
                {dict.limits.page.note(formatLimitNote(note, dict.limits))}
              </p>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
