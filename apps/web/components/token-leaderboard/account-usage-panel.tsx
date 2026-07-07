"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import {
  getInputContextTokens,
  getTokenConsumptionTokens,
  type TokenAccountUsageProfile,
  type TokenBoardRange,
} from "@open-token-board/core";

import type { AccountLoadState, ViewerState } from "./types";
import { Avatar, Icon, Skeleton } from "./shared-ui";
import {
  formatNumber,
  formatPercent,
  formatRankDelta,
  formatSessionLabel,
  formatShortDate,
  formatTokens,
  formatUtcRange,
  formatUsd,
  heatColor,
  rankDeltaTone,
} from "./utils";

const SESSION_INITIAL_VISIBLE_COUNT = 20;
const SESSION_VISIBLE_COUNT_STEP = 20;

export function AccountUsagePanel({
  apiEnabled,
  error,
  loadState,
  onExport,
  onLogin,
  profile,
  range,
  viewer,
}: {
  apiEnabled: boolean;
  error: string;
  loadState: AccountLoadState;
  onExport?: (format: "csv" | "json") => void;
  onLogin: () => void;
  profile: TokenAccountUsageProfile | null;
  range: TokenBoardRange;
  viewer: ViewerState | null;
}) {
  const user = profile?.user ?? null;
  const inputContextTokens = user ? getInputContextTokens(user) : 0;
  const accountConsumptionTokens = user ? getTokenConsumptionTokens(user) : 0;
  const generatedTokens = user ? user.outputTokens + user.reasoningOutputTokens : 0;
  const cacheReadTokens = user?.cachedInputTokens ?? 0;
  const cacheWriteTokens = user?.cacheCreationInputTokens ?? 0;
  const cacheHitRate = inputContextTokens > 0 ? cacheReadTokens / inputContextTokens : 0;
  const accountTokensPerSession = user?.sessions ? accountConsumptionTokens / user.sessions : 0;
  const dashboardProfile = profile && user ? profile : null;

  if (apiEnabled && viewer && !viewer.authenticated) {
    return (
      <section className="rounded-lg border border-stone-950/10 bg-white px-5 py-4 shadow-sm sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-center">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-blue-600">GitHub Account</p>
            <h2 className="mt-1 text-lg font-semibold text-stone-950">登录后展开我的 Token 消耗</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
              个人视图会按当前 GitHub 账号展示排名、项目、缓存命中率和活跃分布；公共排行榜不需要登录也能查看。
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-600"
          >
            <Icon name="github" />
            GitHub 登录
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-blue-600">GitHub Account</p>
            <h2 className="mt-1 text-2xl font-semibold">我的 Token 消耗</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-600">
              {range}
            </span>
            {dashboardProfile ? (
              <>
                <button
                  type="button"
                  onClick={() => onExport?.("csv")}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Icon name="download" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => onExport?.("json")}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Icon name="file" />
                  JSON
                </button>
              </>
            ) : null}
            {viewer?.authenticated ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
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
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
            <div className="flex items-center gap-4">
              {viewer.user?.avatarUrl ? (
                <img
                  alt=""
                  className="size-12 rounded-lg border border-slate-200"
                  src={viewer.user.avatarUrl}
                />
              ) : (
                <Avatar name={user.displayName} index={user.rank || 0} />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">我的排名（按总消耗，{range}）</p>
                <p className="mt-1 truncate font-mono text-3xl font-semibold">
                  #{dashboardProfile.rank ?? "--"}
                  <span className="ml-2 text-base text-slate-400">/ {formatNumber(dashboardProfile.totalUsers)}</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-right">
              <div>
                <p className="text-xs text-slate-500">超过</p>
                <p className="mt-1 font-mono text-xl font-semibold text-blue-700">
                  {dashboardProfile.percentile === null ? "--" : formatPercent(dashboardProfile.percentile)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">排名变化</p>
                <p className={`mt-1 font-mono text-xl font-semibold ${rankDeltaTone(dashboardProfile.rankDelta)}`}>
                  {formatRankDelta(dashboardProfile.rankDelta)}
                </p>
              </div>
            </div>
          </div>

          <Link
            href={`/card?user=${encodeURIComponent(user.displayName)}&range=${range}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
          >
            📊 生成我的战报卡 · 一键导出图片分享 →
          </Link>

          <AccountHonorPanel profile={dashboardProfile} />

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <AccountStatCard
              label="预估费用"
              value={formatUsd(user.costUsd)}
              meta="USD estimate"
              tone="gold"
              tooltip={{
                title: "预估费用",
                description: "按公开模型单价估算的美元成本，不等同于 Codex 账号额度或实际账单。",
                formula: "Σ(input + cache write + cache read + output 四分类单价)",
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
                description: "排行榜主口径，按输入上下文加输出计算；cache read/write 都是输入上下文里的子项，不额外加总。",
                formula: "Σ(input_tokens + output_tokens)",
                detail: `${formatNumber(dashboardProfile.records)} 条记录，共 ${formatTokens(accountConsumptionTokens)}`,
              }}
            />
            <AccountStatCard
              label="输入上下文"
              value={formatTokens(inputContextTokens)}
              meta={`读缓存 ${formatTokens(cacheReadTokens)} · 写缓存 ${formatTokens(cacheWriteTokens)}`}
              tone="blue"
              tooltip={{
                title: "输入上下文",
                description: "模型阅读过的上下文吞吐量；cache read 和 cache write 单独展示并按不同单价估算。",
                formula: "Σ(input_tokens)",
                detail: `输入 ${formatTokens(user.inputTokens)}，读缓存 ${formatTokens(cacheReadTokens)}，写缓存 ${formatTokens(cacheWriteTokens)}`,
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
                description: "输入上下文里有多少来自 cache read。cache write 是写入成本，单独计价。",
                formula: "Σ cached_input_tokens ÷ Σ input_tokens",
                detail: `${formatTokens(cacheReadTokens)} ÷ ${formatTokens(inputContextTokens)} = ${formatPercent(cacheHitRate)}；写缓存 ${formatTokens(cacheWriteTokens)}`,
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
              barColor="#2563eb"
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
              barColor="#d97706"
            />
            <AccountProjectList projects={dashboardProfile.projects} />
          </div>

          <AccountSessionList sessions={dashboardProfile.sessions} />
        </div>
      )}
    </section>
  );
}

function AccountHonorPanel({ profile }: { profile: TokenAccountUsageProfile }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="space-y-5">
        <AccountLevelCard profile={profile} />
        <AccountPersonalBestCards personalBests={profile.personalBests} />
      </div>
      <AccountBadgeWall badges={profile.badges} />
    </div>
  );
}

function AccountLevelCard({ profile }: { profile: TokenAccountUsageProfile }) {
  const { level } = profile;
  const current = level.current;
  const next = level.next;
  const progressPercent = Math.round(level.progress * 100);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-lg border font-mono text-xl font-bold"
            style={{
              backgroundColor: `${current.color}18`,
              borderColor: `${current.color}55`,
              color: current.color,
            }}
          >
            {current.symbol}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">当前等级</p>
            <h3 className="mt-1 truncate text-xl font-semibold text-slate-950 dark:text-slate-50">
              {current.name}
              <span className="ml-2 font-mono text-sm text-slate-400">{current.emoji}</span>
            </h3>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="font-mono text-2xl font-semibold text-slate-950 dark:text-slate-50">
            {formatTokens(level.totalTokens)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">累计总 token</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{next ? `距 ${next.name}` : "已到达最高等级"}</span>
          <span className="font-mono">{next ? `${progressPercent}%` : "MAX"}</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100 shadow-inner dark:bg-slate-900">
          <div
            className="h-full rounded-full"
            style={{
              backgroundColor: current.color,
              width: `${Math.max(next ? 4 : 100, progressPercent)}%`,
            }}
          />
        </div>
        <p className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">
          {next && level.tokensToNext !== null
            ? `还差 ${formatTokens(level.tokensToNext)} token 升级`
            : "超新星已点亮，继续刷新个人纪录"}
        </p>
      </div>
    </section>
  );
}

function AccountBadgeWall({ badges }: { badges: TokenAccountUsageProfile["badges"] }) {
  const achievedCount = badges.filter((badge) => badge.achieved).length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">徽章墙</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {formatNumber(achievedCount)} / {formatNumber(badges.length)} 已达成
          </p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-mono text-xs font-semibold text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300">
          Honor
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {badges.map((badge) => (
          <div
            key={badge.id}
            className={`rounded-lg border p-3 transition ${
              badge.achieved
                ? "border-blue-200 bg-blue-50 text-blue-950 shadow-sm dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-100"
                : "border-slate-200 bg-slate-50 text-slate-500 grayscale dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-bold ${
                  badge.achieved
                    ? "border-blue-200 bg-white text-blue-700 dark:border-blue-900/70 dark:bg-slate-950 dark:text-blue-300"
                    : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950"
                }`}
              >
                {badge.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={badge.name}>
                  {badge.name}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5" title={badge.achieved ? badge.description : badge.condition}>
                  {badge.achieved ? badge.description : badge.condition}
                </p>
              </div>
            </div>
            <p className="mt-2 truncate font-mono text-[11px]">
              {badge.achieved ? `达成 ${formatAchievementDate(badge.achievedAt)}` : "未达成"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountPersonalBestCards({
  personalBests,
}: {
  personalBests: TokenAccountUsageProfile["personalBests"];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">个人纪录</h3>
        {personalBests.brokeDailyPbToday ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-mono text-xs font-semibold text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300">
            今日破纪录
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <PersonalBestCard
          highlighted={personalBests.brokeDailyPbToday}
          label="单日最高"
          meta={formatDayLabel(personalBests.singleDay.date)}
          value={formatTokens(personalBests.singleDay.tokens)}
        />
        <PersonalBestCard
          label="7 天滚动最高"
          meta={formatDateRange(personalBests.rolling7Day.startDate, personalBests.rolling7Day.endDate)}
          value={formatTokens(personalBests.rolling7Day.tokens)}
        />
        <PersonalBestCard
          label="最长连续活跃"
          meta={formatDateRange(personalBests.longestStreak.startDate, personalBests.longestStreak.endDate)}
          value={`${formatNumber(personalBests.longestStreak.days)}d`}
        />
      </div>
    </section>
  );
}

function PersonalBestCard({
  highlighted = false,
  label,
  meta,
  value,
}: {
  highlighted?: boolean;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <div
      className={`min-h-28 rounded-lg border p-3 ${
        highlighted
          ? "border-amber-300 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-100"
      }`}
    >
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-3 truncate font-mono text-2xl font-semibold" title={value}>
        {value}
      </p>
      <p className="mt-3 truncate text-xs text-slate-500 dark:text-slate-400" title={meta}>
        {meta}
      </p>
    </div>
  );
}

function formatAchievementDate(value: string | null) {
  if (!value) {
    return "--";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDayLabel(value);
  }

  return formatShortDate(value);
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "--";
  }

  const start = formatDayLabel(startDate);
  const end = formatDayLabel(endDate);

  return start === end ? start : `${start} - ${end}`;
}

function formatDayLabel(value: string | null) {
  if (!value) {
    return "--";
  }

  const [, month, day] = value.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : value;
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
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">当前用户配置</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            只同步 Codex 配置白名单，不上传项目路径、hook、MCP 或通知命令。
          </p>
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-500">
          {config ? `配置同步 ${formatShortDate(config.updatedAt)}` : "等待 agent 同步"}
        </span>
      </div>

      {config ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="min-h-24 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">{item.label}</p>
              <p className="mt-2 truncate font-mono text-xl font-semibold text-slate-950" title={item.value}>
                {item.value}
              </p>
              <p className="mt-2 truncate text-xs text-slate-500" title={item.meta}>
                {item.meta}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          旧版本 agent 还没有同步配置；重新运行安装命令或等下一次新版 agent 上报后会显示。
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
          agent {config?.agent?.version || "--"}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
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
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function AccountLoadingState() {
  return (
    <div className="space-y-5 px-5 py-5 sm:px-6" role="status" aria-label="正在加载个人消耗">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="min-h-28 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-12" />
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
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    gold: "border-amber-200 bg-amber-50 text-amber-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    ink: "border-slate-200 bg-slate-50 text-slate-950",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
  };

  return (
    <div
      className={`group/stat relative min-h-28 rounded-lg border p-4 outline-none transition duration-150 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm focus-visible:-translate-y-0.5 focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-100 ${tones[tone]}`}
      tabIndex={tooltip ? 0 : undefined}
      aria-describedby={tooltip ? tooltipId : undefined}
    >
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-3 truncate font-mono text-2xl font-semibold leading-none" title={value}>
        {value}
      </p>
      <p className="mt-3 truncate text-xs text-slate-500" title={meta}>
        {meta}
      </p>
      {tooltip ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute inset-x-3 bottom-[calc(100%-0.35rem)] z-40 rounded-lg border border-slate-200 bg-white p-3 text-left text-slate-950 opacity-0 shadow-lg backdrop-blur-xl transition duration-150 group-hover/stat:translate-y-[-0.25rem] group-hover/stat:opacity-100 group-focus-visible/stat:translate-y-[-0.25rem] group-focus-visible/stat:opacity-100"
        >
          <p className="font-mono text-[10px] font-semibold uppercase text-blue-600">{tooltip.title}</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-600">{tooltip.description}</p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-4 text-slate-700">
            {tooltip.formula}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">{tooltip.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

function AccountDailyTrend({ daily }: { daily: TokenAccountUsageProfile["daily"] }) {
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">每日趋势</h3>
        <span className="font-mono text-xs text-slate-500">峰值 {formatTokens(maxTokens)}</span>
      </div>
      <div className="mt-4 grid h-64 grid-cols-[repeat(auto-fit,minmax(5px,1fr))] items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 pb-3 pt-5">
        {daily.map((point, index) => (
          <AccountDailyTrendBar key={point.date} dailyLength={daily.length} index={index} maxTokens={maxTokens} point={point} />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs text-slate-500">
        <span>{daily[0]?.date.slice(5) ?? "--"}</span>
        <span>{daily.at(-1)?.date.slice(5) ?? "--"}</span>
      </div>
    </section>
  );
}

function AccountDailyTrendBar({
  dailyLength,
  index,
  maxTokens,
  point,
}: {
  dailyLength: number;
  index: number;
  maxTokens: number;
  point: TokenAccountUsageProfile["daily"][number];
}) {
  const safeMaxTokens = Math.max(1, maxTokens);
  const isLatest = index === dailyLength - 1;
  const exactTokens = `${formatNumber(point.tokens)} tokens`;
  const utcRange = formatUtcRange(point.startAt, point.endAt);
  const exactLabel = `${point.date} ${exactTokens} ${utcRange}`;
  const tooltipId = `account-daily-trend-${point.date}`;
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
        className="group/account-trend relative flex h-full w-full cursor-crosshair appearance-none items-end border-0 bg-transparent px-0 pb-0 pt-20 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-blue-600/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
      >
        <span
          aria-hidden="true"
          className={`block w-full rounded-t-[3px] transition duration-200 group-hover/account-trend:translate-y-[-2px] group-focus-visible/account-trend:translate-y-[-2px] ${
            isLatest
              ? "bg-amber-500 group-hover/account-trend:bg-amber-400 group-focus-visible/account-trend:bg-amber-400"
              : "bg-blue-600 group-hover/account-trend:bg-blue-500 group-focus-visible/account-trend:bg-blue-500"
          }`}
          style={{ height: `${Math.max(2, (point.tokens / safeMaxTokens) * 100)}%` }}
        />
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute top-2 z-30 min-w-[9rem] max-w-[16rem] rounded-lg border border-blue-600/18 bg-white/98 px-3 py-2 text-slate-950 opacity-0 shadow-sm backdrop-blur transition duration-150 group-hover/account-trend:translate-y-[-0.2rem] group-hover/account-trend:opacity-100 group-focus-visible/account-trend:translate-y-[-0.2rem] group-focus-visible/account-trend:opacity-100 ${tooltipAlignClass}`}
        >
          <span className="block font-mono text-[10px] font-semibold text-blue-600">{point.date}</span>
          <span className="mt-1 block truncate font-mono text-sm font-semibold leading-none">{formatTokens(point.tokens)}</span>
          <span className="mt-1 block truncate font-mono text-[10px] text-slate-500" title={exactTokens}>
            {exactTokens}
          </span>
          <span className="mt-1 block whitespace-normal font-mono text-[10px] leading-4 text-slate-500" title={utcRange}>
            {utcRange}
          </span>
          <span
            aria-hidden="true"
            className={`absolute top-full size-2 rotate-45 border-b border-r border-blue-600/18 bg-white ${tooltipArrowClass}`}
          />
        </span>
      </button>
    </div>
  );
}

function AccountHeatmap({ heatmap }: { heatmap: TokenAccountUsageProfile["heatmap"] }) {
  const maxTokens = Math.max(1, ...heatmap.map((cell) => cell.tokens));
  const cells = new Map(heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">分时活跃</h3>
        <span className="font-mono text-xs text-slate-500">少 → 多</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[38rem]">
          <div
            className="grid gap-1 text-[10px] text-slate-500"
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
                      className="h-4 rounded-[4px] border border-white/70"
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
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="font-mono text-xs text-slate-500">{meta}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 8).map((item) => (
            <div key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate font-medium text-slate-800">{item.name}</p>
                <p className="shrink-0 font-mono text-slate-500">{formatTokens(item.value)}</p>
              </div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_4.25rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, item.share * 100)}%`, backgroundColor: barColor }}
                  />
                </div>
                <p className="truncate text-right text-xs text-slate-500">{item.meta}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">暂无数据</p>
        )}
      </div>
    </section>
  );
}

function AccountProjectList({ projects }: { projects: TokenAccountUsageProfile["projects"] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">项目分布</h3>
        <span className="font-mono text-xs text-slate-500">{projects.length} 个项目</span>
      </div>
      <div className="mt-4 space-y-3">
        {projects.length ? (
          projects.slice(0, 8).map((project) => (
            <div key={project.name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{project.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatNumber(project.activeDays)}d · {formatNumber(project.models)} models
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-semibold text-blue-700" title={formatTokens(project.tokens)}>
                    {formatTokens(project.tokens)}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${Math.max(2, project.share * 100)}%` }}
                  />
                </div>
                <p className="text-right font-mono text-xs text-slate-500">{formatUsd(project.costUsd)}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">暂无数据</p>
        )}
      </div>
    </section>
  );
}

