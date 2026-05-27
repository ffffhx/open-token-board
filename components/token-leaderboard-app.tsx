"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import {
  buildTokenLeaderboard,
  getInputContextTokens,
  getTokenConsumptionTokens,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenAccountUsageProfile,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
} from "@/lib/token-leaderboard";

const RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D"];
const ROLLING_RANGE_LABELS: Record<TokenBoardRange, string> = {
  "1D": "滚动 24 小时",
  "7D": "滚动 7x24 小时",
  "30D": "滚动 30x24 小时",
  "90D": "滚动 90x24 小时",
};

const METRICS: Array<{ key: TokenBoardMetric; label: string }> = [
  { key: "tokens", label: "总消耗" },
  { key: "cost", label: "费用" },
  { key: "sessions", label: "会话" },
];
const DATA_LOAD_SLOW_MS = 10_000;
const TOAST_DISMISS_MS = 1_800;

const TOKEN_BOARD_AGENT_VERSION = "0.4.11";
const NPX_PACKAGE_URL = `https://ffffhx.github.io/garden-lab/token-board-agent.tgz?v=${TOKEN_BOARD_AGENT_VERSION}`;
const NPX_INSTALL_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent install`;
const NPX_STATUS_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent status`;
const NPX_UNINSTALL_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent uninstall`;
export const INSTALL_GUIDES: Record<InstallGuidePlatform, InstallGuideConfig> = {
  macos: {
    description: "适合在 macOS 上使用 Codex、Claude Code、Cursor 或 Trae 的朋友。",
    label: "macOS",
    uninstall: {
      command: NPX_UNINSTALL_COMMAND,
      commandLabel: "macOS 卸载命令",
      description: "以后不想继续同步时，在同一个 macOS 用户的终端里运行卸载命令。",
      note: "卸载会移除 LaunchAgent 和本机安装脚本，保留授权配置与上传状态；重新安装后可继续使用。",
    },
    steps: [
      {
        title: "安装本机 agent",
        eyebrow: "Step 1",
        description: "在你平时使用 AI 编码工具的 Mac 终端里运行安装命令，首次执行会引导 GitHub 授权。",
        command: NPX_INSTALL_COMMAND,
        commandLabel: "macOS 安装命令",
        note: "安装成功后会注册 macOS LaunchAgent，终端关闭也会每 5 分钟同步一次。",
      },
      {
        title: "检查运行状态",
        eyebrow: "Step 2",
        description: "安装完成后运行 status，确认配置文件、LaunchAgent 和最近一次同步结果是否正常。",
        command: NPX_STATUS_COMMAND,
        commandLabel: "macOS 状态检查命令",
        note: "如果没有看到最近同步结果，等 1-2 分钟后再检查，或确认当前系统用户就是使用 Codex 的用户。",
      },
      {
        title: "回到榜单刷新",
        eyebrow: "Step 3",
        description: "后台任务开始同步后，回到页面刷新榜单或切换时间范围，就能看到自己的 token 记录。",
        note: "页面只展示 token、模型、工具、项目 basename 与会话短标题，不展示完整 prompt 文本。",
      },
    ],
  },
  windows: {
    description: "适合在 Windows PowerShell 里使用 Cursor、Trae 或 Codex CLI 的朋友。",
    label: "Windows",
    uninstall: {
      command: NPX_UNINSTALL_COMMAND,
      commandLabel: "Windows PowerShell 卸载命令",
      description: "以后不想继续同步时，在 PowerShell 里运行卸载命令。",
      note: "卸载会删除 TokenBoardAgent 任务、本机隐藏启动器和安装脚本，保留授权配置与上传状态；重新安装后可继续使用。",
    },
    steps: [
      {
        title: "安装 Windows 后台任务",
        eyebrow: "Step 1",
        description: "在 PowerShell 里运行安装命令，首次执行会引导 GitHub 授权，并注册 Windows 任务计划程序。",
        command: NPX_INSTALL_COMMAND,
        commandLabel: "Windows PowerShell 安装命令",
        note: "安装成功后会创建名为 TokenBoardAgent 的隐藏 Task Scheduler 任务，每 5 分钟同步一次；关闭 PowerShell 也不影响后台上传。",
      },
      {
        title: "检查任务状态",
        eyebrow: "Step 2",
        description: "安装完成后运行 status，确认配置文件、Task Scheduler 任务和最近一次同步结果是否正常。",
        command: NPX_STATUS_COMMAND,
        commandLabel: "Windows PowerShell 状态检查命令",
        note: "如果公司策略禁用了任务计划程序，可以临时运行 token-board-agent watch 作为前台同步模式。",
      },
      {
        title: "回到榜单刷新",
        eyebrow: "Step 3",
        description: "任务开始同步后，回到页面刷新榜单或切换时间范围，就能看到自己的 token 记录。",
        note: "Windows 模式会读取 %APPDATA% 下的 Cursor / Trae 数据，也会读取用户目录下的 Codex / Claude Code 记录。",
      },
    ],
  },
};

export function TokenLeaderboardApp({
  initialNow,
  apiBaseUrl,
}: {
  initialNow: string;
  apiBaseUrl?: string;
}) {
  const [range, setRange] = useState<TokenBoardRange>("7D");
  const [metric, setMetric] = useState<TokenBoardMetric>("tokens");
  const [status, setStatus] = useState("正在加载真实用户数据");
  const [dataLoadState, setDataLoadState] = useState<DataLoadState>("loading");
  const [dataLoadError, setDataLoadError] = useState("");
  const [isLoadSlow, setIsLoadSlow] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [remoteSummary, setRemoteSummary] = useState<TokenLeaderboardSummary | null>(null);
  const [remoteRecordCount, setRemoteRecordCount] = useState<number | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [accountProfile, setAccountProfile] = useState<TokenAccountUsageProfile | null>(null);
  const [accountLoadState, setAccountLoadState] = useState<AccountLoadState>("idle");
  const [accountError, setAccountError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [installGuidePlatform, setInstallGuidePlatform] = useState<InstallGuidePlatform>("macos");
  const [installGuideStep, setInstallGuideStep] = useState(0);
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

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

    setRemoteSummary(null);
    setRemoteRecordCount(null);
    setDataLoadState("loading");
    setDataLoadError("");
    setStatus("正在加载真实用户数据");
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
        if (!active) {
          return;
        }

        const summary = "summary" in payload && payload.summary ? payload.summary : payload;
        if (!isTokenLeaderboardSummary(summary)) {
          throw new Error("后端返回格式不正确");
        }

        setRemoteSummary(normalizeRemoteSummary(summary, metric));
        setRemoteRecordCount(typeof payload.records === "number" ? payload.records : null);
        setDataLoadState("ready");
        setDataLoadError("");
        setStatus(`后端数据 ${typeof payload.records === "number" ? payload.records : summary.users.length} 条`);
      })
      .catch((error) => {
        if (!active) {
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

    setAccountLoadState("loading");
    setAccountError("");
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
        if (!active) {
          return;
        }

        if (!isTokenAccountUsageProfile(payload.profile)) {
          throw new Error("后端返回格式不正确");
        }

        setAccountProfile(normalizeRemoteAccountProfile(payload.profile));
        setAccountLoadState("ready");
      })
      .catch((error) => {
        if (!active) {
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
    <section id="token-leaderboard-rankings" className="min-w-0 overflow-hidden rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] shadow-[0_20px_70px_-60px_rgba(28,25,23,0.65)]">
      <PanelHeader
        title="排行榜"
        meta={isDataLoading ? <LoadingInline label="loading" /> : `${summary.users.length} 位用户 · 当前区间 ${rangeRecordCountLabel} 条`}
        action={isDataLoading ? <LoadingInline label="Loading" /> : `按${selectedMetricLabel}降序`}
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
          <thead className="bg-[#f3ede0] text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            <tr>
              <th className="px-4 py-3">排名</th>
              <th className="px-4 py-3">用户</th>
              {showDailyLeaderboardTrend ? <th className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">每日用量</th> : null}
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
                <LeaderboardRow key={user.userId} showDailyTrend={showDailyLeaderboardTrend} user={user} />
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
    <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#f5efe4] p-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.6)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{selectedMetricLabel}份额</h2>
        <span className="font-mono text-xs text-stone-500">
          {isDataLoading ? <LoadingInline label="Loading" /> : `${topUsers.length} 人`}
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
    <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] p-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.6)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">加入榜单</h2>
          <p className="mt-1 text-xs text-stone-500">安装 agent 后从本机采集 token 记录并自动上报。</p>
        </div>
        <span className="rounded-full bg-stone-950 px-2.5 py-1 font-mono text-xs text-white">
          {isDataLoading ? <LoadingInline label="同步中" tone="light" /> : rangeRecordCountLabel}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {normalizedApiBaseUrl ? (
          <div className="rounded-xl border border-[#26745e]/25 bg-[#eaf5ef] p-3 text-xs text-[#163d33]">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">自动上报</p>
              <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[11px]">live</span>
            </div>
            <p className="mt-2 text-[#26745e]">
              {viewer?.authenticated
                ? `当前账号 @${viewer.user?.githubLogin || viewer.user?.displayName}`
                : "GitHub 登录 + npx agent，从你的电脑上报"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#c05c38]/25 bg-[#fff0e9] p-3 text-xs text-[#7b2f1d]">
            <p className="font-semibold">等待 Token Board 后端</p>
            <p className="mt-2">页面已关闭静态 JSON、本地缓存和手动导入，只会读取自动上报服务。</p>
          </div>
        )}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={openInstallGuide}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#11130f] px-3 text-sm font-semibold text-white transition hover:bg-[#26745e]"
          >
            <Icon name="guide" />
            使用安装指南
          </button>
          <button
            type="button"
            onClick={() => void copyCommand(NPX_STATUS_COMMAND, "状态检查命令")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-[#26745e]/40 hover:bg-[#eef7f2]"
          >
            <Icon name="refresh" />
            复制状态检查命令
          </button>
          {!viewer?.authenticated && normalizedApiBaseUrl ? (
            <button
              type="button"
              onClick={loginWithGitHub}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-950/15 bg-white px-3 text-sm font-semibold text-stone-700 transition hover:border-[#26745e]/40 hover:bg-[#eef7f2]"
            >
              <Icon name="github" />
              GitHub 登录
            </button>
          ) : null}
        </div>
        <p className="min-h-5 rounded-lg bg-[#f5efe4] px-3 py-2 text-xs text-stone-600" aria-live="polite">
          {isDataLoading ? <LoadingInline label={statusMessage} /> : statusMessage}
        </p>
      </div>
    </section>
  );

  return (
    <main className="min-w-0 font-sans text-stone-950">
      <div className="space-y-5">
        <header className="relative overflow-hidden rounded-[1.25rem] border border-stone-950/15 bg-[#11130f] px-5 py-4 text-[#f8f1e5] shadow-[0_28px_90px_-62px_rgba(17,19,15,0.85)] sm:px-6 lg:px-7">
          <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(135deg,rgba(241,196,92,0.16)_0_1px,transparent_1px_24px),linear-gradient(90deg,rgba(255,255,255,0.07),transparent_42%)]" />
          <div className="relative space-y-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#f1c45c]/35 bg-[#f1c45c]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#f1c45c]">
                    Open Token Board
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-semibold text-white/78">
                    {isDataLoading ? <LoadingInline label={sourceLabel} tone="light" /> : sourceLabel}
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 font-mono text-xs text-white/70">
                    {ROLLING_RANGE_LABELS[range]}
                  </span>
                </div>
                <h1 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  朋友间的 Token 排行榜
                </h1>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  {isDataLoading
                    ? <LoadingInline label="正在加载真实用户数据" tone="light" />
                    : `${formatShortDate(summary.startAt)} - ${formatShortDate(summary.endAt)} · Asia/Shanghai`}
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
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f8f1e5] px-4 text-sm font-semibold text-[#11130f] transition hover:bg-[#ffe2a8]"
                  >
                    <Icon name="guide" />
                    使用安装指南
                  </button>
                  {!viewer?.authenticated && normalizedApiBaseUrl ? (
                    <button
                      type="button"
                      onClick={loginWithGitHub}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      <Icon name="github" />
                      GitHub 登录
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryDataLoad}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      <Icon name="refresh" />
                      刷新榜单
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-4 sm:gap-3">
              <HeroSignal
                label="当前榜首"
                value={isDataLoading ? <LoadingInline label="Loading" tone="light" spinnerClassName="size-5" /> : leader?.displayName ?? "--"}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" tone="light" /> : leaderMeta}
              />
              <HeroSignal
                label="当前区间记录"
                value={isDataLoading ? <LoadingInline label="Loading" tone="light" spinnerClassName="size-5" /> : rangeRecordCountLabel}
                meta={isDataLoading ? <LoadingInline label="Loading" tone="light" /> : `${ROLLING_RANGE_LABELS[range]}`}
              />
              <HeroSignal
                label="高频组合"
                value={isDataLoading ? <LoadingInline label="Loading" tone="light" spinnerClassName="size-5" /> : topModelLabel}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" tone="light" /> : topToolLabel}
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
                value={isDataLoading ? <LoadingInline label="Loading" tone="light" spinnerClassName="size-6" /> : formatTokens(totalConsumptionTokens)}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" tone="light" /> : "输入上下文 + 输出 Token"}
                tone="ink"
              />
              <StatTile
                label="活跃用户"
                value={isDataLoading ? <LoadingInline label="Loading" spinnerClassName="size-6" /> : formatNumber(summary.activeUsers)}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" /> : `${summary.activeUsers} 位参与`}
                tone="mint"
              />
              <StatTile
                label="会话"
                value={isDataLoading ? <LoadingInline label="Loading" spinnerClassName="size-6" /> : formatNumber(summary.totalSessions)}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" /> : "Sessions"}
                tone="blue"
              />
              <StatTile
                label="估算费用"
                value={isDataLoading ? <LoadingInline label="Loading" spinnerClassName="size-6" /> : formatUsd(summary.totalCostUsd)}
                meta={isDataLoading ? <LoadingInline label="真实数据加载中" /> : "非实际账单"}
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
              <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] p-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.6)]">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Token 趋势</h2>
                  <p className="font-mono text-xs text-stone-500">
                    峰值 {isDataLoading ? <LoadingInline label="Loading" /> : formatTokens(maxDailyTokens)}
                  </p>
                </div>
                <div
                  className="mt-4 grid h-64 grid-cols-[repeat(auto-fit,minmax(8px,1fr))] items-end gap-1 rounded-xl border border-stone-950/8 bg-[linear-gradient(180deg,rgba(17,19,15,0.04),transparent)] px-3 pb-3 pt-5"
                  aria-label="Token 趋势"
                >
                  <DailyTokenTrendChart
                    daily={summary.daily}
                    loading={isDataLoading}
                    maxDailyTokens={maxDailyTokens}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono text-xs text-stone-500">
                  <span>{isDataLoading ? <LoadingSpinner className="size-3" /> : summary.daily[0]?.date.slice(5) ?? "--"}</span>
                  <span>{isDataLoading ? <LoadingSpinner className="size-3" /> : summary.daily.at(-1)?.date.slice(5) ?? "--"}</span>
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

            <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] p-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.6)]">
              <h2 className="text-base font-semibold">统计口径</h2>
              <div className="mt-3 space-y-2 text-xs leading-5 text-stone-600">
                <p>
                  <strong className="text-stone-900">时间窗口</strong>：{ROLLING_RANGE_LABELS[range]}，展示时间按 Asia/Shanghai。
                </p>
                <p>
                  <strong className="text-stone-900">记录数</strong>：全库/可用记录 {isDataLoading ? <LoadingInline label="加载中" /> : recordCountLabel} 条；当前区间参与排行 {isDataLoading ? <LoadingInline label="加载中" /> : rangeRecordCountLabel} 条。
                </p>
                <p>
                  <strong className="text-stone-900">更新时间</strong>：{isDataLoading ? <LoadingInline label="加载中" /> : formatShortDate(summary.endAt)}。
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

function AccountUsagePanel({
  apiEnabled,
  error,
  loadState,
  onLogin,
  profile,
  range,
  viewer,
}: {
  apiEnabled: boolean;
  error: string;
  loadState: AccountLoadState;
  onLogin: () => void;
  profile: TokenAccountUsageProfile | null;
  range: TokenBoardRange;
  viewer: ViewerState | null;
}) {
  const user = profile?.user ?? null;
  const inputContextTokens = user ? getInputContextTokens(user) : 0;
  const accountConsumptionTokens = user ? getTokenConsumptionTokens(user) : 0;
  const generatedTokens = user ? user.outputTokens + user.reasoningOutputTokens : 0;
  const cacheHitRate = inputContextTokens > 0 && user ? user.cachedInputTokens / inputContextTokens : 0;
  const accountTokensPerSession = user?.sessions ? accountConsumptionTokens / user.sessions : 0;
  const dashboardProfile = profile && user ? profile : null;

  if (apiEnabled && viewer && !viewer.authenticated) {
    return (
      <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] px-5 py-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.55)] sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-center">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#26745e]">GitHub Account</p>
            <h2 className="mt-1 text-lg font-semibold text-stone-950">登录后展开我的 Token 消耗</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
              个人视图会按当前 GitHub 账号展示排名、项目、缓存命中率和活跃分布；公共排行榜不需要登录也能查看。
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#11130f] px-4 text-sm font-semibold text-white transition hover:bg-[#26745e]"
          >
            <Icon name="github" />
            GitHub 登录
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[1.25rem] border border-[#22342b] bg-[#080b09] text-[#f7f4ec] shadow-[0_28px_90px_-68px_rgba(8,11,9,0.95)]">
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[#7be3a0]">GitHub Account</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">我的 Token 消耗</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 font-mono text-xs text-white/72">
              {range}
            </span>
            {viewer?.authenticated ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#7be3a0]/25 bg-[#123127] px-3 py-1 text-sm font-semibold text-[#bdf5cc]">
                {viewer.user?.avatarUrl ? (
                  <img
                    alt=""
                    className="size-5 rounded-full"
                    src={viewer.user.avatarUrl}
                  />
                ) : null}
                @{viewer.user?.githubLogin || viewer.user?.displayName || "GitHub"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {!apiEnabled ? (
        <AccountEmptyState
          title="等待连接 Token Board 服务"
          description="配置 NEXT_PUBLIC_TOKEN_BOARD_API_URL 后，这里会按当前 GitHub 登录账号展示个人消耗。"
        />
      ) : !viewer ? (
        <AccountLoadingState />
      ) : !viewer.authenticated ? (
        <div className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center">
          <div>
            <p className="text-lg font-semibold">登录后查看自己的 GitHub 消耗</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
              这里会只展示当前 GitHub 账号通过 agent 上报的 Token、费用、模型、项目和活跃分布。
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f7f4ec] px-4 text-sm font-semibold text-[#080b09] transition hover:bg-[#ffe2a8]"
          >
            <Icon name="github" />
            GitHub 登录
          </button>
        </div>
      ) : loadState === "loading" ? (
        <AccountLoadingState />
      ) : loadState === "error" ? (
        <AccountEmptyState title="个人消耗加载失败" description={error || "请稍后刷新再试。"} />
      ) : !dashboardProfile || !user ? (
        <AccountEmptyState
          title="还没有这个 GitHub 账号的上报数据"
          description="在本机运行 token-board-agent login 并保持 agent 同步后，这里就会出现个人视图。"
        />
      ) : (
        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/6 p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
            <div className="flex items-center gap-4">
              {viewer.user?.avatarUrl ? (
                <img
                  alt=""
                  className="size-12 rounded-2xl border border-white/15"
                  src={viewer.user.avatarUrl}
                />
              ) : (
                <Avatar name={user.displayName} index={user.rank || 0} />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white/45">我的排名（按总消耗，{range}）</p>
                <p className="mt-1 truncate font-mono text-3xl font-semibold">
                  #{dashboardProfile.rank ?? "--"}
                  <span className="ml-2 text-base text-white/42">/ {formatNumber(dashboardProfile.totalUsers)}</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-right">
              <div>
                <p className="text-xs text-white/42">超过</p>
                <p className="mt-1 font-mono text-xl font-semibold text-[#bdf5cc]">
                  {dashboardProfile.percentile === null ? "--" : formatPercent(dashboardProfile.percentile)}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/42">排名变化</p>
                <p className={`mt-1 font-mono text-xl font-semibold ${rankDeltaTone(dashboardProfile.rankDelta)}`}>
                  {formatRankDelta(dashboardProfile.rankDelta)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <AccountStatCard
              label="预估费用"
              value={formatUsd(user.costUsd)}
              meta="USD estimate"
              tone="gold"
              tooltip={{
                title: "预估费用",
                description: "按公开模型单价估算的美元成本，不等同于 Codex 账号额度或实际账单。",
                formula: "Σ(input/1M × input 单价 + cached/1M × cached 单价 + output/1M × output 单价)",
                detail: `当前区间估算 ${formatUsd(user.costUsd)}`,
              }}
            />
            <AccountStatCard
              label="总消耗 Token"
              value={formatTokens(accountConsumptionTokens)}
              meta="输入上下文 + 输出 Token"
              tone="green"
              tooltip={{
                title: "总消耗 Token",
                description: "排行榜主口径，按输入上下文加输出计算；缓存命中输入是输入上下文里的子集。",
                formula: "Σ(input_tokens + output_tokens)",
                detail: `${formatNumber(dashboardProfile.records)} 条记录，共 ${formatTokens(accountConsumptionTokens)}`,
              }}
            />
            <AccountStatCard
              label="输入上下文"
              value={formatTokens(inputContextTokens)}
              meta={`缓存 ${formatTokens(user.cachedInputTokens)}`}
              tone="blue"
              tooltip={{
                title: "输入上下文",
                description: "模型阅读过的上下文吞吐量；其中缓存命中部分在副指标里单独标出。",
                formula: "Σ(input_tokens)",
                detail: `输入上下文 ${formatTokens(user.inputTokens)}，其中缓存 ${formatTokens(user.cachedInputTokens)}`,
              }}
            />
            <AccountStatCard
              label="输出 Token"
              value={formatTokens(user.outputTokens)}
              meta={`推理 ${formatTokens(user.reasoningOutputTokens)}`}
              tone="rose"
              tooltip={{
                title: "输出 Token",
                description: "模型写出来的可见内容 token；推理 token 单独列在副指标里。",
                formula: "主值 = Σ output_tokens；生成侧合计 = output + reasoning",
                detail: `输出 ${formatTokens(user.outputTokens)}，推理 ${formatTokens(user.reasoningOutputTokens)}，合计 ${formatTokens(generatedTokens)}`,
              }}
            />
            <AccountStatCard
              label="缓存命中率"
              value={formatPercent(cacheHitRate)}
              meta={user.topTool}
              tone="ink"
              tooltip={{
                title: "缓存命中率",
                description: "输入上下文里有多少来自缓存命中。命中越高，通常代表重复上下文更多、单位成本更低。",
                formula: "Σ cached_input_tokens ÷ (Σ input_tokens + Σ cached_input_tokens)",
                detail: `${formatTokens(user.cachedInputTokens)} ÷ ${formatTokens(inputContextTokens)} = ${formatPercent(cacheHitRate)}`,
              }}
            />
            <AccountStatCard
              label="活跃天数"
              value={`${formatNumber(user.activeDays)}d`}
              meta={dashboardProfile.topWeekday}
              tone="green"
              tooltip={{
                title: "活跃天数",
                description: "当前时间范围内出现 token 记录的自然日数量。",
                formula: "count(distinct date(timestamp))",
                detail: `当前区间 ${formatNumber(user.activeDays)} 天有记录`,
              }}
            />
            <AccountStatCard
              label="会话数"
              value={formatNumber(user.sessions)}
              meta={`${formatTokens(accountTokensPerSession)} token/session`}
              tone="blue"
              tooltip={{
                title: "会话数",
                description: "按匿名 sessionId 聚合的会话数量；没有 sessionId 时用事件 ID 兜底。",
                formula: "count(distinct session_id || event_id)",
                detail: `${formatTokens(accountConsumptionTokens)} / ${formatNumber(user.sessions)} 个会话`,
              }}
            />
            <AccountStatCard
              label="高峰时段"
              value={dashboardProfile.topHour}
              meta="Asia/Shanghai"
              tone="gold"
              tooltip={{
                title: "高峰时段",
                description: "按北京时间把记录归到 24 小时桶，取 token 累计最多的小时。",
                formula: "argmax(hour(timestamp), Σ(input + output))",
                detail: `当前高峰 ${dashboardProfile.topHour}`,
              }}
            />
            <AccountStatCard
              label="常用模型"
              value={user.topModel}
              meta={`${dashboardProfile.models.length} models`}
              tone="rose"
              tooltip={{
                title: "常用模型",
                description: "当前区间内 token 累计最多的模型。",
                formula: "argmax(model, Σ(input + output))",
                detail: `${dashboardProfile.models.length} 个模型参与统计`,
              }}
            />
          </div>

          <AccountConfigPanel config={dashboardProfile.config} />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
            <AccountDailyTrend daily={dashboardProfile.daily} />
            <AccountHeatmap heatmap={dashboardProfile.heatmap} />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <AccountBreakdownPanel
              title="模型消耗"
              meta={`${dashboardProfile.models.length} 个模型`}
              items={dashboardProfile.models.map((item) => ({
                name: item.name,
                value: item.tokens,
                meta: formatUsd(item.costUsd),
                share: item.share,
              }))}
              barColor="#6ea3ff"
            />
            <AccountBreakdownPanel
              title="工具分布"
              meta={`${dashboardProfile.tools.length} 个工具`}
              items={dashboardProfile.tools.map((item) => ({
                name: item.name,
                value: item.tokens,
                meta: `${formatNumber(item.sessions)} 会话`,
                share: item.share,
              }))}
              barColor="#f1c45c"
            />
            <AccountProjectList projects={dashboardProfile.projects} />
          </div>

          <AccountSessionList sessions={dashboardProfile.sessions} />
        </div>
      )}
    </section>
  );
}

function AccountConfigPanel({ config }: { config: TokenAccountUsageProfile["config"] }) {
  const codex = config?.codex;
  const configuredContextWindow = codex?.modelContextWindow;
  const modelContextWindow = codex?.modelCacheContextWindow;
  const contextWindow = configuredContextWindow || modelContextWindow || 0;
  const compactLimit = codex?.modelAutoCompactTokenLimit || 0;
  const compactRatio = contextWindow > 0 && compactLimit > 0 ? compactLimit / contextWindow : null;
  const maxContextWindow = codex?.modelMaxContextWindow || 0;
  const effectivePercent = codex?.effectiveContextWindowPercent;
  const items = [
    {
      label: "默认模型",
      value: codex?.model || "--",
      meta: codex?.modelReasoningEffort ? `reasoning ${codex.modelReasoningEffort}` : "config.toml",
    },
    {
      label: "上下文窗口",
      value: contextWindow > 0 ? formatTokens(contextWindow) : "--",
      meta:
        configuredContextWindow && modelContextWindow && configuredContextWindow !== modelContextWindow
          ? `配置 ${formatTokens(configuredContextWindow)} · 标称 ${formatTokens(modelContextWindow)}`
          : "model_context_window",
    },
    {
      label: "自动压缩阈值",
      value: compactLimit > 0 ? formatTokens(compactLimit) : "--",
      meta: compactRatio === null ? "model_auto_compact_token_limit" : `${formatPercent(compactRatio)} of window`,
    },
    {
      label: "模型窗口上限",
      value: maxContextWindow > 0 ? formatTokens(maxContextWindow) : "--",
      meta: effectivePercent === undefined ? "models_cache" : `effective ${formatPercent(effectivePercent / 100)}`,
    },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">当前用户配置</h3>
          <p className="mt-1 text-xs leading-5 text-white/42">
            只同步 Codex 配置白名单，不上传项目路径、hook、MCP 或通知命令。
          </p>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-black/16 px-3 py-1 font-mono text-xs text-white/52">
          {config ? `同步 ${formatShortDate(config.updatedAt)}` : "等待 agent 同步"}
        </span>
      </div>

      {config ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="min-h-24 rounded-xl border border-white/8 bg-black/16 p-3">
              <p className="text-xs font-semibold text-white/40">{item.label}</p>
              <p className="mt-2 truncate font-mono text-xl font-semibold text-[#bdf5cc]" title={item.value}>
                {item.value}
              </p>
              <p className="mt-2 truncate text-xs text-white/38" title={item.meta}>
                {item.meta}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/16 px-3 py-4 text-center text-sm text-white/45">
          旧版本 agent 还没有同步配置；重新运行安装命令或等下一次新版 agent 上报后会显示。
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/45">
        <span className="rounded-full border border-white/10 bg-black/16 px-2.5 py-1">
          agent {config?.agent?.version || "--"}
        </span>
        <span className="rounded-full border border-white/10 bg-black/16 px-2.5 py-1">
          {config?.agent?.platform || "platform --"}
        </span>
      </div>
    </section>
  );
}

function AccountEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-8 text-center sm:px-6">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-white/54">{description}</p>
    </div>
  );
}

function AccountLoadingState() {
  return (
    <div className="space-y-5 px-5 py-5 sm:px-6">
      <div className="flex min-h-24 items-center justify-center rounded-2xl border border-white/10 bg-white/6">
        <LoadingInline label="正在加载个人消耗" tone="light" spinnerClassName="size-7" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="flex h-28 items-center justify-center rounded-xl border border-white/10 bg-white/6">
            <LoadingSpinner className="size-5" tone="light" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountStatCard({
  label,
  value,
  meta,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "blue" | "gold" | "green" | "ink" | "rose";
  tooltip?: {
    title: string;
    description: string;
    formula: string;
    detail: string;
  };
}) {
  const tooltipId = useId();
  const tones = {
    blue: "border-[#6ea3ff]/24 bg-[#102034] text-[#d9e8ff]",
    gold: "border-[#f1c45c]/24 bg-[#2e2512] text-[#ffe2a8]",
    green: "border-[#7be3a0]/24 bg-[#10291f] text-[#bdf5cc]",
    ink: "border-white/12 bg-white/8 text-white",
    rose: "border-[#ff9b7c]/24 bg-[#321811] text-[#ffd4c6]",
  };

  return (
    <div
      className={`group/stat relative min-h-28 rounded-xl border p-4 outline-none transition duration-150 hover:-translate-y-0.5 hover:border-white/24 focus-visible:-translate-y-0.5 focus-visible:border-white/32 focus-visible:ring-2 focus-visible:ring-white/18 ${tones[tone]}`}
      tabIndex={tooltip ? 0 : undefined}
      aria-describedby={tooltip ? tooltipId : undefined}
    >
      <p className="text-xs font-semibold text-white/45">{label}</p>
      <p className="mt-3 truncate font-mono text-2xl font-semibold leading-none" title={value}>
        {value}
      </p>
      <p className="mt-3 truncate text-xs text-white/42" title={meta}>
        {meta}
      </p>
      {tooltip ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute inset-x-3 bottom-[calc(100%-0.35rem)] z-40 rounded-xl border border-white/14 bg-[#080b09]/96 p-3 text-left text-[#f7f4ec] opacity-0 shadow-[0_24px_70px_-34px_rgba(0,0,0,0.9)] backdrop-blur-xl transition duration-150 group-hover/stat:translate-y-[-0.25rem] group-hover/stat:opacity-100 group-focus-visible/stat:translate-y-[-0.25rem] group-focus-visible/stat:opacity-100"
        >
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7be3a0]">{tooltip.title}</p>
          <p className="mt-1.5 text-xs leading-5 text-white/72">{tooltip.description}</p>
          <p className="mt-2 rounded-lg border border-white/8 bg-white/6 px-2 py-1.5 font-mono text-[11px] leading-4 text-white/70">
            {tooltip.formula}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-white/46">{tooltip.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

function AccountDailyTrend({ daily }: { daily: TokenAccountUsageProfile["daily"] }) {
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">每日趋势</h3>
        <span className="font-mono text-xs text-white/45">峰值 {formatTokens(maxTokens)}</span>
      </div>
      <div className="mt-4 grid h-64 grid-cols-[repeat(auto-fit,minmax(5px,1fr))] items-end gap-1 rounded-xl border border-white/8 bg-black/18 px-3 pb-3 pt-5">
        {daily.map((point, index) => (
          <div key={point.date} className="flex h-full items-end">
            <div
              className={`w-full rounded-t-[3px] transition hover:translate-y-[-2px] ${
                index === daily.length - 1 ? "bg-[#f1c45c]" : "bg-[#43d184] hover:bg-[#7be3a0]"
              }`}
              style={{ height: `${Math.max(2, (point.tokens / maxTokens) * 100)}%` }}
              title={`${point.date} ${formatTokens(point.tokens)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs text-white/38">
        <span>{daily[0]?.date.slice(5) ?? "--"}</span>
        <span>{daily.at(-1)?.date.slice(5) ?? "--"}</span>
      </div>
    </section>
  );
}

