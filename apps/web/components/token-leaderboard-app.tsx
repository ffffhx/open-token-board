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
  type TokenTrendMetricValues,
} from "@open-token-board/core";
import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogoMark } from "@/components/token-board-logo";
import { RateLimitPanel } from "@/components/rate-limit/rate-limit-board";
import { useI18n } from "@/i18n";

import { AccountUsagePanel } from "./token-leaderboard/account-usage-panel";
import {
  ProjectConsumptionPanel,
  TeamBattlePanel,
  UsageDistributionPanel,
} from "./token-leaderboard/board-dimension-panels";
import {
  CALENDAR_RANGES,
  DATA_LOAD_SLOW_MS,
  METRIC_KEYS,
  NPX_STATUS_COMMAND,
  ROLLING_RANGES,
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
  latestReportedAt,
  normalizeApiBaseUrl,
  normalizeRemoteAccountProfile,
  normalizeRemoteSummary,
} from "./token-leaderboard/utils";

// 模块级缓存：路由切换（榜单 ↔ 额度 ↔ 其它页面）会卸载本组件，但这两个 Map
// 不随之销毁。切回来时先用缓存立即渲染，再在后台静默刷新，避免每次都从骨架屏重拉。
const statsCache = new Map<string, { summary: TokenLeaderboardSummary; records: number | null }>();
const accountCache = new Map<string, TokenAccountUsageProfile>();
function statsCacheKey(base: string, rangeKey: string, metric: TokenBoardMetric): string {
  return `${base}|${rangeKey}|${metric}`;
}
function accountCacheKey(base: string, userId: string, range: TokenBoardRange): string {
  return `${base}|${userId}|${range}`;
}

