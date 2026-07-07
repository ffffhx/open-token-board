"use client";

import { useId, useState, type ReactNode } from "react";

import {
  getTokenConsumptionTokens,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
} from "@open-token-board/core";

import { METRICS, ROLLING_RANGE_LABELS } from "./constants";
import type { ViewerState } from "./types";
import { Avatar, Icon, Skeleton } from "./shared-ui";
import {
  buildLeaderboardInsight,
  formatMetricValue,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
  formatSignedPercent,
  formatTokens,
  formatUtcRange,
  formatUsd,
  getUserMetricValue,
  latestReportedAt,
  normalizeDailyUsageSeries,
  sanitizeSvgId,
} from "./utils";

export function InsightStrip({ loading, text }: { loading: boolean; text: string }) {
  return (
    <section className="rounded-lg border border-stone-950/10 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="w-fit rounded-full bg-slate-950 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-white">
          自动洞察
        </span>
        <p className="min-w-0 flex-1 text-sm leading-6 text-stone-700">
          {loading ? <Skeleton className="h-4 w-full max-w-md align-middle" /> : text}
        </p>
      </div>
    </section>
  );
}

export function TrustEvidenceBar({
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
  const dataAsOf = latestReportedAt(summary);
  const evidence: string[] = error
    ? [`读取失败：${error}`, "可重试或检查 agent 上报", "不展示伪数据"]
    : [
        dataAsOf ? `数据截至 ${formatShortDate(dataAsOf)}` : "区间内暂无上报数据",
        `数据源 ${sourceLabel}`,
        `全库/可用 ${formatNumber(recordCount)}`,
        `当前${range} ${formatNumber(rangeRecordCount)}`,
        `活跃用户 ${formatNumber(summary.activeUsers)}`,
        `${ROLLING_RANGE_LABELS[range]} · Asia/Shanghai`,
      ];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        {loading
          ? ["w-24", "w-20", "w-28", "w-24", "w-16", "w-32"].map((width, index) => (
              <Skeleton key={index} className={`h-[26px] rounded-full ${width}`} />
            ))
          : evidence.map((label) => (
              <span key={label} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-600">
                {label}
              </span>
            ))}
      </div>
      <p className="mt-2 hidden text-xs leading-5 text-slate-500 sm:block">
        {apiBaseUrl ? "本页只读取自动上报服务。" : "Token Board API 未配置，页面不会回退到静态或本地数据。"}
        只展示 token、模型、工具、项目 basename 与会话短标题；费用为公开模型单价估算，不代表实际账单。
      </p>
    </div>
  );
}

export function EfficiencyStrip({
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
    <section className="grid gap-2 rounded-lg border border-stone-950/10 bg-white p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-stone-950/8 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-stone-500">{item.label}</p>
          <p className="mt-2 font-mono text-xl font-semibold text-stone-950">
            {loading ? <Skeleton className="h-6 w-20" /> : item.value}
          </p>
          <p className="mt-1 truncate text-xs text-stone-500">
            {loading ? <Skeleton className="h-3 w-16" /> : item.meta}
          </p>
        </div>
      ))}
    </section>
  );
}