function AccountHeatmap({ heatmap }: { heatmap: TokenAccountUsageProfile["heatmap"] }) {
  const maxTokens = Math.max(1, ...heatmap.map((cell) => cell.tokens));
  const cells = new Map(heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">分时活跃</h3>
        <span className="font-mono text-xs text-white/45">少 → 多</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[38rem]">
          <div
            className="grid gap-1 text-[10px] text-white/38"
            style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}
          >
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className={hour % 3 === 0 ? "text-center" : "text-transparent"}>
                {String(hour).padStart(2, "0")}
              </span>
            ))}
            {weekdays.map((weekday, weekdayIndex) => (
              <div key={weekday} className="contents">
                <span className="flex h-4 items-center">{weekday}</span>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cell = cells.get(`${weekdayIndex}:${hour}`);
                  const intensity = (cell?.tokens ?? 0) / maxTokens;

                  return (
                    <span
                      key={`${weekday}:${hour}`}
                      className="h-4 rounded-[4px] border border-white/5"
                      style={{ backgroundColor: heatColor(intensity) }}
                      title={`${weekday} ${String(hour).padStart(2, "0")}:00 ${formatTokens(cell?.tokens ?? 0)}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountBreakdownPanel({
  barColor,
  items,
  meta,
  title,
}: {
  barColor: string;
  items: Array<{ name: string; value: number; meta: string; share: number }>;
  meta: string;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="font-mono text-xs text-white/45">{meta}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 8).map((item) => (
            <div key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate font-medium text-white/86">{item.name}</p>
                <p className="shrink-0 font-mono text-white/62">{formatTokens(item.value)}</p>
              </div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_4.25rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, item.share * 100)}%`, backgroundColor: barColor }}
                  />
                </div>
                <p className="truncate text-right text-xs text-white/42">{item.meta}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-white/10 bg-black/16 px-3 py-4 text-center text-sm text-white/45">暂无数据</p>
        )}
      </div>
    </section>
  );
}