type AppliedCustomRange = {
  from: string;
  to: string;
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getTeamTrendMetricValue(
  point: (TokenLeaderboardSummary["daily"][number] & Partial<TokenTrendMetricValues>),
  metric: TokenBoardMetric
) {
  if (metric === "cost") {
    return point.costUsd ?? 0;
  }

  if (metric === "sessions") {
    return point.sessions ?? 0;
  }

  if (metric === "messages") {
    return point.messages ?? 0;
  }

  if (metric === "users") {
    return point.activeUsers ?? 0;
  }

  return point.tokens;
}

function shanghaiDayKey(value = new Date()) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function addDaysToDayKey(dayKey: string, days: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function customRangeKey(range: AppliedCustomRange | null) {
  return range ? `custom:${range.from}:${range.to}` : "custom:pending";
}

function chartRangeForDailyLength(days: number): TokenBoardRange {
  if (days >= 75) {
    return "90D";
  }

  if (days >= 21) {
    return "30D";
  }

  return days <= 1 ? "1D" : "7D";
}

export function TokenLeaderboardApp({
  initialNow,
  apiBaseUrl,
}: {
  initialNow: string;
  apiBaseUrl?: string;
}) {
  const { dict } = useI18n();
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const [range, setRange] = useState<TokenBoardRange>("1D");
  const [metric, setMetric] = useState<TokenBoardMetric>("tokens");
  const [customFrom, setCustomFrom] = useState(() => addDaysToDayKey(shanghaiDayKey(), -6));
  const [customTo, setCustomTo] = useState(() => shanghaiDayKey());
  const [appliedCustomRange, setAppliedCustomRange] = useState<AppliedCustomRange | null>(null);
  const isCustomRange = Boolean(appliedCustomRange);
  const statsRangeKey = isCustomRange ? customRangeKey(appliedCustomRange) : range;
  // 首次渲染就读缓存：切回榜单时直接显示上次数据，而不是先闪一帧骨架屏。
  const initialStats = statsCache.get(statsCacheKey(normalizedApiBaseUrl, statsRangeKey, metric)) ?? null;
  const [status, setStatus] = useState(
    initialStats
      ? dict.board.status.backendRows(formatNumber(initialStats.records ?? initialStats.summary.users.length))
      : dict.board.status.loadingRealUsers
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
      setDataLoadError(dict.board.status.apiMissing);
      setStatus(dict.board.status.apiRequired);
      return;
    }

    if (isCustomRange && !appliedCustomRange) {
      return;
    }

    let active = true;
    const params = new URLSearchParams({ metric });

    if (isCustomRange && appliedCustomRange) {
      params.set("from", appliedCustomRange.from);
      params.set("to", appliedCustomRange.to);
    } else {
      params.set("range", range);
    }

    const cacheKey = statsCacheKey(normalizedApiBaseUrl, statsRangeKey, metric);
    const cached = statsCache.get(cacheKey);

    if (cached) {
      // 已加载过的区间先用缓存立即展示，下面的请求只做后台静默刷新
      setRemoteSummary(cached.summary);
      setRemoteRecordCount(cached.records);
      setDataLoadState("ready");
      setDataLoadError("");
      setStatus(dict.board.status.backendRows(formatNumber(cached.records ?? cached.summary.users.length)));
    } else {
      setRemoteSummary(null);
      setRemoteRecordCount(null);
      setDataLoadState("loading");
      setDataLoadError("");
      setStatus(dict.board.status.loadingRealUsers);
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
          throw new Error(dict.board.status.invalidBackendShape);
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
        setStatus(dict.board.status.backendRows(formatNumber(records ?? summary.users.length)));
      })
      .catch((error) => {
        // 后台刷新失败时继续展示缓存数据，不打断用户
        if (!active || statsCache.has(cacheKey)) {
          return;
        }

        setRemoteSummary(null);
        setRemoteRecordCount(null);
        setDataLoadState("error");
        const message = error instanceof Error ? error.message : dict.board.status.readFailed;
        setDataLoadError(message);
        setStatus(dict.board.status.realUsersFailed(message));
      });

    return () => {
      active = false;
    };
  }, [appliedCustomRange, dict, isCustomRange, metric, normalizedApiBaseUrl, range, reloadKey, statsRangeKey]);

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
    if (!normalizedApiBaseUrl || !viewer?.authenticated || isCustomRange) {
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
          throw new Error(dict.board.status.invalidBackendShape);
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
        setAccountError(error instanceof Error ? error.message : dict.board.status.readFailed);
      });

    return () => {
      active = false;
    };
  }, [dict.board.status.invalidBackendShape, dict.board.status.readFailed, isCustomRange, normalizedApiBaseUrl, range, viewer?.authenticated, viewer?.user?.userId]);

  const emptySummary = useMemo(
    () => buildTokenLeaderboard([], { range, metric, now }),
    [metric, now, range]
  );
  const summary = remoteSummary ?? emptySummary;
  const recordCount = remoteRecordCount ?? 0;
  const isDataLoading = dataLoadState === "loading" && !remoteSummary;
  const isDataError = dataLoadState === "error" && !remoteSummary;
  const metricItems = METRIC_KEYS.map((item) => ({ key: item, label: dict.common.metrics[item] }));
  const sourceLabel = isDataLoading ? dict.board.hero.sourceLoading : isDataError ? dict.board.hero.sourceError : dict.board.hero.sourceServer;
  const statusMessage = isDataLoading
    ? isLoadSlow
      ? dict.board.status.slow
      : status
    : remoteSummary
      ? dict.board.status.backendRows(formatNumber(recordCount))
      : status;

  const topUsers = summary.users.slice(0, 8);
  const leader = summary.users[0];
  const chartRange = isCustomRange ? chartRangeForDailyLength(summary.daily.length) : range;
  const activeRangeLabel = isCustomRange && appliedCustomRange
    ? `${appliedCustomRange.from} - ${appliedCustomRange.to}`
    : dict.common.ranges[range];
  const showDailyLeaderboardTrend = summary.daily.length > 1;
  const leaderboardColumnCount = showDailyLeaderboardTrend ? 8 : 7;
  const trendPointsForPeak = summary.trends?.model.daily?.length ? summary.trends.model.daily : summary.daily;
  const trendPeakValue = Math.max(0, ...trendPointsForPeak.map((point) => getTeamTrendMetricValue(point, metric)));
  const selectedMetricLabel = dict.common.metrics[metric];
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
    ? dict.board.status.insightLoading
    : buildLeaderboardInsight(summary, cacheHitRate, dict.board.insight, dict.common.punctuation);

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

    const confirmed = window.confirm(dict.board.status.logoutConfirm);
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
    setStatus(dict.board.status.reloadRealUsers);
    showToast(dict.board.status.refreshingBoard);
    setReloadKey((value) => value + 1);
  }

  function selectPresetRange(nextRange: TokenBoardRange) {
    setAppliedCustomRange(null);
    setRange(nextRange);
  }

  function applyCustomRange() {
    if (!customFrom || !customTo || customTo < customFrom) {
      showToast(dict.board.status.invalidCustomRange, "error");
      return;
    }

    setAppliedCustomRange({ from: customFrom, to: customTo });
  }

  function openUsageExport(scope: "leaderboard" | "me", format: "csv" | "json") {
    if (!normalizedApiBaseUrl) {
      showToast(dict.board.status.exportApiMissing, "error");
      return;
    }

    if (isCustomRange) {
      showToast(dict.board.status.exportCustomRangeUnsupported, "error");
      return;
    }

    const params = new URLSearchParams({ format, range, scope });
    if (scope === "leaderboard") {
      params.set("metric", metric);
    }

    window.open(`${normalizedApiBaseUrl}/api/usage/export?${params.toString()}`, "_blank", "noopener,noreferrer");
    showToast(dict.board.status.exporting(scope));
  }

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      const message = dict.board.status.copied(label);
      setStatus(message);
      showToast(message);
    } catch {
      const message = dict.board.status.copyFailed(label);
      setStatus(message);
      showToast(message, "error");
    }
  }

  const leaderboardPanel = (
    <section id="token-leaderboard-rankings" className="otb-panel min-w-0 overflow-hidden rounded-lg">
      <PanelHeader
        title={dict.board.leaderboard.title}
        meta={isDataLoading ? <Skeleton className="h-3 w-40 align-middle" /> : dict.board.leaderboard.meta(formatNumber(summary.users.length), rangeRecordCountLabel)}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span>{dict.board.leaderboard.sortedBy(selectedMetricLabel)}</span>
            <button
              type="button"
              onClick={() => openUsageExport("leaderboard", "csv")}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-stone-950/10 bg-white px-2 text-xs font-semibold text-stone-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <Icon name="download" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => openUsageExport("leaderboard", "json")}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-stone-950/10 bg-white px-2 text-xs font-semibold text-stone-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <Icon name="file" />
              JSON
            </button>
          </div>
        }
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
              range={chartRange}
              showDailyTrend={showDailyLeaderboardTrend}
              user={user}
            />
          ))
        ) : (
          <LeaderboardEmptyState />
        )}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className={`w-full border-collapse text-left text-sm ${showDailyLeaderboardTrend ? "min-w-[1040px]" : "min-w-[800px]"}`}>
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{dict.board.leaderboard.columns.rank}</th>
              <th className="px-4 py-3">{dict.board.leaderboard.columns.user}</th>
              {showDailyLeaderboardTrend ? <th className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">{dict.board.leaderboard.columns.trend}</th> : null}
              <SortableColumnHeader active={metric === "tokens"} align="right">{dict.board.leaderboard.columns.totalTokens}</SortableColumnHeader>
              <SortableColumnHeader active={metric === "cost"} align="right">{dict.board.leaderboard.columns.cost}</SortableColumnHeader>
              <SortableColumnHeader active={metric === "sessions"} align="right">{dict.board.leaderboard.columns.sessions}</SortableColumnHeader>
              <SortableColumnHeader active={metric === "users"} align="right">{dict.board.leaderboard.columns.activeDays}</SortableColumnHeader>
              <th className="px-4 py-3">{dict.board.leaderboard.columns.model}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-950/8">
            {isDataLoading ? (
              <LeaderboardLoadingRow columnCount={leaderboardColumnCount} slow={isLoadSlow} />
            ) : isDataError ? (
              <LeaderboardErrorRow columnCount={leaderboardColumnCount} error={dataLoadError} onRetry={retryDataLoad} />
            ) : summary.users.length ? (
              summary.users.map((user) => (
                <LeaderboardRow key={user.userId} range={chartRange} showDailyTrend={showDailyLeaderboardTrend} user={user} />
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
    <section className="otb-panel-muted rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{dict.board.leaderboard.shareTitle(selectedMetricLabel)}</h2>
        <span className="font-mono text-xs text-stone-500">
          {isDataLoading ? <Skeleton className="h-3 w-10 align-middle" /> : dict.board.leaderboard.topUsers(formatNumber(topUsers.length))}
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
    <section className="otb-panel rounded-lg p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{dict.board.dataEntry.title}</h2>
          <p className="mt-1 text-xs text-stone-500">{dict.board.dataEntry.description}</p>
        </div>
        <span className="rounded-full bg-stone-950 px-2.5 py-1 font-mono text-xs text-white">
          {isDataLoading ? <Skeleton className="h-3 w-10 align-middle" /> : rangeRecordCountLabel}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {normalizedApiBaseUrl ? (
          <div className="rounded-lg border border-blue-600/25 bg-blue-50 p-3 text-xs text-blue-900">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{dict.board.dataEntry.autoReport}</p>
              <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[11px]">{dict.board.dataEntry.live}</span>
            </div>
            <p className="mt-2 text-blue-600">
              {viewer?.authenticated
                ? dict.board.dataEntry.currentAccount(viewer.user?.githubLogin || viewer.user?.displayName || "")
                : dict.board.dataEntry.loginAndAgent}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-600/25 bg-red-50 p-3 text-xs text-red-900">
            <p className="font-semibold">{dict.board.dataEntry.waitingBackend}</p>
            <p className="mt-2">{dict.board.dataEntry.backendOnly}</p>
          </div>
        )}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={openInstallGuide}
            className="otb-energy-bg inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <Icon name="guide" />
            {dict.board.hero.installGuide}
          </button>
          <button
            type="button"
            onClick={() => void copyCommand(NPX_STATUS_COMMAND, dict.board.dataEntry.statusCommand)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-blue-600/40 hover:bg-blue-50"
          >
            <Icon name="refresh" />
            {dict.board.dataEntry.copyStatusCommand}
          </button>
          {!viewer?.authenticated && normalizedApiBaseUrl ? (
            <button
              type="button"
              onClick={loginWithGitHub}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-blue-600/40 hover:bg-blue-50"
            >
              <Icon name="github" />
              {dict.common.actions.githubLogin}
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
        <header className="otb-panel overflow-hidden rounded-lg px-5 py-5 sm:px-6 lg:px-7">
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
                    {activeRangeLabel}
                  </span>
                </div>
                <h1 className="mt-3 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                  {dict.board.hero.title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {`${formatShortDate(summary.startAt)} - ${formatShortDate(summary.endAt)} · Asia/Shanghai`}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 xl:w-auto xl:items-end">
                <GitHubAuthControl viewer={viewer} onLogout={logoutGitHub} />
                <div className="grid w-full gap-2 xl:w-[42rem]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500">{dict.board.hero.rollingWindow}</p>
                      <SegmentedControl
                        items={ROLLING_RANGES.map((item) => ({ key: item, label: item }))}
                        value={isCustomRange ? "" : range}
                        onChange={(value) => selectPresetRange(value as TokenBoardRange)}
                        label={dict.board.hero.rollingWindow}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500">{dict.board.hero.calendar}</p>
                      <SegmentedControl
                        items={CALENDAR_RANGES.map((item) => ({ key: item, label: dict.common.ranges[item] }))}
                        value={isCustomRange ? "" : range}
                        onChange={(value) => selectPresetRange(value as TokenBoardRange)}
                        label={dict.board.hero.calendarRange}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-lg border border-blue-600/15 bg-[var(--otb-energy-gradient-subtle)] p-2 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(event) => setCustomFrom(event.target.value)}
                      className="min-h-11 rounded-lg border border-blue-600/20 bg-white px-3 font-mono text-sm text-slate-700 shadow-sm transition hover:border-blue-600/35"
                      aria-label={dict.board.hero.customStart}
                    />
                    <input
                      type="date"
                      value={customTo}
                      onChange={(event) => setCustomTo(event.target.value)}
                      className="min-h-11 rounded-lg border border-blue-600/20 bg-white px-3 font-mono text-sm text-slate-700 shadow-sm transition hover:border-blue-600/35"
                      aria-label={dict.board.hero.customEnd}
                    />
                    <button
                      type="button"
                      onClick={applyCustomRange}
                      className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      {dict.board.hero.custom}
                    </button>
                  </div>
                </div>
                <div className="w-full xl:w-80">
                  <SegmentedControl
                    items={metricItems}
                    value={metric}
                    onChange={(value) => setMetric(value as TokenBoardMetric)}
                    label={dict.board.hero.metric}
                  />
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2 xl:max-w-[32rem]">
                  <button
                    type="button"
                    onClick={openInstallGuide}
                    className="otb-energy-bg inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <Icon name="guide" />
                    {dict.board.hero.installGuide}
                  </button>
                  {!viewer?.authenticated && normalizedApiBaseUrl ? (
                    <button
                      type="button"
                      onClick={loginWithGitHub}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm"
                    >
                      <Icon name="github" />
                      {dict.common.actions.githubLogin}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryDataLoad}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm"
                    >
                      <Icon name="refresh" />
                      {dict.board.hero.refreshBoard}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
              <HeroSignal
                label={dict.board.hero.currentLeader}
                value={isDataLoading ? <Skeleton className="h-5 w-28" /> : leader?.displayName ?? "--"}
                meta={isDataLoading ? <Skeleton className="h-3 w-16" /> : leaderMeta}
              />
              <HeroSignal
                label={dict.board.hero.currentRecords}
                value={isDataLoading ? <Skeleton className="h-5 w-20" /> : rangeRecordCountLabel}
                meta={isDataLoading ? <Skeleton className="h-3 w-24" /> : activeRangeLabel}
              />
              <HeroSignal
                label={dict.board.hero.topCombo}
                value={isDataLoading ? <Skeleton className="h-5 w-24" /> : topModelLabel}
                meta={isDataLoading ? <Skeleton className="h-3 w-16" /> : topToolLabel}
              />
            </div>
            <TrustEvidenceBar
              apiBaseUrl={normalizedApiBaseUrl}
              error={isDataError ? dataLoadError : ""}
              loading={isDataLoading}
              range={chartRange}
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
                active={metric === "tokens"}
                label={dict.board.stats.totalTokens}
                value={isDataLoading ? <Skeleton className="h-8 w-28" /> : formatTokens(totalConsumptionTokens)}
                meta={isDataLoading ? "" : dict.board.stats.totalTokensMeta}
                onClick={() => setMetric("tokens")}
                tone="ink"
              />
              <StatTile
                active={metric === "cost"}
                label={dict.board.stats.estimatedCost}
                value={isDataLoading ? <Skeleton className="h-8 w-24" /> : formatUsd(summary.totalCostUsd)}
                meta={isDataLoading ? "" : dict.board.stats.estimatedCostMeta}
                onClick={() => setMetric("cost")}
                tone="gold"
              />
              <StatTile
                active={metric === "sessions"}
                label={dict.board.stats.sessions}
                value={isDataLoading ? <Skeleton className="h-8 w-20" /> : formatNumber(summary.totalSessions)}
                meta={isDataLoading ? "" : "Sessions"}
                onClick={() => setMetric("sessions")}
                tone="blue"
              />
              <StatTile
                active={metric === "users"}
                label={dict.board.stats.activeUsers}
                value={isDataLoading ? <Skeleton className="h-8 w-20" /> : formatNumber(summary.activeUsers)}
                meta={isDataLoading ? "" : dict.board.stats.activeUsersMeta(formatNumber(summary.activeUsers))}
                onClick={() => setMetric("users")}
                tone="mint"
              />
            </div>

            <EfficiencyStrip
              cacheHitRate={cacheHitRate}
              costPerSession={costPerSession}
              dailyAverageTokens={dailyAverageTokens}
              loading={isDataLoading}
              tokensPerSession={tokensPerSession}
            />

            <div className="grid gap-5">
              <TeamBattlePanel loading={isDataLoading} summary={summary} />
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
                <ProjectConsumptionPanel loading={isDataLoading} summary={summary} />
                <UsageDistributionPanel loading={isDataLoading} summary={summary} viewer={viewer} />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]">
              <section className="otb-panel rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">{dict.board.stats.trendTitle(selectedMetricLabel)}</h2>
                  <p className="font-mono text-xs text-stone-500">
                    {dict.board.stats.peak(isDataLoading ? "" : formatMetricValue(trendPeakValue, metric))}
                  </p>
                </div>
                <div className="mt-4">
                  <DailyTokenTrendChart
                    daily={summary.daily}
                    loading={isDataLoading}
                    metric={metric}
                    trend={summary.trends?.model}
                  />
                </div>
              </section>

              <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                {sharePanel}
                <BreakdownPanel title={dict.board.stats.modelUsage} loading={isDataLoading} items={summary.models.map((item) => ({
                  name: item.name,
                  value: item.tokens,
                  meta: formatUsd(item.costUsd),
                  share: item.share,
                }))} />
                <BreakdownPanel title={dict.board.stats.toolDistribution} loading={isDataLoading} items={summary.tools.map((item) => ({
                  name: item.name,
                  value: item.tokens,
                  meta: dict.board.stats.toolSessions(formatNumber(item.sessions)),
                  share: item.share,
                }))} />
              </section>
            </div>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            {dataEntryPanel}

            <section className="otb-panel rounded-lg p-4">
              <h2 className="text-base font-semibold">{dict.board.scope.title}</h2>
              <div className="mt-3 space-y-2 text-xs leading-5 text-stone-600">
                <p>
                  <strong className="text-stone-900">{dict.board.scope.timeWindow}</strong>{dict.common.punctuation.colon}{dict.board.scope.timeWindowDescription(activeRangeLabel)}
                </p>
                <p>
                  <strong className="text-stone-900">{dict.board.scope.recordCount}</strong>{dict.common.punctuation.colon}{isDataLoading ? <Skeleton className="h-3 w-48 align-middle" /> : dict.board.scope.recordCountDescription(recordCountLabel, rangeRecordCountLabel)}
                </p>
                <p>
                  <strong className="text-stone-900">{dict.board.scope.dataAsOf}</strong>{dict.common.punctuation.colon}{latestReportedAt(summary) ? dict.board.scope.dataAsOfDescription(formatShortDate(latestReportedAt(summary))) : dict.board.scope.dataAsOfEmpty}
                </p>
                <p>
                  <strong className="text-stone-900">{dict.board.scope.costTitle}</strong>{dict.common.punctuation.colon}{dict.board.scope.costDescription}
                </p>
                <p>
                  <strong className="text-stone-900">{dict.board.scope.tokenTitle}</strong>{dict.common.punctuation.colon}{dict.board.scope.tokenDescription}
                </p>
                <p>
                  <strong className="text-stone-900">{dict.board.scope.privacyTitle}</strong>{dict.common.punctuation.colon}{dict.board.scope.privacyDescription}
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
          onExport={(format) => openUsageExport("me", format)}
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
