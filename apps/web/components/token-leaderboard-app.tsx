"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildTokenLeaderboard,
  getInputContextTokens,
  getTokenConsumptionTokens,
  type TokenAccountUsageProfile,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenLeaderboardSummary,
} from "@open-token-board/core";
import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogoMark } from "@/components/token-board-logo";
import { RateLimitPanel } from "@/components/rate-limit/rate-limit-board";

import { AccountUsagePanel } from "./token-leaderboard/account-usage-panel";
import {
  DATA_LOAD_SLOW_MS,
  METRICS,
  NPX_STATUS_COMMAND,
  RANGES,
  ROLLING_RANGE_LABELS,
  TOAST_DISMISS_MS,
} from "./token-leaderboard/constants";
import { InstallGuideDialog } from "./token-leaderboard/install-guide-dialog";
import {
  BreakdownPanel,
  DailyTokenTrendChart,
  EfficiencyStrip,
  EmptyPanelMessage,
  GitHubAuthControl,
  HeroSignal,
  InsightStrip,
  LeaderboardEmptyRow,
  LeaderboardEmptyState,
  LeaderboardErrorRow,
  LeaderboardErrorState,
  LeaderboardLoadingRow,
  LeaderboardMobileCard,
  LeaderboardRow,
  MobileLeaderboardLoading,
  PanelHeader,
  SegmentedControl,
  ShareLoadingRows,
  ShareRow,
  SortableColumnHeader,
  StatTile,
  TrustEvidenceBar,
} from "./token-leaderboard/leaderboard-panels";
import { Icon, LoadingInline, Skeleton, Toast } from "./token-leaderboard/shared-ui";
import type {
  AccountLoadState,
  AccountUsageResponse,
  DataLoadState,
  InstallGuidePlatform,
  RemoteStatsResponse,
  ToastState,
  ToastTone,
  ViewerState,
} from "./token-leaderboard/types";
import {
  buildLeaderboardInsight,
  detectInstallGuidePlatform,
  formatMetricValue,
  formatNumber,
  formatShortDate,
  formatTokens,
  formatUsd,
  getUserMetricValue,
  isTokenAccountUsageProfile,
  isTokenLeaderboardSummary,
  normalizeApiBaseUrl,
  normalizeRemoteAccountProfile,
  normalizeRemoteSummary,
} from "./token-leaderboard/utils";

// 模块级缓存：路由切换（榜单 ↔ 额度 ↔ 其它页面）会卸载本组件，但这两个 Map
// 不随之销毁。切回来时先用缓存立即渲染，再在后台静默刷新，避免每次都从骨架屏重拉。
const statsCache = new Map<string, { summary: TokenLeaderboardSummary; records: number | null }>();
const accountCache = new Map<string, TokenAccountUsageProfile>();
function statsCacheKey(base: string, range: TokenBoardRange, metric: TokenBoardMetric): string {
  return `${base}|${range}|${metric}`;
}
function accountCacheKey(base: string, userId: string, range: TokenBoardRange): string {
  return `${base}|${userId}|${range}`;
}