export function SegmentedControl({
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
      className="grid w-full rounded-lg border border-slate-200 bg-slate-100 p-1"
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
              ? "bg-white text-slate-950 shadow-sm"
              : item.disabled
                ? "cursor-not-allowed text-slate-400"
                : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({
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
    ink: "border-slate-950 bg-slate-950 text-white",
    mint: "border-blue-600/20 bg-blue-50 text-blue-900",
    blue: "border-sky-600/18 bg-sky-50 text-sky-900",
    gold: "border-amber-600/18 bg-amber-50 text-amber-900",
  };

  return (
    <div className={`min-h-32 rounded-lg border p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase opacity-65">{label}</p>
        <span className="mt-0.5 size-2 rounded-full bg-current opacity-55" />
      </div>
      <p className="mt-5 font-mono text-3xl font-semibold leading-none sm:text-4xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-3 truncate text-xs opacity-60" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
    </div>
  );
}

export function HeroSignal({ label, value, meta }: { label: string; value: ReactNode; meta: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="truncate text-[11px] font-semibold uppercase text-slate-500 sm:text-xs">{label}</p>
      <p className="mt-2 truncate text-base font-semibold text-slate-950 sm:text-xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-blue-600 sm:text-xs" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
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
  const utcRange = formatUtcRange(point.startAt, point.endAt);
  const exactLabel = `${point.date} ${exactTokens} ${utcRange}`;
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
        className="group/trend relative flex h-full w-full cursor-crosshair appearance-none items-end rounded-t-[3px] border-0 bg-transparent px-0 pb-0 pt-20 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-blue-600/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        data-token-trend-point={point.date}
      >
        <span
          aria-hidden="true"
          className={`block w-full rounded-t-[3px] transition duration-200 group-hover/trend:translate-y-[-2px] group-focus-visible/trend:translate-y-[-2px] ${
            isLatest
              ? "bg-red-600 group-hover/trend:bg-red-500 group-focus-visible/trend:bg-red-500"
              : "bg-blue-600 group-hover/trend:bg-blue-600 group-focus-visible/trend:bg-blue-600"
          }`}
          style={{ height: barHeight }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2 border-l border-dashed border-blue-600/45 opacity-0 transition group-hover/trend:opacity-100 group-focus-visible/trend:opacity-100"
          style={{ height: barHeight }}
        />
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute top-2 z-30 min-w-[9rem] max-w-[16rem] rounded-lg border border-blue-600/18 bg-white/98 px-3 py-2 text-stone-950 opacity-0 shadow-sm backdrop-blur transition duration-150 group-hover/trend:translate-y-[-0.2rem] group-hover/trend:opacity-100 group-focus-visible/trend:translate-y-[-0.2rem] group-focus-visible/trend:opacity-100 ${tooltipAlignClass}`}
          data-token-trend-tooltip-placement="top-rail"
          data-token-trend-tooltip={point.date}
        >
          <span className="block font-mono text-[10px] font-semibold text-blue-600">{point.date}</span>
          <span className="mt-1 block truncate font-mono text-sm font-semibold leading-none">{formatTokens(point.tokens)}</span>
          <span className="mt-1 block truncate font-mono text-[10px] text-stone-500" title={exactTokens}>
            {exactTokens}
          </span>
          <span className="mt-1 block whitespace-normal font-mono text-[10px] leading-4 text-stone-500" title={utcRange}>
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

export function PanelHeader({ title, meta, action }: { title: string; meta: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-stone-950/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 font-mono text-xs text-stone-500">{meta}</p>
      </div>
      <span className="w-fit rounded-full border border-stone-950/10 bg-slate-50 px-3 py-1 font-mono text-xs text-stone-600">
        {action}
      </span>
    </div>
  );
}

export function SortableColumnHeader({
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
            ? "bg-slate-950 text-white"
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

export function LeaderboardMobileCard({
  metric,
  range,
  showDailyTrend,
  user,
}: {
  metric: TokenBoardMetric;
  range: TokenBoardRange;
  showDailyTrend: boolean;
  user: TokenLeaderboardUser;
}) {
  const metricLabel = METRICS.find((item) => item.key === metric)?.label ?? "总消耗";
  const metricValue = formatMetricValue(getUserMetricValue(user, metric), metric);
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);
  const cacheBreakdownTitle = `input ${formatTokens(user.inputTokens)} · cache read ${formatTokens(user.cachedInputTokens)} · cache write ${formatTokens(user.cacheCreationInputTokens)} · output ${formatTokens(user.outputTokens)}`;

  return (
    <article className="rounded-lg border border-stone-950/10 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full border border-amber-600/25 bg-amber-50 px-2.5 py-1 font-mono text-xs font-semibold text-amber-900">
            #{user.rank}
          </span>
          <RankDeltaBadge previousRank={user.previousRank} rankDelta={user.rankDelta} />
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <LevelSymbol level={user.level} />
              <p className="truncate font-semibold text-stone-950">{user.displayName}</p>
            </div>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold text-stone-950">{metricValue}</p>
          <p className="text-xs text-stone-500">{metricLabel} ↓</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-stone-950/8 bg-slate-50 p-2 text-xs">
        <MetricMini label="总消耗" value={formatTokens(consumptionTokens)} />
        <MetricMini label="费用" value={formatUsd(user.costUsd)} />
        <MetricMini label="会话" value={formatNumber(user.sessions)} />
      </div>
      <p className="mt-2 truncate text-xs text-stone-500" title={cacheBreakdownTitle}>
        读缓存 {formatTokens(user.cachedInputTokens)} · 写缓存 {formatTokens(user.cacheCreationInputTokens)}
      </p>
      {showDailyTrend ? (
        <div className="mt-3 rounded-lg border border-stone-950/8 bg-white px-3 py-2">
          <DailyUsageSparkline
            daily={daily}
            label={`${user.displayName} 用量趋势`}
            metaClassName="text-stone-500"
            range={range}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded-md border border-stone-950/10 bg-slate-50 px-2 py-1 font-semibold text-stone-700">
          {user.topModel}
        </span>
        <span>{formatNumber(user.records)} records</span>
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
  range,
}: {
  daily: TokenLeaderboardUser["daily"];
  fixedWidth?: boolean;
  label: string;
  metaClassName?: string;
  range: TokenBoardRange;
}) {
  const gradientId = sanitizeSvgId(useId());
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const normalizedDaily = normalizeDailyUsageSeries(daily);
  const trend = buildSparklineTrend(normalizedDaily, range);
  const trendPoints = trend.points;
  const width = 160;
  const height = 46;
  const paddingX = 4;
  const paddingY = 5;
  const maxTokens = Math.max(1, ...trendPoints.map((point) => point.tokens));
  const totalTokens = trendPoints.reduce((sum, point) => sum + point.tokens, 0);
  const peak = trendPoints.reduce(
    (best, point) => (point.tokens > best.tokens ? point : best),
    { date: "", endDate: "", label: "", startDate: "", tokens: 0 }
  );
  const points = trendPoints.map((point, index) => {
    const x =
      trendPoints.length <= 1
        ? width / 2
        : paddingX + (index * (width - paddingX * 2)) / (trendPoints.length - 1);
    const y = height - paddingY - (point.tokens / maxTokens) * (height - paddingY * 2);

    return { ...point, x, y };
  });
  const activePoint = hoveredPointIndex === null ? null : points[hoveredPointIndex] ?? null;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = points.length
    ? `${path} L ${points.at(-1)?.x.toFixed(2)} ${height - paddingY} L ${points[0].x.toFixed(2)} ${height - paddingY} Z`
    : "";
  const firstDate = trendPoints[0]?.startDate.slice(5) ?? "--";
  const lastDate = trendPoints.at(-1)?.endDate.slice(5) ?? "--";
  const title = peak.date
    ? `${label}：${firstDate} - ${lastDate}，${trend.unitLabel}峰值 ${peak.label} ${formatTokens(peak.tokens)}，合计 ${formatTokens(totalTokens)}`
    : `${label}：暂无每日用量`;
  const activeSummary = activePoint
    ? `${activePoint.label} ${formatTokens(activePoint.tokens)}`
    : `峰值 ${formatTokens(peak.tokens)}`;
  const exactActiveLabel = activePoint ? `${formatNumber(activePoint.tokens)} tokens` : "";

  return (
    <div aria-label={title} className={`min-w-0 ${fixedWidth ? "w-[16rem] min-w-[16rem] max-w-[16rem]" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`truncate text-[11px] font-semibold ${metaClassName}`}>{trend.unitLabel}</p>
        <p className={`min-w-0 max-w-[9rem] truncate text-right font-mono text-[11px] ${metaClassName}`} title={activeSummary}>
          {activeSummary}
        </p>
      </div>
      <div
        className={`mt-1 h-12 overflow-hidden rounded-lg border px-2.5 py-1.5 transition-colors ${
          activePoint
            ? "border-blue-600/25 bg-white shadow-sm"
            : "border-transparent bg-transparent"
        }`}
        role={activePoint ? "tooltip" : undefined}
      >
        {activePoint ? (
          <>
            <p className="font-mono text-[10px] font-semibold text-blue-600">{activePoint.label}</p>
            <p className="mt-0.5 truncate whitespace-nowrap font-mono text-xs font-semibold text-stone-950" title={exactActiveLabel}>
              {exactActiveLabel}
            </p>
          </>
        ) : (
          <span className="sr-only">悬停用量折线查看具体用量</span>
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
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} stroke="#cbd5e1" strokeWidth="1" />
          {areaPath ? (
            <path d={areaPath} fill={`url(#${gradientId})`} />
          ) : null}
          {path ? (
            <path
              d={path}
              fill="none"
              stroke="#2563eb"
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
              stroke="#2563eb"
              strokeDasharray="3 3"
              strokeOpacity="0.5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {points.map((point, index) => {
            const left = index === 0 ? 0 : (points[index - 1].x + point.x) / 2;
            const right = index === points.length - 1 ? width : (point.x + points[index + 1].x) / 2;
            const exactLabel = `${point.label} ${formatNumber(point.tokens)} tokens`;

            return (
              <rect
                key={`${point.startDate}:${point.endDate}:hit`}
                aria-label={exactLabel}
                className="cursor-crosshair outline-none"
                data-daily-usage-point={point.label}
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
            const dotFill = isHovered ? "bg-blue-600" : isLatest ? "bg-red-600" : "bg-white";

            return (
              <span
                key={`${point.startDate}:${point.endDate}:dot`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-600 ${dotSize} ${dotFill}`}
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

type SparklineTrendPoint = {
  date: string;
  endDate: string;
  label: string;
  startDate: string;
  tokens: number;
};

function buildSparklineTrend(daily: TokenLeaderboardUser["daily"], range: TokenBoardRange) {
  const bucketSize = range === "90D" ? 7 : range === "30D" ? 3 : 1;
  const unitLabel = bucketSize === 7 ? "周汇总" : bucketSize === 3 ? "3日汇总" : "每日用量";

  if (bucketSize === 1) {
    return {
      points: daily.map((point) => ({
        ...point,
        endDate: point.date,
        label: point.date.slice(5),
        startDate: point.date,
      })),
      unitLabel,
    };
  }

  const points: SparklineTrendPoint[] = [];
  for (let index = 0; index < daily.length; index += bucketSize) {
    const bucket = daily.slice(index, index + bucketSize);
    const startDate = bucket[0]?.date ?? "";
    const endDate = bucket.at(-1)?.date ?? startDate;
    const tokens = bucket.reduce((sum, point) => sum + point.tokens, 0);

    points.push({
      date: endDate,
      endDate,
      label: formatSparklineBucketLabel(startDate, endDate),
      startDate,
      tokens,
    });
  }

  return { points, unitLabel };
}

function formatSparklineBucketLabel(startDate: string, endDate: string) {
  const startLabel = startDate.slice(5);
  const endLabel = endDate.slice(5);

  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`;
}

export function LeaderboardRow({ range, showDailyTrend, user }: { range: TokenBoardRange; showDailyTrend: boolean; user: TokenLeaderboardUser }) {
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);
  const cacheBreakdownTitle = `input ${formatTokens(user.inputTokens)} · cache read ${formatTokens(user.cachedInputTokens)} · cache write ${formatTokens(user.cacheCreationInputTokens)} · output ${formatTokens(user.outputTokens)}`;
  const rankTone =
    user.rank === 1
      ? "border-amber-600/30 bg-amber-50 text-amber-900"
      : user.rank === 2
        ? "border-sky-600/20 bg-sky-50 text-sky-900"
        : user.rank === 3
          ? "border-blue-600/20 bg-blue-50 text-blue-900"
          : "border-stone-950/10 bg-white text-stone-500";

  return (
    <tr className="transition hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <span className={`inline-flex min-w-10 justify-center rounded-full border px-2 py-1 font-mono text-xs font-semibold ${rankTone}`}>
            #{user.rank}
          </span>
          <RankDeltaBadge previousRank={user.previousRank} rankDelta={user.rankDelta} />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <LevelSymbol level={user.level} />
              <p className="truncate font-semibold text-stone-950">{user.displayName}</p>
            </div>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </div>
      </td>
      {showDailyTrend ? (
        <td className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">
          <DailyUsageSparkline fixedWidth daily={daily} label={`${user.displayName} 用量趋势`} range={range} />
        </td>
      ) : null}
      <td className="px-4 py-3 text-right font-mono font-semibold text-stone-950" title={cacheBreakdownTitle}>
        {formatTokens(consumptionTokens)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatUsd(user.costUsd)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(user.sessions)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-stone-950/10 bg-slate-50 px-2 py-1 text-xs font-semibold text-stone-700">
            {user.topModel}
          </span>
          {user.deltaTokens !== null ? (
            <span
              className={`font-mono text-xs font-semibold ${user.deltaTokens >= 0 ? "text-blue-600" : "text-red-600"}`}
              title="较上一周期 Token 变化"
            >
              {formatSignedPercent(user.deltaTokens)}
            </span>
          ) : null}
          {user.lastReportedAt ? (
            <span className="text-xs text-stone-400" title={`最近上报：${formatShortDate(user.lastReportedAt)}`}>
              {formatNumber(user.records)} records
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function LevelSymbol({ level }: { level: TokenLeaderboardUser["level"] }) {
  const current = level.current;

  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold leading-none dark:bg-slate-950/30"
      style={{
        backgroundColor: `${current.color}18`,
        borderColor: `${current.color}55`,
        color: current.color,
      }}
      title={`${current.name} · 累计等级`}
    >
      {current.symbol}
    </span>
  );
}

function RankDeltaBadge({
  previousRank,
  rankDelta,
}: {
  previousRank: number | null;
  rankDelta: number | null;
}) {
  if (previousRank === null) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        新上榜
      </span>
    );
  }

  if (!rankDelta) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
        持平
      </span>
    );
  }

  const isUp = rankDelta > 0;

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
        isUp
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
      }`}
      title={`上一周期 #${previousRank}`}
    >
      {isUp ? "↑" : "↓"}
      {formatNumber(Math.abs(rankDelta))}
    </span>
  );
}

export function MobileLeaderboardLoading({ slow }: { slow: boolean }) {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-lg border border-stone-950/10 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      ))}
      {slow ? (
        <p className="text-center text-xs text-stone-500">数据加载较慢，可以点击刷新榜单，或确认本机 agent 是否已完成上报。</p>
      ) : null}
    </>
  );
}

export function LeaderboardLoadingRow({ columnCount, slow }: { columnCount: number; slow: boolean }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index}>
          <td colSpan={columnCount} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="hidden h-4 w-14 sm:block" />
              <Skeleton className="hidden h-4 w-12 sm:block" />
            </div>
          </td>
        </tr>
      ))}
      {slow ? (
        <tr>
          <td colSpan={columnCount} className="px-4 pb-3 pt-1 text-center text-xs text-stone-500">
            数据加载较慢，可稍后重试、刷新榜单，或确认本机 agent 是否已完成上报。
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function LeaderboardErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-600/20 bg-red-50 p-5 text-center">
      <p className="font-semibold text-red-900">真实用户数据读取失败</p>
      <p className="mt-1 text-xs text-red-900/72">{error || "请稍后再试"}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-blue-600"
      >
        <Icon name="refresh" />
        重试
      </button>
    </div>
  );
}

export function LeaderboardErrorRow({ columnCount, error, onRetry }: { columnCount: number; error: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-10">
        <LeaderboardErrorState error={error} onRetry={onRetry} />
      </td>
    </tr>
  );
}

export function LeaderboardEmptyState() {
  return (
    <div className="rounded-lg border border-stone-950/8 bg-slate-50 px-4 py-8 text-center text-sm text-stone-500">
      暂无真实用户数据，可以切换时间范围或运行 agent 上报本机记录。
    </div>
  );
}

export function LeaderboardEmptyRow({ columnCount }: { columnCount: number }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-10 text-center text-sm text-stone-500">
        暂无真实用户数据
      </td>
    </tr>
  );
}

export function ShareRow({ metric, total, user }: { metric: TokenBoardMetric; total: number; user: TokenLeaderboardUser }) {
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
            className="h-full rounded-full bg-blue-600"
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
      </div>
      <p className="text-right font-mono text-sm font-semibold">{formatMetricValue(value, metric)}</p>
    </div>
  );
}

export function ShareLoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)_5rem] items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </>
  );
}