function AccountProjectList({ projects }: { projects: TokenAccountUsageProfile["projects"] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">项目分布</h3>
        <span className="font-mono text-xs text-white/45">{projects.length} 个项目</span>
      </div>
      <div className="mt-4 space-y-3">
        {projects.length ? (
          projects.slice(0, 8).map((project) => (
            <div key={project.name} className="rounded-xl border border-white/8 bg-black/16 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white/88">{project.name}</p>
                  <p className="mt-1 text-xs text-white/42">
                    {formatNumber(project.activeDays)}d · {formatNumber(project.models)} models
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-semibold text-[#bdf5cc]" title={formatTokens(project.tokens)}>
                    {formatTokens(project.tokens)}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#7be3a0]"
                    style={{ width: `${Math.max(2, project.share * 100)}%` }}
                  />
                </div>
                <p className="text-right font-mono text-xs text-white/42">{formatUsd(project.costUsd)}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-white/10 bg-black/16 px-3 py-4 text-center text-sm text-white/45">暂无数据</p>
        )}
      </div>
    </section>
  );
}

export function AccountSessionList({ sessions }: { sessions: TokenAccountUsageProfile["sessions"] }) {
  const sortedSessions = [...sessions].sort((a, b) => b.tokens - a.tokens);
  const maxTokens = Math.max(1, ...sortedSessions.map((session) => session.tokens));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/6 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Session 明细</h3>
          <p className="mt-1 text-xs leading-5 text-white/42">按 session 聚合，优先展示本地提取的短标题</p>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-black/16 px-3 py-1 font-mono text-xs text-white/52">
          {formatNumber(sortedSessions.length)} sessions · 按 token 降序
        </span>
      </div>

      {sortedSessions.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[58rem] table-fixed border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-white/38">
              <tr>
                <th className="w-[16rem] border-b border-white/10 px-3 py-2 font-semibold">Session</th>
                <th className="w-[10rem] border-b border-white/10 px-3 py-2 text-right font-semibold" aria-sort="descending">
                  总 token ↓
                </th>
                <th className="w-[12rem] border-b border-white/10 px-3 py-2 font-semibold">模型</th>
                <th className="w-[10rem] border-b border-white/10 px-3 py-2 font-semibold">工具</th>
                <th className="w-[11rem] border-b border-white/10 px-3 py-2 font-semibold">项目</th>
                <th className="w-[9rem] border-b border-white/10 px-3 py-2 font-semibold">开始时间</th>
                <th className="w-[9rem] border-b border-white/10 px-3 py-2 font-semibold">结束时间</th>
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((session) => {
                const hasTitle = Boolean(session.title);
                const title = session.title || formatSessionLabel(session.id);

                return (
                  <tr key={session.id} className="group">
                    <td className="border-b border-white/8 px-3 py-3 align-top">
                      <p
                        className={`truncate text-sm font-semibold ${hasTitle ? "text-[#dffbe8]" : "font-mono text-xs text-[#bdf5cc]"}`}
                        title={hasTitle ? session.title : session.id}
                      >
                        {title}
                      </p>
                      <p className="mt-1 text-xs text-white/36">
                        {formatNumber(session.records)} records · {formatUsd(session.costUsd)}
                        {hasTitle ? ` · ${formatSessionLabel(session.id)}` : ""}
                      </p>
                    </td>
                  <td className="border-b border-white/8 px-3 py-3 text-right align-top">
                    <p className="font-mono text-base font-semibold text-[#ffe2a8]">{formatTokens(session.tokens)}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[#7be3a0]"
                        style={{ width: `${Math.max(2, (session.tokens / maxTokens) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="border-b border-white/8 px-3 py-3 align-top">
                    <SessionDimension value={session.model} count={session.models} label="models" />
                  </td>
                  <td className="border-b border-white/8 px-3 py-3 align-top">
                    <SessionDimension value={session.tool} count={session.tools} label="tools" />
                  </td>
                  <td className="border-b border-white/8 px-3 py-3 align-top">
                    <SessionDimension value={session.project} count={session.projects} label="projects" />
                  </td>
                  <td className="border-b border-white/8 px-3 py-3 align-top font-mono text-xs text-white/62" title={session.startAt}>
                    {formatShortDate(session.startAt)}
                  </td>
                  <td className="border-b border-white/8 px-3 py-3 align-top font-mono text-xs text-white/62" title={session.endAt}>
                    {formatShortDate(session.endAt)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/16 px-3 py-4 text-center text-sm text-white/45">暂无 session 数据</p>
      )}
    </section>
  );
}

function SessionDimension({ count, label, value }: { count: number; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-white/82" title={value}>
        {value || "unknown"}
      </p>
      {count > 1 ? <p className="mt-1 text-xs text-white/36">+{formatNumber(count - 1)} {label}</p> : null}
    </div>
  );
}

function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) {
    return null;
  }

  const tone =
    toast.tone === "error"
      ? "border-[#c05c38]/40 bg-[#fff0e9] text-[#7b2f1d] shadow-[0_24px_70px_-36px_rgba(192,92,56,0.8)] ring-[#c05c38]/10"
      : "border-[#26745e]/40 bg-[#eaf5ef] text-[#163d33] shadow-[0_24px_70px_-36px_rgba(38,116,94,0.8)] ring-[#26745e]/10";

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-1/2 z-[100] flex min-h-12 min-w-[11rem] max-w-[min(15rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border px-4 py-3 text-center text-sm font-semibold leading-5 ring-4 backdrop-blur-xl ${tone}`}
    >
      {toast.message}
    </div>
  );
}

function InstallGuideDialog({
  canLogin,
  onClose,
  onCopy,
  onLogin,
  onPlatformChange,
  onRefresh,
  onStepChange,
  open,
  platform,
  stepIndex,
}: {
  canLogin: boolean;
  onClose: () => void;
  onCopy: (command: string, label: string) => void;
  onLogin: () => void;
  onPlatformChange: (platform: InstallGuidePlatform) => void;
  onRefresh: () => void;
  onStepChange: (step: number) => void;
  open: boolean;
  platform: InstallGuidePlatform;
  stepIndex: number;
}) {
  if (!open) {
    return null;
  }

  const guide = INSTALL_GUIDES[platform] ?? INSTALL_GUIDES.macos;
  const steps = guide.steps;
  const step = steps[stepIndex] ?? steps[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  function completeGuide() {
    onClose();
    onRefresh();
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#11130f]/45 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-board-install-guide-title"
        className="flex h-[min(42rem,calc(100vh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border-2 border-[#26745e]/55 bg-[#fbf7ef] shadow-[0_34px_120px_-48px_rgba(17,19,15,0.85)]"
      >
        <div className="shrink-0 border-b border-stone-950/8 px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-center gap-2">
            <div className="grid flex-1 grid-cols-3 gap-2">
              {steps.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onStepChange(index)}
                  className={`h-1.5 rounded-full transition ${
                    index <= stepIndex ? "bg-[#26745e]" : "bg-stone-950/8 hover:bg-stone-950/16"
                  }`}
                  aria-label={`查看${item.title}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-3 inline-flex size-9 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-950/8 hover:text-stone-900"
              aria-label="关闭安装指南"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <div className="mb-5 rounded-2xl border border-stone-950/10 bg-white/70 p-2">
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="选择安装系统">
              {(Object.keys(INSTALL_GUIDES) as InstallGuidePlatform[]).map((item) => {
                const selected = item === platform;

                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onPlatformChange(item)}
                    className={`min-h-10 rounded-xl px-3 text-sm font-semibold transition ${
                      selected
                        ? "bg-[#11130f] text-[#f8f1e5] shadow-[0_14px_36px_-28px_rgba(17,19,15,0.8)]"
                        : "text-stone-500 hover:bg-stone-950/6 hover:text-stone-900"
                    }`}
                  >
                    {INSTALL_GUIDES[item].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-2 text-xs leading-5 text-stone-500">{guide.description}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-[#26745e]/25 bg-[#eaf5ef] text-[#26745e] shadow-[0_16px_42px_-28px_rgba(38,116,94,0.8)]">
              <Icon name={step.command ? "terminal" : "refresh"} />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#26745e]">
                {step.eyebrow} / {steps.length}
              </p>
              <h2 id="token-board-install-guide-title" className="mt-2 text-2xl font-semibold leading-tight text-stone-950 sm:text-3xl">
                {step.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
                {step.description}
              </p>
            </div>
          </div>

          {step.command ? (
            <div className="mt-5 overflow-hidden rounded-2xl bg-[#111827] text-white shadow-[0_24px_70px_-48px_rgba(17,24,39,0.9)]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <span className="font-mono text-xs text-white/52">{step.commandLabel}</span>
                <button
                  type="button"
                  onClick={() => onCopy(step.command!, step.commandLabel ?? "命令")}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/16"
                >
                  <Icon name="download" />
                  复制命令
                </button>
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-4 py-4 font-mono text-sm leading-7 text-[#f8f1e5] sm:text-base">
                <span className="mr-3 select-none text-[#7be3a0]">&gt;_</span>
                {step.command}
              </pre>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-[#26745e]/20 bg-[#eaf5ef] p-4 text-sm leading-6 text-[#163d33]">
              <p className="font-semibold text-[#26745e]">完成后你可以：</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {["刷新榜单", "切换时间范围", "查看个人消耗"].map((item) => (
                  <span key={item} className="rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-center font-semibold">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {canLogin && stepIndex === 0 ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-stone-950/10 bg-white/70 p-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
              <p>还没登录页面的话，可以先完成 GitHub 登录；安装命令也会在终端里引导授权。</p>
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-stone-950/12 bg-white px-3 font-semibold text-stone-800 transition hover:border-[#26745e]/35 hover:bg-[#eef7f2]"
              >
                <Icon name="github" />
                GitHub 登录
              </button>
            </div>
          ) : null}

          <p className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm leading-6 text-stone-600">
            {step.note}
          </p>

          {isLastStep ? (
            <div className="mt-4 rounded-2xl border border-stone-950/10 bg-white/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-stone-950">以后不想同步时</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{guide.uninstall.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(guide.uninstall.command, guide.uninstall.commandLabel)}
                  className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-stone-950/10 bg-white px-3 text-xs font-semibold text-stone-800 transition hover:border-[#26745e]/35 hover:bg-[#eef7f2]"
                >
                  <Icon name="download" />
                  复制卸载命令
                </button>
              </div>
              <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[#111827] px-3 py-3 font-mono text-xs leading-5 text-[#f8f1e5]">
                <span className="mr-2 select-none text-[#7be3a0]">&gt;_</span>
                {guide.uninstall.command}
              </pre>
              <p className="mt-3 text-xs leading-5 text-stone-500">{guide.uninstall.note}</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-stone-950/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-stone-500 transition hover:bg-stone-950/6 hover:text-stone-900"
          >
            跳过
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onStepChange(Math.max(0, stepIndex - 1))}
              disabled={isFirstStep}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stone-950/12 bg-white px-5 text-sm font-semibold text-stone-800 transition hover:border-[#26745e]/35 hover:bg-[#eef7f2] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-950/12 disabled:hover:bg-white"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={isLastStep ? completeGuide : () => onStepChange(Math.min(steps.length - 1, stepIndex + 1))}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#26745e] px-5 text-sm font-semibold text-white shadow-[0_18px_45px_-28px_rgba(38,116,94,0.9)] transition hover:bg-[#1f604f]"
            >
              {isLastStep ? "完成并刷新" : "下一步"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

type LoadingTone = "dark" | "light";

function LoadingSpinner({
  className = "size-4",
  tone = "dark",
}: {
  className?: string;
  tone?: LoadingTone;
}) {
  const tones = {
    dark: "border-stone-950/15 border-t-[#26745e]",
    light: "border-white/18 border-t-[#f1c45c]",
  };

  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-2 motion-safe:animate-spin ${tones[tone]} ${className}`}
    />
  );
}

function LoadingInline({
  className = "",
  label,
  spinnerClassName = "size-3.5",
  tone = "dark",
}: {
  className?: string;
  label: string;
  spinnerClassName?: string;
  tone?: LoadingTone;
}) {
  return (
    <span role="status" className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}>
      <LoadingSpinner className={spinnerClassName} tone={tone} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function InsightStrip({ loading, text }: { loading: boolean; text: string }) {
  return (
    <section className="rounded-[1.15rem] border border-stone-950/10 bg-[#fffdfa] px-4 py-3 shadow-[0_18px_55px_-52px_rgba(28,25,23,0.58)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="w-fit rounded-full bg-[#11130f] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f8f1e5]">
          自动洞察
        </span>
        <p className="text-sm leading-6 text-stone-700">
          {loading ? <LoadingInline label="真实数据加载后会生成榜首、峰值与效率摘要。" /> : text}
        </p>
      </div>
    </section>
  );
}

function TrustEvidenceBar({
  apiBaseUrl,
  error,
  loading,
  range,
  rangeRecordCount,
  recordCount,
  sourceLabel,
  summary,
}: {
  apiBaseUrl: string;
  error: string;
  loading: boolean;
  range: TokenBoardRange;
  rangeRecordCount: number;
  recordCount: number;
  sourceLabel: string;
  summary: TokenLeaderboardSummary;
}) {
  const evidence: Array<{ label: string; loading?: boolean }> = loading
    ? [
        { label: "正在连接后端", loading: true },
        { label: "不展示示例排行榜", loading: true },
        { label: "加载超过 10 秒会提示重试", loading: true },
      ]
    : error
      ? [
          { label: `读取失败：${error}` },
          { label: "可重试或检查 agent 上报" },
          { label: "不展示伪数据" },
        ]
      : [
          { label: `更新时间 ${formatShortDate(summary.endAt)}` },
          { label: `数据源 ${sourceLabel}` },
          { label: `全库/可用 ${formatNumber(recordCount)}` },
          { label: `当前${range} ${formatNumber(rangeRecordCount)}` },
          { label: `活跃用户 ${formatNumber(summary.activeUsers)}` },
          { label: `${ROLLING_RANGE_LABELS[range]} · Asia/Shanghai` },
        ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/7 p-3">
      <div className="flex flex-wrap gap-2">
        {evidence.map((item) => (
          <span key={item.label} className="rounded-full border border-white/10 bg-black/16 px-2.5 py-1 font-mono text-[11px] text-white/70">
            {item.loading ? <LoadingInline label={item.label} tone="light" /> : item.label}
          </span>
        ))}
      </div>
      <p className="mt-2 hidden text-xs leading-5 text-white/48 sm:block">
        {apiBaseUrl ? "本页只读取自动上报服务。" : "Token Board API 未配置，页面不会回退到静态或本地数据。"}
        只展示 token、模型、工具、项目 basename 与会话短标题；费用为公开模型单价估算，不代表实际账单。
      </p>
    </div>
  );
}

function EfficiencyStrip({
  cacheHitRate,
  costPerSession,
  dailyAverageTokens,
  loading,
  tokensPerSession,
}: {
  cacheHitRate: number;
  costPerSession: number;
  dailyAverageTokens: number;
  loading: boolean;
  tokensPerSession: number;
}) {
  const items = [
    { label: "日均消耗", value: formatTokens(dailyAverageTokens), meta: "按当前区间摊平" },
    { label: "消耗 / 会话", value: formatTokens(tokensPerSession), meta: "单次任务体量" },
    { label: "费用 / 会话", value: formatUsd(costPerSession), meta: "估算单次成本" },
    { label: "缓存命中率", value: formatPercent(cacheHitRate), meta: "上下文复用效率" },
  ];

  return (
    <section className="grid gap-2 rounded-[1.15rem] border border-stone-950/10 bg-[#fffdfa] p-3 shadow-[0_18px_55px_-52px_rgba(28,25,23,0.58)] sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-stone-950/8 bg-[#f8f2e8] px-3 py-3">
          <p className="text-xs font-semibold text-stone-500">{item.label}</p>
          <p className="mt-2 font-mono text-xl font-semibold text-stone-950">
            {loading ? <LoadingInline label="Loading" spinnerClassName="size-5" /> : item.value}
          </p>
          <p className="mt-1 truncate text-xs text-stone-500">
            {loading ? <LoadingInline label="真实数据加载中" /> : item.meta}
          </p>
        </div>
      ))}
    </section>
  );
}

function SegmentedControl({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ key: string; label: string; disabled?: boolean; disabledReason?: string }>;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      className="grid w-full rounded-xl border border-white/15 bg-white/10 p-1"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="radio"
          aria-checked={value === item.key}
          aria-disabled={item.disabled || undefined}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onClick={() => onChange(item.key)}
          className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition ${
            value === item.key
              ? "bg-[#f8f1e5] text-[#11130f] shadow-[0_10px_24px_-20px_rgba(255,255,255,0.7)]"
              : item.disabled
                ? "cursor-not-allowed text-white/28"
                : "text-white/72 hover:bg-white/10 hover:text-white"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: ReactNode;
  meta: ReactNode;
  tone: "ink" | "mint" | "blue" | "gold";
}) {
  const tones = {
    ink: "border-[#11130f] bg-[#11130f] text-white",
    mint: "border-[#26745e]/20 bg-[#eaf5ef] text-[#163d33]",
    blue: "border-[#2f6387]/18 bg-[#e9f1f4] text-[#183447]",
    gold: "border-[#b06a2c]/18 bg-[#fff2d6] text-[#5a3419]",
  };

  return (
    <div className={`min-h-32 rounded-[1.15rem] border p-4 shadow-[0_18px_55px_-50px_rgba(28,25,23,0.7)] ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-65">{label}</p>
        <span className="mt-0.5 size-2 rounded-full bg-current opacity-55" />
      </div>
      <p className="mt-5 font-mono text-3xl font-semibold leading-none sm:text-4xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-3 truncate text-xs opacity-60" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
    </div>
  );
}

function HeroSignal({ label, value, meta }: { label: string; value: ReactNode; meta: ReactNode }) {
  return (
    <div className="min-w-0 border-l border-white/12 pl-3 sm:pl-4">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-white/42 sm:text-xs sm:tracking-[0.14em]">{label}</p>
      <p className="mt-2 truncate text-base font-semibold text-white sm:text-xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-[#f1c45c] sm:text-xs" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
    </div>
  );
}

export function DailyTokenTrendChart({
  daily,
  loading,
  maxDailyTokens,
}: {
  daily: TokenLeaderboardSummary["daily"];
  loading: boolean;
  maxDailyTokens: number;
}) {
  if (loading) {
    return <TrendLoadingBars />;
  }

  return (
    <>
      {daily.map((point, index) => (
        <DailyTokenTrendBar
          key={point.date}
          dailyLength={daily.length}
          index={index}
          maxDailyTokens={maxDailyTokens}
          point={point}
        />
      ))}
    </>
  );
}

function DailyTokenTrendBar({
  dailyLength,
  index,
  maxDailyTokens,
  point,
}: {
  dailyLength: number;
  index: number;
  maxDailyTokens: number;
  point: TokenLeaderboardSummary["daily"][number];
}) {
  const tooltipId = useId();
  const safeMaxTokens = Math.max(1, maxDailyTokens);
  const barHeightPercent = Math.max(3, (point.tokens / safeMaxTokens) * 100);
  const barHeight = `${barHeightPercent}%`;
  const isLatest = index === dailyLength - 1;
  const exactTokens = `${formatNumber(point.tokens)} tokens`;
  const exactLabel = `${point.date} ${exactTokens}`;
  const tooltipAlignClass =
    dailyLength === 1
      ? "left-1/2 -translate-x-1/2 text-center"
      : index === 0
        ? "left-0 translate-x-0 text-left"
        : isLatest
          ? "right-0 translate-x-0 text-right"
          : "left-1/2 -translate-x-1/2 text-center";
  const tooltipArrowClass =
    dailyLength === 1
      ? "left-1/2 -translate-x-1/2"
      : index === 0
        ? "left-3"
        : isLatest
          ? "right-3"
          : "left-1/2 -translate-x-1/2";

  return (
    <div className="relative flex h-full min-w-0 items-end">
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-label={exactLabel}
        className="group/trend relative flex h-full w-full cursor-crosshair appearance-none items-end rounded-t-[3px] border-0 bg-transparent px-0 pb-0 pt-20 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-[#26745e]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdfa]"
        data-token-trend-point={point.date}
      >
        <span
          aria-hidden="true"
          className={`block w-full rounded-t-[3px] transition duration-200 group-hover/trend:translate-y-[-2px] group-focus-visible/trend:translate-y-[-2px] ${
            isLatest
              ? "bg-[#c05c38] group-hover/trend:bg-[#d16a45] group-focus-visible/trend:bg-[#d16a45]"
              : "bg-[#172018] group-hover/trend:bg-[#26745e] group-focus-visible/trend:bg-[#26745e]"
          }`}
          style={{ height: barHeight }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2 border-l border-dashed border-[#26745e]/45 opacity-0 transition group-hover/trend:opacity-100 group-focus-visible/trend:opacity-100"
          style={{ height: barHeight }}
        />
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute top-2 z-30 min-w-[7.5rem] max-w-[10rem] rounded-xl border border-[#26745e]/18 bg-[#fffdfa]/98 px-3 py-2 text-stone-950 opacity-0 shadow-[0_18px_45px_-26px_rgba(38,116,94,0.75)] backdrop-blur transition duration-150 group-hover/trend:translate-y-[-0.2rem] group-hover/trend:opacity-100 group-focus-visible/trend:translate-y-[-0.2rem] group-focus-visible/trend:opacity-100 ${tooltipAlignClass}`}
          data-token-trend-tooltip-placement="top-rail"
          data-token-trend-tooltip={point.date}
        >
          <span className="block font-mono text-[10px] font-semibold text-[#26745e]">{point.date}</span>
          <span className="mt-1 block truncate font-mono text-sm font-semibold leading-none">{formatTokens(point.tokens)}</span>
          <span className="mt-1 block truncate font-mono text-[10px] text-stone-500" title={exactTokens}>
            {exactTokens}
          </span>
          <span
            aria-hidden="true"
            className={`absolute top-full size-2 rotate-45 border-b border-r border-[#26745e]/18 bg-[#fffdfa] ${tooltipArrowClass}`}
          />
        </span>
      </button>
    </div>
  );
}

function PanelHeader({ title, meta, action }: { title: string; meta: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-stone-950/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 font-mono text-xs text-stone-500">{meta}</p>
      </div>
      <span className="w-fit rounded-full border border-stone-950/10 bg-[#f5efe4] px-3 py-1 font-mono text-xs text-stone-600">
        {action}
      </span>
    </div>
  );
}

function SortableColumnHeader({
  active,
  align = "left",
  children,
}: {
  active: boolean;
  align?: "left" | "right";
  children: string;
}) {
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${
          active
            ? "bg-[#11130f] text-[#f8f1e5]"
            : "text-stone-500"
        }`}
        title={active ? "当前按此列降序排列" : undefined}
      >
        {children}
        {active ? <span aria-hidden="true">↓</span> : null}
      </span>
    </th>
  );
}

function LeaderboardMobileCard({
  metric,
  showDailyTrend,
  user,
}: {
  metric: TokenBoardMetric;
  showDailyTrend: boolean;
  user: TokenLeaderboardUser;
}) {
  const metricLabel = METRICS.find((item) => item.key === metric)?.label ?? "总消耗";
  const metricValue = formatMetricValue(getUserMetricValue(user, metric), metric);
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);

  return (
    <article className="rounded-2xl border border-stone-950/10 bg-white p-3 shadow-[0_14px_42px_-36px_rgba(28,25,23,0.65)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full border border-[#b06a2c]/25 bg-[#fff2d6] px-2.5 py-1 font-mono text-xs font-semibold text-[#5a3419]">
            #{user.rank}
          </span>
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-stone-950">{user.displayName}</p>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold text-stone-950">{metricValue}</p>
          <p className="text-xs text-stone-500">{metricLabel} ↓</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-stone-950/8 bg-[#f8f2e8] p-2 text-xs">
        <MetricMini label="总消耗" value={formatTokens(consumptionTokens)} />
        <MetricMini label="费用" value={formatUsd(user.costUsd)} />
        <MetricMini label="会话" value={formatNumber(user.sessions)} />
      </div>
      {showDailyTrend ? (
        <div className="mt-3 rounded-xl border border-stone-950/8 bg-[#fffdfa] px-3 py-2">
          <DailyUsageSparkline
            daily={daily}
            label={`${user.displayName} 每日用量`}
            metaClassName="text-stone-500"
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded-md border border-stone-950/10 bg-[#f5efe4] px-2 py-1 font-semibold text-stone-700">
          {user.topModel}
        </span>
        <span>{formatNumber(user.records)} records</span>
        <span>{formatNumber(user.activeDays)}d active</span>
        {user.lastReportedAt ? <span>最近 {formatRelativeTime(user.lastReportedAt)}</span> : null}
        {user.deltaTokens !== null ? <span>{formatSignedPercent(user.deltaTokens)} 较上一周期</span> : null}
      </div>
    </article>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-stone-500">{label}</p>
      <p className="mt-1 truncate font-mono font-semibold text-stone-900" title={value}>{value}</p>
    </div>
  );
}

function DailyUsageSparkline({
  daily,
  fixedWidth = false,
  label,
  metaClassName = "text-stone-400",
}: {
  daily: TokenLeaderboardUser["daily"];
  fixedWidth?: boolean;
  label: string;
  metaClassName?: string;
}) {
  const gradientId = sanitizeSvgId(useId());
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const normalizedDaily = normalizeDailyUsageSeries(daily);
  const width = 160;
  const height = 46;
  const paddingX = 4;
  const paddingY = 5;
  const maxTokens = Math.max(1, ...normalizedDaily.map((point) => point.tokens));
  const totalTokens = normalizedDaily.reduce((sum, point) => sum + point.tokens, 0);
  const peak = normalizedDaily.reduce(
    (best, point) => (point.tokens > best.tokens ? point : best),
    { date: "", tokens: 0 }
  );
  const points = normalizedDaily.map((point, index) => {
    const x =
      normalizedDaily.length <= 1
        ? width / 2
        : paddingX + (index * (width - paddingX * 2)) / (normalizedDaily.length - 1);
    const y = height - paddingY - (point.tokens / maxTokens) * (height - paddingY * 2);

    return { ...point, x, y };
  });
  const activePoint = hoveredPointIndex === null ? null : points[hoveredPointIndex] ?? null;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = points.length
    ? `${path} L ${points.at(-1)?.x.toFixed(2)} ${height - paddingY} L ${points[0].x.toFixed(2)} ${height - paddingY} Z`
    : "";
  const firstDate = normalizedDaily[0]?.date.slice(5) ?? "--";
  const lastDate = normalizedDaily.at(-1)?.date.slice(5) ?? "--";
  const title = peak.date
    ? `${label}：${firstDate} - ${lastDate}，峰值 ${peak.date.slice(5)} ${formatTokens(peak.tokens)}，合计 ${formatTokens(totalTokens)}`
    : `${label}：暂无每日用量`;
  const activeSummary = activePoint
    ? `${activePoint.date.slice(5)} ${formatTokens(activePoint.tokens)}`
    : `峰值 ${formatTokens(peak.tokens)}`;
  const exactActiveLabel = activePoint ? `${formatNumber(activePoint.tokens)} tokens` : "";

  return (
    <div aria-label={title} className={`min-w-0 ${fixedWidth ? "w-[16rem] min-w-[16rem] max-w-[16rem]" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`truncate text-[11px] font-semibold ${metaClassName}`}>每日用量</p>
        <p className={`min-w-0 max-w-[9rem] truncate text-right font-mono text-[11px] ${metaClassName}`} title={activeSummary}>
          {activeSummary}
        </p>
      </div>
      <div
        className={`mt-1 h-12 overflow-hidden rounded-lg border px-2.5 py-1.5 transition-colors ${
          activePoint
            ? "border-[#26745e]/25 bg-[#fffdfa] shadow-[0_12px_34px_-28px_rgba(38,116,94,0.75)]"
            : "border-transparent bg-transparent"
        }`}
        role={activePoint ? "tooltip" : undefined}
      >
        {activePoint ? (
          <>
            <p className="font-mono text-[10px] font-semibold text-[#26745e]">{activePoint.date}</p>
            <p className="mt-0.5 truncate whitespace-nowrap font-mono text-xs font-semibold text-stone-950" title={exactActiveLabel}>
              {exactActiveLabel}
            </p>
          </>
        ) : (
          <span className="sr-only">悬停每日折线查看当天具体用量</span>
        )}
      </div>
      <div
        className="relative h-12"
        onMouseLeave={() => setHoveredPointIndex(null)}
      >
        <svg
          aria-label={label}
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#26745e" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#26745e" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} stroke="#e2d6c5" strokeWidth="1" />
          {areaPath ? (
            <path d={areaPath} fill={`url(#${gradientId})`} />
          ) : null}
          {path ? (
            <path
              d={path}
              fill="none"
              stroke="#26745e"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {activePoint ? (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={paddingY}
              y2={height - paddingY}
              stroke="#26745e"
              strokeDasharray="3 3"
              strokeOpacity="0.5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {points.map((point, index) => {
            const left = index === 0 ? 0 : (points[index - 1].x + point.x) / 2;
            const right = index === points.length - 1 ? width : (point.x + points[index + 1].x) / 2;
            const exactLabel = `${point.date} ${formatNumber(point.tokens)} tokens`;

            return (
              <rect
                key={`${point.date}:hit`}
                aria-label={exactLabel}
                className="cursor-crosshair outline-none"
                data-daily-usage-point={point.date}
                fill="transparent"
                height={height}
                onClick={() => setHoveredPointIndex(index)}
                onMouseEnter={() => setHoveredPointIndex(index)}
                onMouseMove={() => setHoveredPointIndex(index)}
                pointerEvents="all"
                width={Math.max(8, right - left)}
                x={left}
                y={0}
              >
                <title>{exactLabel}</title>
              </rect>
            );
          })}
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {points.map((point, index) => {
            const isHovered = hoveredPointIndex === index;
            const isLatest = index === points.length - 1;
            const dotSize = isHovered ? "size-[9px]" : isLatest ? "size-2" : "size-[7px]";
            const dotFill = isHovered ? "bg-[#26745e]" : isLatest ? "bg-[#c05c38]" : "bg-[#fffdfa]";

            return (
              <span
                key={`${point.date}:dot`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#26745e] ${dotSize} ${dotFill}`}
                style={{
                  left: `${(point.x / width) * 100}%`,
                  top: `${(point.y / height) * 100}%`,
                }}
              />
            );
          })}
        </div>
      </div>
      <div className={`mt-1 flex justify-between font-mono text-[10px] ${metaClassName}`}>
        <span>{firstDate}</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
}

function LeaderboardRow({ showDailyTrend, user }: { showDailyTrend: boolean; user: TokenLeaderboardUser }) {
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);
  const rankTone =
    user.rank === 1
      ? "border-[#b06a2c]/30 bg-[#fff2d6] text-[#5a3419]"
      : user.rank === 2
        ? "border-[#2f6387]/20 bg-[#e9f1f4] text-[#183447]"
        : user.rank === 3
          ? "border-[#26745e]/20 bg-[#eaf5ef] text-[#163d33]"
          : "border-stone-950/10 bg-white text-stone-500";

  return (
    <tr className="transition hover:bg-[#f8f2e8]">
      <td className="px-4 py-3">
        <span className={`inline-flex min-w-10 justify-center rounded-full border px-2 py-1 font-mono text-xs font-semibold ${rankTone}`}>
          #{user.rank}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-stone-950">{user.displayName}</p>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </div>
      </td>
      {showDailyTrend ? (
        <td className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">
          <DailyUsageSparkline fixedWidth daily={daily} label={`${user.displayName} 每日用量`} />
        </td>
      ) : null}
      <td className="px-4 py-3 text-right font-mono font-semibold text-stone-950">{formatTokens(consumptionTokens)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatUsd(user.costUsd)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(user.sessions)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-stone-950/10 bg-[#f5efe4] px-2 py-1 text-xs font-semibold text-stone-700">
            {user.topModel}
          </span>
          {user.deltaTokens !== null ? (
            <span
              className={`font-mono text-xs font-semibold ${user.deltaTokens >= 0 ? "text-[#26745e]" : "text-[#c05c38]"}`}
              title="较上一周期 Token 变化"
            >
              {formatSignedPercent(user.deltaTokens)}
            </span>
          ) : null}
          {user.lastReportedAt ? (
            <span className="text-xs text-stone-400" title={`最近上报：${formatShortDate(user.lastReportedAt)}`}>
              {formatNumber(user.records)} records · {formatNumber(user.activeDays)}d
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function MobileLeaderboardLoading({ slow }: { slow: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-stone-950/8 bg-[#f8f2e8] p-6 text-center">
      <LoadingSpinner className="size-7" />
      <div>
        <p className="font-semibold text-stone-950">{slow ? "数据加载较慢" : "Loading 真实用户数据"}</p>
        <p className="mt-1 text-xs text-stone-500">
          {slow ? "可以点击右侧刷新榜单，或确认本机 agent 是否已完成上报。" : "数据没回来前不会展示示例排行榜"}
        </p>
      </div>
    </div>
  );
}

function LeaderboardLoadingRow({ columnCount, slow }: { columnCount: number; slow: boolean }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-12">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-stone-950/8 bg-[#f8f2e8] p-6 text-center">
          <LoadingSpinner className="size-7" />
          <div>
            <p className="font-semibold text-stone-950">{slow ? "数据加载较慢" : "Loading 真实用户数据"}</p>
            <p className="mt-1 text-xs text-stone-500">
              {slow ? "可以稍后重试、刷新榜单，或确认本机 agent 是否已完成上报。" : "数据没回来前不会展示示例排行榜"}
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

function LeaderboardErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-[#c05c38]/20 bg-[#fff0e9] p-5 text-center">
      <p className="font-semibold text-[#7b2f1d]">真实用户数据读取失败</p>
      <p className="mt-1 text-xs text-[#7b2f1d]/72">{error || "请稍后再试"}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[#11130f] px-3 text-sm font-semibold text-white transition hover:bg-[#26745e]"
      >
        <Icon name="refresh" />
        重试
      </button>
    </div>
  );
}

function LeaderboardErrorRow({ columnCount, error, onRetry }: { columnCount: number; error: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-10">
        <LeaderboardErrorState error={error} onRetry={onRetry} />
      </td>
    </tr>
  );
}

function LeaderboardEmptyState() {
  return (
    <div className="rounded-xl border border-stone-950/8 bg-[#f8f2e8] px-4 py-8 text-center text-sm text-stone-500">
      暂无真实用户数据，可以切换时间范围或运行 agent 上报本机记录。
    </div>
  );
}

function LeaderboardEmptyRow({ columnCount }: { columnCount: number }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-10 text-center text-sm text-stone-500">
        暂无真实用户数据
      </td>
    </tr>
  );
}

function ShareRow({ metric, total, user }: { metric: TokenBoardMetric; total: number; user: TokenLeaderboardUser }) {
  const value = getUserMetricValue(user, metric);
  const share = total > 0 ? value / total : 0;

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_5rem] items-center gap-3">
      <Avatar name={user.displayName} index={user.rank} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{user.displayName}</p>
          <p className="font-mono text-xs font-semibold text-stone-500">{formatPercent(share)}</p>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/80 shadow-inner">
          <div
            className="h-full rounded-full bg-[#26745e]"
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
      </div>
      <p className="text-right font-mono text-sm font-semibold">{formatMetricValue(value, metric)}</p>
    </div>
  );
}

function ShareLoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)_5rem] items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/80">
            <LoadingSpinner className="size-4" />
          </span>
          <div className="space-y-2">
            <div className="h-3 w-2/3 rounded-full bg-white/85" />
            <div className="h-2 rounded-full bg-white/75" />
          </div>
          <div className="flex justify-end">
            <LoadingSpinner className="size-3.5" />
          </div>
        </div>
      ))}
    </>
  );
}

function TrendLoadingBars() {
  return (
    <div className="col-span-full flex h-full items-center justify-center">
      <LoadingInline label="趋势加载中" spinnerClassName="size-8" />
    </div>
  );
}

function EmptyPanelMessage() {
  return <p className="rounded-xl border border-stone-950/8 bg-white/60 px-3 py-4 text-center text-sm text-stone-500">暂无真实数据</p>;
}

function BreakdownPanel({
  title,
  items,
  loading = false,
}: {
  title: string;
  items: Array<{ name: string; value: number; meta: string; share: number }>;
  loading?: boolean;
}) {
  return (
    <section className="rounded-[1.25rem] border border-stone-950/10 bg-[#fffdfa] p-4 shadow-[0_18px_65px_-58px_rgba(28,25,23,0.6)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="font-mono text-xs text-stone-500">
          {loading ? <LoadingInline label="Loading" /> : items.length}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? <BreakdownLoadingRows /> : items.length ? items.slice(0, 8).map((item) => (
          <div key={item.name}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="truncate font-medium">{item.name}</p>
              <p className="shrink-0 font-mono text-stone-500">{formatTokens(item.value)}</p>
            </div>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3">
              <div className="h-2 overflow-hidden rounded-full bg-[#f0e6d7]">
                <div className="h-full rounded-full bg-[#2f6387]" style={{ width: `${Math.max(2, item.share * 100)}%` }} />
              </div>
              <p className="truncate text-right text-xs text-stone-500">{item.meta}</p>
            </div>
          </div>
        )) : <EmptyPanelMessage />}
      </div>
    </section>
  );
}

function BreakdownLoadingRows() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-2">
          <div className="grid grid-cols-[1rem_minmax(0,1fr)_4.5rem] items-center gap-3">
            <LoadingSpinner className="size-3.5" />
            <div className="h-3 w-1/2 rounded-full bg-stone-950/10" />
            <div className="flex justify-end">
              <LoadingSpinner className="size-3.5" />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3">
            <div className="h-2 rounded-full bg-stone-950/10" />
            <div className="flex justify-end">
              <LoadingSpinner className="size-3" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function GitHubAuthControl({
  viewer,
  onLogout,
}: {
  viewer: ViewerState | null;
  onLogout: () => void;
}) {
  if (!viewer) {
    return null;
  }

  if (viewer.authenticated) {
    return (
      <div className="flex w-full items-center gap-2 xl:w-auto">
        <span className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white xl:flex-none">
          <Icon name="github" />
          <span className="truncate">@{viewer.user?.githubLogin || viewer.user?.displayName || "GitHub"}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#ff9b7c]/25 bg-[#ff9b7c]/10 px-3 text-sm font-semibold text-[#ffd4c6] transition hover:border-[#ff9b7c]/45 hover:bg-[#ff9b7c]/18"
          title="退出 GitHub 登录"
        >
          <Icon name="logout" />
          退出
        </button>
      </div>
    );
  }

  return null;
}

function Avatar({ name, index }: { name: string; index: number }) {
  const tones = [
    "bg-[#eaf5ef] text-[#163d33] ring-[#26745e]/20",
    "bg-[#e9f1f4] text-[#183447] ring-[#2f6387]/20",
    "bg-[#fff2d6] text-[#5a3419] ring-[#b06a2c]/20",
    "bg-[#f7e4dc] text-[#7b2f1d] ring-[#c05c38]/20",
    "bg-[#ede7d9] text-stone-700 ring-stone-950/10",
  ];

  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ring-1 ${tones[index % tones.length]}`}
      aria-hidden="true"
    >
      {name.trim().slice(0, 1).toUpperCase() || "U"}
    </span>
  );
}

function Icon({ name }: { name: "close" | "download" | "file" | "github" | "guide" | "logout" | "refresh" | "terminal" | "upload" }) {
  const paths = {
    close: "M18 6 6 18M6 6l12 12",
    download: "M12 3v10m0 0 4-4m-4 4-4-4M5 17v2h14v-2",
    file: "M7 3h7l4 4v14H7V3Zm7 0v5h5",
    github:
      "M15 22v-3.8a3.3 3.3 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.4-3.7 1.4a12.7 12.7 0 0 0-6.7 0C5.7 1.3 4.6 1.7 4.6 1.7a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.1 9c0 5.2 3.1 6.4 6.1 6.7a3 3 0 0 0-.8 1.9c-.8.4-2.8 1-4-1.1 0 0-.7-1.3-2.1-1.4 0 0-1.3 0-.1.8 0 0 .9.4 1.5 2 0 0 .8 2.4 4.6 1.6V22",
    guide: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 6h8M8 10h6",
    logout: "M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6M21 19a2 2 0 0 1-2 2h-6",
    refresh: "M4 12a8 8 0 0 1 13.5-5.8M20 12a8 8 0 0 1-13.5 5.8M17 3v4h4M7 21v-4H3",
    terminal: "M4 17l6-5-6-5M12 19h8",
    upload: "M12 21V11m0 0-4 4m4-4 4 4M5 7V5h14v2",
  };

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function formatTokens(value: number) {
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000_000) {
    return `${formatCompact(value / 1_000_000_000)}B`;
  }

  if (absValue >= 1_000_000) {
    return `${formatCompact(value / 1_000_000)}M`;
  }

  if (absValue >= 1_000) {
    return `${formatCompact(value / 1_000)}K`;
  }

  return formatNumber(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(value: number) {
  if (value >= 1_000) {
    return `$${formatCompact(value / 1_000)}K`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function normalizeDailyUsageSeries(value: unknown): TokenLeaderboardUser["daily"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((point) => {
    if (!point || typeof point !== "object") {
      return [];
    }

    const item = point as { date?: unknown; tokens?: unknown };
    const date = typeof item.date === "string" ? item.date : "";
    const tokens = typeof item.tokens === "number" && Number.isFinite(item.tokens) ? Math.max(0, item.tokens) : 0;

    return date ? [{ date, tokens }] : [];
  });
}

function sanitizeSvgId(value: string) {
  return `spark-${value.replace(/[^a-zA-Z0-9_-]/g, "") || "daily"}`;
}

function getUserMetricValue(user: TokenLeaderboardUser, metric: TokenBoardMetric) {
  if (metric === "cost") {
    return user.costUsd;
  }

  if (metric === "sessions") {
    return user.sessions;
  }

  if (metric === "messages") {
    return user.messages;
  }

  return getTokenConsumptionTokens(user);
}

function normalizeRemoteSummary(summary: TokenLeaderboardSummary, metric: TokenBoardMetric): TokenLeaderboardSummary {
  const users = summary.users
    .map((user) => ({
      ...user,
      daily: normalizeDailyUsageSeries(user.daily),
      tokens: getTokenConsumptionTokens(user),
    }))
    .sort((left, right) => getUserMetricValue(right, metric) - getUserMetricValue(left, metric) || left.displayName.localeCompare(right.displayName))
    .map((user, index) => ({ ...user, rank: index + 1 }));
  const totalTokens = users.reduce((sum, user) => sum + user.tokens, 0);

  return {
    ...summary,
    totalTokens,
    users: users.map((user) => ({
      ...user,
      share: totalTokens > 0 ? user.tokens / totalTokens : 0,
    })),
  };
}

function normalizeRemoteAccountProfile(profile: TokenAccountUsageProfile): TokenAccountUsageProfile {
  return {
    ...profile,
    config: normalizeRemoteUserConfig(profile.config),
    daily: normalizeDailyUsageSeries(profile.daily),
    sessions: Array.isArray(profile.sessions) ? profile.sessions.map(normalizeRemoteSession) : [],
    user: profile.user
      ? {
          ...profile.user,
          daily: normalizeDailyUsageSeries(profile.user.daily),
          tokens: getTokenConsumptionTokens(profile.user),
        }
      : null,
  };
}

function normalizeRemoteUserConfig(config: TokenAccountUsageProfile["config"]): TokenAccountUsageProfile["config"] {
  if (!config || typeof config !== "object") {
    return null;
  }

  return {
    updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : new Date().toISOString(),
    agent: config.agent,
    codex: config.codex
      ? {
          model: typeof config.codex.model === "string" ? config.codex.model : undefined,
          modelReasoningEffort:
            typeof config.codex.modelReasoningEffort === "string" ? config.codex.modelReasoningEffort : undefined,
          modelContextWindow: finiteNumberOrUndefined(config.codex.modelContextWindow),
          modelAutoCompactTokenLimit: finiteNumberOrUndefined(config.codex.modelAutoCompactTokenLimit),
          modelCacheContextWindow: finiteNumberOrUndefined(config.codex.modelCacheContextWindow),
          modelMaxContextWindow: finiteNumberOrUndefined(config.codex.modelMaxContextWindow),
          effectiveContextWindowPercent: finiteNumberOrUndefined(config.codex.effectiveContextWindowPercent),
        }
      : undefined,
  };
}

function normalizeRemoteSession(session: TokenAccountUsageProfile["sessions"][number]): TokenAccountUsageProfile["sessions"][number] {
  return {
    ...session,
    title: typeof session.title === "string" && session.title.trim() ? session.title.trim() : undefined,
    tokens: Number.isFinite(session.tokens) ? session.tokens : 0,
    inputTokens: Number.isFinite(session.inputTokens) ? session.inputTokens : 0,
    cachedInputTokens: Number.isFinite(session.cachedInputTokens) ? session.cachedInputTokens : 0,
    outputTokens: Number.isFinite(session.outputTokens) ? session.outputTokens : 0,
    reasoningOutputTokens: Number.isFinite(session.reasoningOutputTokens) ? session.reasoningOutputTokens : 0,
    costUsd: Number.isFinite(session.costUsd) ? session.costUsd : 0,
    messages: Number.isFinite(session.messages) ? session.messages : 0,
    records: Number.isFinite(session.records) ? session.records : 0,
    models: Number.isFinite(session.models) ? session.models : 0,
    tools: Number.isFinite(session.tools) ? session.tools : 0,
    projects: Number.isFinite(session.projects) ? session.projects : 0,
  };
}

function finiteNumberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatMetricValue(value: number, metric: TokenBoardMetric) {
  if (metric === "cost") {
    return formatUsd(value);
  }

  if (metric === "sessions" || metric === "messages") {
    return formatNumber(value);
  }

  return formatTokens(value);
}

function buildLeaderboardInsight(summary: TokenLeaderboardSummary, cacheHitRate: number) {
  const leader = summary.users[0];
  const runnerUp = summary.users[1];
  const peak = summary.daily.reduce(
    (best, point) => (point.tokens > best.tokens ? point : best),
    { date: "", tokens: 0 }
  );
  const parts: string[] = [];

  if (leader && runnerUp) {
    parts.push(`${leader.displayName} 领先 ${runnerUp.displayName} ${formatTokens(Math.max(0, leader.tokens - runnerUp.tokens))}`);
  } else if (leader) {
    parts.push(`${leader.displayName} 暂列榜首`);
  } else {
    parts.push("当前区间还没有可展示的用户");
  }

  if (peak.date) {
    parts.push(`${peak.date.slice(5)} 峰值 ${formatTokens(peak.tokens)}`);
  }

  parts.push(`缓存命中率 ${formatPercent(cacheHitRate)}`);

  if (summary.activeUsers) {
    parts.push(`${formatNumber(summary.activeUsers)} 位参与`);
  }

  return `${parts.join("；")}。`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}

function formatRankDelta(value: number | null) {
  if (value === null) {
    return "--";
  }

  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function rankDeltaTone(value: number | null) {
  if (value === null || value === 0) {
    return "text-white/52";
  }

  return value > 0 ? "text-[#bdf5cc]" : "text-[#ffb39d]";
}

function heatColor(intensity: number) {
  if (intensity <= 0) {
    return "rgba(255,255,255,0.06)";
  }

  if (intensity < 0.18) {
    return "#123127";
  }

  if (intensity < 0.38) {
    return "#1f684b";
  }

  if (intensity < 0.62) {
    return "#2ca965";
  }

  if (intensity < 0.82) {
    return "#43d184";
  }

  return "#bdf5cc";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatSessionLabel(value: string) {
  const sessionId = value.replace(/^session:/, "") || "unknown";

  return sessionId.length > 22 ? `${sessionId.slice(0, 10)}…${sessionId.slice(-8)}` : sessionId;
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;

  if (!Number.isFinite(diffMs)) {
    return "--";
  }

  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  for (const [unit, unitMs] of units) {
    if (absMs >= unitMs) {
      return formatter.format(Math.round(-diffMs / unitMs), unit);
    }
  }

  return "刚刚";
}

type RemoteStatsResponse =
  | (TokenLeaderboardSummary & { records?: number })
  | {
      records?: number;
      summary?: TokenLeaderboardSummary;
    };

type AccountUsageResponse = {
  profile?: TokenAccountUsageProfile;
};

type InstallGuideStep = {
  command?: string;
  commandLabel?: string;
  description: string;
  eyebrow: string;
  note: string;
  title: string;
};

type InstallGuideUninstall = {
  command: string;
  commandLabel: string;
  description: string;
  note: string;
};

type InstallGuidePlatform = "macos" | "windows";

type InstallGuideConfig = {
  description: string;
  label: string;
  steps: InstallGuideStep[];
  uninstall: InstallGuideUninstall;
};

function normalizeApiBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function detectInstallGuidePlatform(): InstallGuidePlatform {
  if (typeof navigator === "undefined") {
    return "macos";
  }

  const browserNavigator = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = [
    browserNavigator.userAgentData?.platform,
    browserNavigator.platform,
    browserNavigator.userAgent,
  ].join(" ");

  return /win/i.test(platform) ? "windows" : "macos";
}

function isTokenLeaderboardSummary(value: unknown): value is TokenLeaderboardSummary {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as TokenLeaderboardSummary).users) &&
    Array.isArray((value as TokenLeaderboardSummary).daily)
  );
}

function isTokenAccountUsageProfile(value: unknown): value is TokenAccountUsageProfile {
  const profile = value as Partial<TokenAccountUsageProfile>;

  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(profile.daily) &&
    Array.isArray(profile.models) &&
    Array.isArray(profile.tools) &&
    Array.isArray(profile.projects) &&
    Array.isArray(profile.heatmap) &&
    (profile.sessions === undefined || Array.isArray(profile.sessions))
  );
}

type ViewerState = {
  authenticated: boolean;
  user?: {
    userId?: string;
    displayName?: string;
    githubLogin?: string;
    avatarUrl?: string;
  };
};

type DataLoadState = "error" | "loading" | "ready";
type AccountLoadState = "error" | "idle" | "loading" | "ready";
type ToastTone = "error" | "success";
type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};