export function AccountSessionList({ sessions }: { sessions: TokenAccountUsageProfile["sessions"] }) {
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_INITIAL_VISIBLE_COUNT);
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => b.tokens - a.tokens), [sessions]);
  const visibleSessions = sortedSessions.slice(0, visibleSessionCount);
  const hiddenSessionCount = Math.max(0, sortedSessions.length - visibleSessions.length);
  const maxTokens = Math.max(1, ...sortedSessions.map((session) => session.tokens));

  useEffect(() => {
    setVisibleSessionCount(SESSION_INITIAL_VISIBLE_COUNT);
  }, [sessions]);

  function showMoreSessions() {
    setVisibleSessionCount((count) => Math.min(count + SESSION_VISIBLE_COUNT_STEP, sortedSessions.length));
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Session 明细</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">按 session 聚合，优先展示本地提取的短标题，并标注项目归属</p>
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-500">
          {formatNumber(visibleSessions.length)} / {formatNumber(sortedSessions.length)} sessions · 按 token 降序
        </span>
      </div>

      {sortedSessions.length ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[58rem] table-fixed border-separate border-spacing-0 text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="w-[16rem] border-b border-slate-200 px-3 py-2 font-semibold">Session</th>
                  <th className="w-[10rem] border-b border-slate-200 px-3 py-2 text-right font-semibold" aria-sort="descending">
                    总 token ↓
                  </th>
                  <th className="w-[12rem] border-b border-slate-200 px-3 py-2 font-semibold">模型</th>
                  <th className="w-[10rem] border-b border-slate-200 px-3 py-2 font-semibold">工具</th>
                  <th className="w-[11rem] border-b border-slate-200 px-3 py-2 font-semibold">项目</th>
                  <th className="w-[9rem] border-b border-slate-200 px-3 py-2 font-semibold">开始时间</th>
                  <th className="w-[9rem] border-b border-slate-200 px-3 py-2 font-semibold">结束时间</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((session) => {
                  const hasTitle = Boolean(session.title);
                  const title = session.title || formatSessionLabel(session.id);

                  return (
                    <tr key={session.id} className="group">
                      <td className="border-b border-slate-100 px-3 py-3 align-top">
                        <div className="group/title relative flex min-w-0 items-center gap-2">
                          <p
                            className={`min-w-0 truncate text-sm font-semibold ${hasTitle ? "text-slate-900" : "font-mono text-xs text-blue-700"}`}
                          >
                            {title}
                          </p>
                          <span
                            className="max-w-[7rem] shrink-0 truncate rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                            title={`项目：${session.project || "unknown"}`}
                          >
                            {session.project || "unknown"}
                          </span>
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-0 top-full z-30 mt-1 max-w-[24rem] whitespace-normal break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 opacity-0 shadow-lg transition duration-150 group-hover/title:opacity-100 group-focus-within/title:opacity-100"
                          >
                            {hasTitle ? session.title : session.id}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatNumber(session.records)} records · {formatUsd(session.costUsd)}
                          {hasTitle ? ` · ${formatSessionLabel(session.id)}` : ""}
                        </p>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right align-top">
                        <p
                          className="font-mono text-base font-semibold text-blue-700"
                          title={`input ${formatTokens(session.inputTokens)} · cache read ${formatTokens(session.cachedInputTokens)} · cache write ${formatTokens(session.cacheCreationInputTokens)} · output ${formatTokens(session.outputTokens)}`}
                        >
                          {formatTokens(session.tokens)}
                        </p>
                        <p
                          className="mt-1 truncate text-xs text-slate-500"
                          title={`cache read ${formatTokens(session.cachedInputTokens)} · cache write ${formatTokens(session.cacheCreationInputTokens)}`}
                        >
                          读 {formatTokens(session.cachedInputTokens)} · 写 {formatTokens(session.cacheCreationInputTokens)}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${Math.max(2, (session.tokens / maxTokens) * 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 align-top">
                        <SessionDimension value={session.model} count={session.models} label="models" />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 align-top">
                        <SessionDimension value={session.tool} count={session.tools} label="tools" />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 align-top">
                        <SessionDimension value={session.project} count={session.projects} label="projects" />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 align-top font-mono text-xs text-slate-500" title={session.startAt}>
                        {formatShortDate(session.startAt)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 align-top font-mono text-xs text-slate-500" title={session.endAt}>
                        {formatShortDate(session.endAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hiddenSessionCount > 0 ? (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row">
              <p className="text-xs text-slate-500">
                已展示 {formatNumber(visibleSessions.length)} 条，还有 {formatNumber(hiddenSessionCount)} 条
              </p>
              <button
                type="button"
                onClick={showMoreSessions}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-600 sm:w-auto"
              >
                查看更多
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">暂无 session 数据</p>
      )}
    </section>
  );
}

function SessionDimension({ count, label, value }: { count: number; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-slate-800" title={value}>
        {value || "unknown"}
      </p>
      {count > 1 ? <p className="mt-1 text-xs text-slate-500">+{formatNumber(count - 1)} {label}</p> : null}
    </div>
  );
}