const TREND_SKELETON_HEIGHTS = ["35%", "55%", "42%", "68%", "50%", "78%", "60%", "88%", "46%", "72%", "58%", "94%"];

function TrendLoadingBars() {
  return (
    <>
      {TREND_SKELETON_HEIGHTS.map((height, index) => (
        <div key={index} className="flex h-full min-w-0 items-end">
          <span
            aria-hidden="true"
            className="block w-full rounded-t-[3px] bg-slate-200/80 motion-safe:animate-pulse"
            style={{ height }}
          />
        </div>
      ))}
    </>
  );
}

export function EmptyPanelMessage() {
  return <p className="rounded-lg border border-stone-950/8 bg-white/60 px-3 py-4 text-center text-sm text-stone-500">暂无真实数据</p>;
}

export function BreakdownPanel({
  title,
  items,
  loading = false,
}: {
  title: string;
  items: Array<{ name: string; value: number; meta: string; share: number }>;
  loading?: boolean;
}) {
  return (
    <section className="rounded-lg border border-stone-950/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="font-mono text-xs text-stone-500">
          {loading ? <Skeleton className="h-3 w-6 align-middle" /> : items.length}
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
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, item.share * 100)}%` }} />
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
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3">
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="ml-auto h-2 w-10" />
          </div>
        </div>
      ))}
    </>
  );
}

export function GitHubAuthControl({
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
        <span className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 xl:flex-none">
          <Icon name="github" />
          <span className="truncate">@{viewer.user?.githubLogin || viewer.user?.displayName || "GitHub"}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100"
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