export function TokenLeaderboardApp({
  initialNow,
  apiBaseUrl,
}: {
  initialNow: string;
  apiBaseUrl?: string;
}) {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const [range, setRange] = useState<TokenBoardRange>("1D");
  const [metric, setMetric] = useState<TokenBoardMetric>("tokens");
  // 首次渲染就读缓存：切回榜单时直接显示上次数据，而不是先闪一帧骨架屏。
  const initialStats = statsCache.get(statsCacheKey(normalizedApiBaseUrl, range, metric)) ?? null;
  const [status, setStatus] = useState(
    initialStats
      ? `后端数据 ${initialStats.records ?? initialStats.summary.users.length} 条`
      : "正在加载真实用户数据"
  );
  const [dataLoadState, setDataLoadState] = useState<DataLoadState>(initialStats ? "ready" : "loading");
  const [dataLoadError, setDataLoadError] = useState("");
  const [isLoadSlow, setIsLoadSlow] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [remoteSummary, setRemoteSummary] = useState<TokenLeaderboardSummary | null>(
    initialStats?.summary ?? null
  );
  const [remoteRecordCount, setRemoteRecordCount] = useState<number | null>(initialStats?.records ?? null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [accountProfile, setAccountProfile] = useState<TokenAccountUsageProfile | null>(null);
  const [accountLoadState, setAccountLoadState] = useState<AccountLoadState>("idle");
  const [accountError, setAccountError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [installGuidePlatform, setInstallGuidePlatform] = useState<InstallGuidePlatform>("macos");
  const [installGuideStep, setInstallGuideStep] = useState(0);

  useEffect(() => {
    setNow(new Date());
    setInstallGuidePlatform(detectInstallGuidePlatform());
  }, []);

  useEffect(() => {
    if (dataLoadState !== "loading") {
      setIsLoadSlow(false);
      return;
    }

    const timer = window.setTimeout(() => setIsLoadSlow(true), DATA_LOAD_SLOW_MS);

    return () => window.clearTimeout(timer);
  }, [dataLoadState, reloadKey]);

  useEffect(() => {
    if (!normalizedApiBaseUrl) {
      setRemoteSummary(null);
      setRemoteRecordCount(null);
      setDataLoadState("error");
      setDataLoadError("未配置 Token Board API，无法读取自动上报数据");
      setStatus("需要连接 Token Board 后端后才能加载榜单");
      return;
    }

    let active = true;
    const params = new URLSearchParams({ range, metric });
    const cacheKey = statsCacheKey(normalizedApiBaseUrl, range, metric);
    const cached = statsCache.get(cacheKey);

    if (cached) {
      // 已加载过的区间先用缓存立即展示，下面的请求只做后台静默刷新
      setRemoteSummary(cached.summary);
      setRemoteRecordCount(cached.records);
      setDataLoadState("ready");
      setDataLoadError("");
      setStatus(`后端数据 ${cached.records ?? cached.summary.users.length} 条`);
    } else {
      setRemoteSummary(null);
      setRemoteRecordCount(null);
      setDataLoadState("loading");
      setDataLoadError("");
      setStatus("正在加载真实用户数据");
    }
    fetch(`${normalizedApiBaseUrl}/api/usage/stats?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json() as Promise<RemoteStatsResponse>;
      })
      .then((payload) => {
        const summary = "summary" in payload && payload.summary ? payload.summary : payload;
        if (!isTokenLeaderboardSummary(summary)) {
          throw new Error("后端返回格式不正确");
        }

        const normalized = normalizeRemoteSummary(summary, metric);
        const records = typeof payload.records === "number" ? payload.records : null;
        statsCache.set(cacheKey, { summary: normalized, records });

        if (!active) {
          return;
        }

        setRemoteSummary(normalized);
        setRemoteRecordCount(records);
        setDataLoadState("ready");
        setDataLoadError("");
        setStatus(`后端数据 ${records ?? summary.users.length} 条`);
      })
      .catch((error) => {
        // 后台刷新失败时继续展示缓存数据，不打断用户
        if (!active || statsCache.has(cacheKey)) {
          return;
        }

        setRemoteSummary(null);
        setRemoteRecordCount(null);
        setDataLoadState("error");
        const message = error instanceof Error ? error.message : "读取失败";
        setDataLoadError(message);
        setStatus(`真实用户数据读取失败：${message}`);
      });

    return () => {
      active = false;
    };
  }, [metric, normalizedApiBaseUrl, range, reloadKey]);

  useEffect(() => {
    if (!normalizedApiBaseUrl) {
      setViewer(null);
      return;
    }

    let active = true;

    fetch(`${normalizedApiBaseUrl}/api/auth/me`, { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : { authenticated: false }))
      .then((payload: ViewerState) => {
        if (active) {
          setViewer(payload);
        }
      })
      .catch(() => {
        if (active) {
          setViewer({ authenticated: false });
        }
      });

    return () => {
      active = false;
    };
  }, [normalizedApiBaseUrl]);

  useEffect(() => {
    if (!normalizedApiBaseUrl || !viewer?.authenticated) {
      setAccountProfile(null);
      setAccountLoadState("idle");
      setAccountError("");
      return;
    }

    let active = true;
    const params = new URLSearchParams({ range });
    const cacheKey = accountCacheKey(normalizedApiBaseUrl, viewer.user?.userId ?? "viewer", range);
    const cached = accountCache.get(cacheKey);

    if (cached) {
      // 已加载过的区间先用缓存立即展示，下面的请求只做后台静默刷新
      setAccountProfile(cached);
      setAccountLoadState("ready");
      setAccountError("");
    } else {
      setAccountLoadState("loading");
      setAccountError("");
    }
    fetch(`${normalizedApiBaseUrl}/api/usage/me?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json() as Promise<AccountUsageResponse>;
      })
      .then((payload) => {
        if (!isTokenAccountUsageProfile(payload.profile)) {
          throw new Error("后端返回格式不正确");
        }

        const normalized = normalizeRemoteAccountProfile(payload.profile);
        accountCache.set(cacheKey, normalized);

        if (!active) {
          return;
        }

        setAccountProfile(normalized);
        setAccountLoadState("ready");
      })
      .catch((error) => {
        // 后台刷新失败时继续展示缓存数据，不打断用户
        if (!active || accountCache.has(cacheKey)) {
          return;
        }

        setAccountProfile(null);
        setAccountLoadState("error");
        setAccountError(error instanceof Error ? error.message : "读取失败");
      });

    return () => {
      active = false;
    };
  }, [normalizedApiBaseUrl, range, viewer?.authenticated, viewer?.user?.userId]);

  const emptySummary = useMemo(
    () => buildTokenLeaderboard([], { range, metric, now }),
    [metric, now, range]
  );
  const summary = remoteSummary ?? emptySummary;
  const recordCount = remoteRecordCount ?? 0;
  const isDataLoading = dataLoadState === "loading" && !remoteSummary;
  const isDataError = dataLoadState === "error" && !remoteSummary;
  const metricItems = METRICS.map((item) => ({ key: item.key, label: item.label }));
  const sourceLabel = isDataLoading ? "loading" : isDataError ? "error" : "server";
  const statusMessage = isDataLoading
    ? isLoadSlow
      ? "数据加载较慢，可以稍后重试，或确认 agent 是否已上报"
      : status
    : remoteSummary
      ? `后端数据 ${recordCount} 条`
      : status;

  const topUsers = summary.users.slice(0, 8);
  const leader = summary.users[0];
  const showDailyLeaderboardTrend = range !== "1D";
  const leaderboardColumnCount = showDailyLeaderboardTrend ? 7 : 6;
  const maxDailyTokens = Math.max(1, ...summary.daily.map((point) => point.tokens));
  const selectedMetricLabel = METRICS.find((item) => item.key === metric)?.label ?? "总消耗";
  const shareTotal = Math.max(0, summary.users.reduce((sum, user) => sum + getUserMetricValue(user, metric), 0));
  const totalInputContextTokens = summary.users.reduce((sum, user) => sum + getInputContextTokens(user), 0);
  const totalCachedInputTokens = summary.users.reduce((sum, user) => sum + user.cachedInputTokens, 0);
  const totalConsumptionTokens = summary.users.reduce((sum, user) => sum + getTokenConsumptionTokens(user), 0);
  const cacheHitRate = totalInputContextTokens > 0 ? totalCachedInputTokens / totalInputContextTokens : 0;
  const tokensPerSession = summary.totalSessions > 0 ? totalConsumptionTokens / summary.totalSessions : 0;
  const costPerSession = summary.totalSessions > 0 ? summary.totalCostUsd / summary.totalSessions : 0;
  const daysInRange = Math.max(1, summary.daily.length);
  const dailyAverageTokens = totalConsumptionTokens / daysInRange;
  const leaderMeta = leader ? formatMetricValue(getUserMetricValue(leader, metric), metric) : "--";
  const topModelLabel = summary.topModel === "unknown" ? "--" : summary.topModel;
  const topToolLabel = summary.topTool === "unknown" ? "--" : summary.topTool;
  const recordCountLabel = formatNumber(recordCount);
  const rangeRecordCount = summary.users.reduce((sum, user) => sum + user.records, 0);
  const rangeRecordCountLabel = formatNumber(rangeRecordCount);
  const insightText = isDataLoading
    ? "正在生成自动洞察"
    : buildLeaderboardInsight(summary, cacheHitRate);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), TOAST_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!installGuideOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInstallGuideOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [installGuideOpen]);

  function showToast(message: string, tone: ToastTone = "success") {
    setToast({ id: Date.now(), message, tone });
  }

  function openInstallGuide() {
    setInstallGuidePlatform(detectInstallGuidePlatform());
    setInstallGuideStep(0);
    setInstallGuideOpen(true);
  }

  function closeInstallGuide() {
    setInstallGuideOpen(false);
  }

  function changeInstallGuidePlatform(platform: InstallGuidePlatform) {
    setInstallGuidePlatform(platform);
    setInstallGuideStep(0);
  }

  function loginWithGitHub() {
    if (!normalizedApiBaseUrl) {
      return;
    }

    window.location.href = `${normalizedApiBaseUrl}/api/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`;
  }

  function logoutGitHub() {
    if (!normalizedApiBaseUrl) {
      return;
    }

    const confirmed = window.confirm("确认退出当前 GitHub 账号吗？退出后将暂时看不到个人 Token 消耗。");
    if (!confirmed) {
      return;
    }

    window.location.href = `${normalizedApiBaseUrl}/api/auth/logout?returnTo=${encodeURIComponent(window.location.href)}`;
  }

  function retryDataLoad() {
    statsCache.clear();
    accountCache.clear();
    setDataLoadState("loading");
    setDataLoadError("");
    setStatus("正在重新加载真实用户数据");
    showToast("正在刷新榜单");
    setReloadKey((value) => value + 1);
  }

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      const message = `已复制${label}`;
      setStatus(message);
      showToast(message);
    } catch {
      const message = `${label}复制失败，请手动复制`;
      setStatus(message);
      showToast(message, "error");
    }
  }

  const leaderboardPanel = (
    <section id="token-leaderboard-rankings" className="min-w-0 overflow-hidden rounded-lg border border-stone-950/10 bg-white shadow-sm">
      <PanelHeader
        title="排行榜"
        meta={isDataLoading ? <Skeleton className="h-3 w-40 align-middle" /> : `${summary.users.length} 位用户 · 当前区间 ${rangeRecordCountLabel} 条`}
        action={`按${selectedMetricLabel}降序`}
      />
      <div className="grid gap-3 p-3 sm:hidden">
        {isDataLoading ? (
          <MobileLeaderboardLoading slow={isLoadSlow} />
        ) : isDataError ? (
          <LeaderboardErrorState error={dataLoadError} onRetry={retryDataLoad} />
        ) : summary.users.length ? (
          topUsers.map((user) => (
            <LeaderboardMobileCard
              key={user.userId}
              metric={metric}
              range={range}
              showDailyTrend={showDailyLeaderboardTrend}
              user={user}
            />
          ))
        ) : (
          <LeaderboardEmptyState />
        )}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className={`w-full border-collapse text-left text-sm ${showDailyLeaderboardTrend ? "min-w-[960px]" : "min-w-[720px]"}`}>
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">排名</th>
              <th className="px-4 py-3">用户</th>
              {showDailyLeaderboardTrend ? <th className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">用量趋势</th> : null}
              <SortableColumnHeader active={metric === "tokens"} align="right">总消耗 Token</SortableColumnHeader>
              <SortableColumnHeader active={metric === "cost"} align="right">费用</SortableColumnHeader>
              <SortableColumnHeader active={metric === "sessions"} align="right">会话</SortableColumnHeader>
              <th className="px-4 py-3">常用模型</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-950/8">
            {isDataLoading ? (
              <LeaderboardLoadingRow columnCount={leaderboardColumnCount} slow={isLoadSlow} />
            ) : isDataError ? (
              <LeaderboardErrorRow columnCount={leaderboardColumnCount} error={dataLoadError} onRetry={retryDataLoad} />
            ) : summary.users.length ? (
              summary.users.map((user) => (
                <LeaderboardRow key={user.userId} range={range} showDailyTrend={showDailyLeaderboardTrend} user={user} />
              ))
            ) : (
              <LeaderboardEmptyRow columnCount={leaderboardColumnCount} />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  const sharePanel = (
    <section className="rounded-lg border border-stone-950/10 bg-slate-50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{selectedMetricLabel}份额</h2>
        <span className="font-mono text-xs text-stone-500">
          {isDataLoading ? <Skeleton className="h-3 w-10 align-middle" /> : `${topUsers.length} 人`}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {isDataLoading ? <ShareLoadingRows /> : topUsers.length ? topUsers.map((user) => (
          <ShareRow key={user.userId} metric={metric} total={shareTotal} user={user} />
        )) : <EmptyPanelMessage />}
      </div>
    </section>
  );

  const dataEntryPanel = (
    <section className="rounded-lg border border-stone-950/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">加入榜单</h2>
          <p className="mt-1 text-xs text-stone-500">安装 agent 后从本机采集 token 记录并自动上报。</p>
        </div>
        <span className="rounded-full bg-stone-950 px-2.5 py-1 font-mono text-xs text-white">
          {isDataLoading ? <Skeleton className="h-3 w-10 align-middle" /> : rangeRecordCountLabel}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {normalizedApiBaseUrl ? (
          <div className="rounded-lg border border-blue-600/25 bg-blue-50 p-3 text-xs text-blue-900">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">自动上报</p>
              <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[11px]">live</span>
            </div>
            <p className="mt-2 text-blue-600">
              {viewer?.authenticated
                ? `当前账号 @${viewer.user?.githubLogin || viewer.user?.displayName}`
                : "GitHub 登录 + npx agent，从你的电脑上报"}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-600/25 bg-red-50 p-3 text-xs text-red-900">
            <p className="font-semibold">等待 Token Board 后端</p>
            <p className="mt-2">页面已关闭静态 JSON、本地缓存和手动导入，只会读取自动上报服务。</p>
          </div>
        )}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={openInstallGuide}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-blue-600"
          >
            <Icon name="guide" />
            使用安装指南
          </button>
          <button
            type="button"
            onClick={() => void copyCommand(NPX_STATUS_COMMAND, "状态检查命令")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-blue-600/40 hover:bg-blue-50"
          >
            <Icon name="refresh" />
            复制状态检查命令
          </button>
          {!viewer?.authenticated && normalizedApiBaseUrl ? (
            <button
              type="button"
              onClick={loginWithGitHub}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-blue-600/40 hover:bg-blue-50"
            >
              <Icon name="github" />
              GitHub 登录
            </button>
          ) : null}
        </div>
        <p className="min-h-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-stone-600" aria-live="polite">
          {isDataLoading ? <LoadingInline label={statusMessage} /> : statusMessage}
        </p>
      </div>
    </section>
  );

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6 font-sans text-slate-950 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <header className="overflow-hidden rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6 lg:px-7">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
                <TokenBoardLogoMark className="size-7 shrink-0" decorative />
                <span className="truncate">Open Token Board</span>
              </div>
              <AppNavLinks active="board" className="justify-start lg:justify-end" />
            </div>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1 pl-1.5 pr-3 text-xs font-semibold uppercase text-blue-700">
                    <TokenBoardLogoMark className="size-4 shrink-0" decorative />
                    Open Token Board
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {isDataLoading ? <Skeleton className="h-3 w-12 align-middle" /> : sourceLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-xs text-slate-500">
                    {ROLLING_RANGE_LABELS[range]}
                  </span>
                </div>
                <h1 className="mt-3 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                  朋友间的 Token 排行榜
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {`${formatShortDate(summary.startAt)} - ${formatShortDate(summary.endAt)} · Asia/Shanghai`}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 xl:w-auto xl:items-end">
                <GitHubAuthControl viewer={viewer} onLogout={logoutGitHub} />
                <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto">
                  <SegmentedControl
                    items={RANGES.map((item) => ({ key: item, label: item }))}
                    value={range}
                    onChange={(value) => setRange(value as TokenBoardRange)}
                    label="时间范围"
                  />
                  <SegmentedControl
                    items={metricItems}
                    value={metric}
                    onChange={(value) => setMetric(value as TokenBoardMetric)}
                    label="排序指标"
                  />
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2 xl:max-w-[32rem]">
                  <button
                    type="button"
                    onClick={openInstallGuide}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <Icon name="guide" />
                    使用安装指南
                  </button>
                  {!viewer?.authenticated && normalizedApiBaseUrl ? (
                    <button
                      type="button"
                      onClick={loginWithGitHub}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Icon name="github" />
                      GitHub 登录
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryDataLoad}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Icon name="refresh" />
                      刷新榜单
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
              <HeroSignal
                label="当前榜首"
                value={isDataLoading ? <Skeleton className="h-5 w-28" /> : leader?.displayName ?? "--"}
                meta={isDataLoading ? <Skeleton className="h-3 w-16" /> : leaderMeta}
              />
              <HeroSignal
                label="当前区间记录"
                value={isDataLoading ? <Skeleton className="h-5 w-20" /> : rangeRecordCountLabel}
                meta={isDataLoading ? <Skeleton className="h-3 w-24" /> : `${ROLLING_RANGE_LABELS[range]}`}
              />
              <HeroSignal
                label="高频组合"
                value={isDataLoading ? <Skeleton className="h-5 w-24" /> : topModelLabel}
                meta={isDataLoading ? <Skeleton className="h-3 w-16" /> : topToolLabel}
              />
            </div>
            <TrustEvidenceBar
              apiBaseUrl={normalizedApiBaseUrl}
              error={isDataError ? dataLoadError : ""}
              loading={isDataLoading}
              range={range}
              rangeRecordCount={rangeRecordCount}
              recordCount={recordCount}
              sourceLabel={sourceLabel}
              summary={summary}
            />
          </div>
        </header>

        <InsightStrip loading={isDataLoading} text={insightText} />

        {leaderboardPanel}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="总消耗 Token"
                value={isDataLoading ? <Skeleton className="h-8 w-28" /> : formatTokens(totalConsumptionTokens)}
                meta={isDataLoading ? "" : "输入上下文 + 输出 Token"}
                tone="ink"
              />
              <StatTile
                label="活跃用户"
                value={isDataLoading ? <Skeleton className="h-8 w-20" /> : formatNumber(summary.activeUsers)}
                meta={isDataLoading ? "" : `${summary.activeUsers} 位参与`}
                tone="mint"
              />
              <StatTile
                label="会话"
                value={isDataLoading ? <Skeleton className="h-8 w-20" /> : formatNumber(summary.totalSessions)}
                meta={isDataLoading ? "" : "Sessions"}
                tone="blue"
              />
              <StatTile
                label="估算费用"
                value={isDataLoading ? <Skeleton className="h-8 w-24" /> : formatUsd(summary.totalCostUsd)}
                meta={isDataLoading ? "" : "非实际账单"}
                tone="gold"
              />
            </div>

            <EfficiencyStrip
              cacheHitRate={cacheHitRate}
              costPerSession={costPerSession}
              dailyAverageTokens={dailyAverageTokens}
              loading={isDataLoading}
              tokensPerSession={tokensPerSession}
            />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]">
              <section className="rounded-lg border border-stone-950/10 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Token 趋势</h2>
                  <p className="font-mono text-xs text-stone-500">
                    峰值 {isDataLoading ? <Skeleton className="h-3 w-12 align-middle" /> : formatTokens(maxDailyTokens)}
                  </p>
                </div>
                <div
                  className="mt-4 grid h-64 grid-cols-[repeat(auto-fit,minmax(8px,1fr))] items-end gap-1 rounded-lg border border-stone-950/8 bg-[linear-gradient(180deg,rgba(17,19,15,0.04),transparent)] px-3 pb-3 pt-5"
                  aria-label="Token 趋势"
                >
                  <DailyTokenTrendChart
                    daily={summary.daily}
                    loading={isDataLoading}
                    maxDailyTokens={maxDailyTokens}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono text-xs text-stone-500">
                  <span>{isDataLoading ? "--" : summary.daily[0]?.date.slice(5) ?? "--"}</span>
                  <span>{isDataLoading ? "--" : summary.daily.at(-1)?.date.slice(5) ?? "--"}</span>
                </div>
              </section>

              <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                {sharePanel}
                <BreakdownPanel title="模型消耗" loading={isDataLoading} items={summary.models.map((item) => ({
                  name: item.name,
                  value: item.tokens,
                  meta: formatUsd(item.costUsd),
                  share: item.share,
                }))} />
                <BreakdownPanel title="工具分布" loading={isDataLoading} items={summary.tools.map((item) => ({
                  name: item.name,
                  value: item.tokens,
                  meta: `${formatNumber(item.sessions)} 会话`,
                  share: item.share,
                }))} />
              </section>
            </div>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            {dataEntryPanel}

            <section className="rounded-lg border border-stone-950/10 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">统计口径</h2>
              <div className="mt-3 space-y-2 text-xs leading-5 text-stone-600">
                <p>
                  <strong className="text-stone-900">时间窗口</strong>：{ROLLING_RANGE_LABELS[range]}，展示时间按 Asia/Shanghai。
                </p>
                <p>
                  <strong className="text-stone-900">记录数</strong>：{isDataLoading ? <Skeleton className="h-3 w-48 align-middle" /> : `全库/可用记录 ${recordCountLabel} 条；当前区间参与排行 ${rangeRecordCountLabel} 条`}。
                </p>
                <p>
                  <strong className="text-stone-900">统计截至</strong>：{formatShortDate(summary.endAt)}。
                </p>
                <p>
                  <strong className="text-stone-900">费用是估算值</strong>：按公开模型单价计算，不等同于账号额度或实际账单。
                </p>
                <p>
                  <strong className="text-stone-900">Token 主口径</strong>：总消耗 Token = 输入上下文（input）+ 输出 Token；缓存命中是输入上下文的子集，推理 token 在个人视图单独展开。
                </p>
                <p>
                  <strong className="text-stone-900">隐私边界</strong>：只展示 token、模型、工具、项目 basename 与会话短标题，不展示完整 prompt 文本。
                </p>
              </div>
            </section>
          </aside>
        </div>

        <RateLimitPanel apiBaseUrl={normalizedApiBaseUrl} />

        <AccountUsagePanel
          apiEnabled={Boolean(normalizedApiBaseUrl)}
          error={accountError}
          loadState={accountLoadState}
          onLogin={loginWithGitHub}
          profile={accountProfile}
          range={range}
          viewer={viewer}
        />
      </div>
      <InstallGuideDialog
        canLogin={!viewer?.authenticated && Boolean(normalizedApiBaseUrl)}
        onClose={closeInstallGuide}
        onCopy={(command, label) => void copyCommand(command, label)}
        onLogin={loginWithGitHub}
        onPlatformChange={changeInstallGuidePlatform}
        onRefresh={retryDataLoad}
        onStepChange={setInstallGuideStep}
        open={installGuideOpen}
        platform={installGuidePlatform}
        stepIndex={installGuideStep}
      />
      <Toast toast={toast} />
    </main>
  );
}
