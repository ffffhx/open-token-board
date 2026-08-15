"use client";

import Link from "next/link";
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import {
  getTokenConsumptionTokens,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
  type TokenTrendBreakdown,
  type TokenTrendMetricValues,
  type TokenTrendSegment,
} from "@open-token-board/core";

import { profileHrefForUser } from "@/components/profile/utils";
import { useI18n, type Dictionary } from "@/i18n";
import type { ViewerState } from "./types";
import { Avatar, EmptyStatePanel, Icon, Skeleton } from "./shared-ui";
import {
  formatMetricValue,
  formatLines,
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

function activateSvgControl(event: KeyboardEvent<SVGElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  action();
}

export function InsightStrip({ loading, text }: { loading: boolean; text: string }) {
  const { dict } = useI18n();

  return (
    <section className="rounded-lg border border-stone-950/10 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="otb-energy-bg w-fit rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-white">
          {dict.board.status.insightLoading}
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
  const { dict } = useI18n();
  const dataAsOf = latestReportedAt(summary);
  const evidence: string[] = error
    ? [dict.board.evidence.readFailed(error), dict.board.evidence.retryOrCheckAgent, dict.board.evidence.noFakeData]
    : [
        dataAsOf ? dict.board.evidence.dataAsOf(formatShortDate(dataAsOf)) : dict.board.evidence.noReportsInRange,
        dict.board.evidence.source(sourceLabel),
        dict.board.evidence.allRecords(formatNumber(recordCount)),
        dict.board.evidence.currentRange(range, formatNumber(rangeRecordCount)),
        dict.board.evidence.activeUsers(formatNumber(summary.activeUsers)),
        `${dict.common.ranges[range]} · Asia/Shanghai`,
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
        {apiBaseUrl ? dict.board.evidence.apiOnly : dict.board.evidence.apiMissing}
        {dict.board.evidence.privacy}
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
  const { dict } = useI18n();
  const items = [
    { label: dict.board.efficiency.dailyAverage, value: formatTokens(dailyAverageTokens), meta: dict.board.efficiency.dailyAverageMeta },
    { label: dict.board.efficiency.perSession, value: formatTokens(tokensPerSession), meta: dict.board.efficiency.perSessionMeta },
    { label: dict.board.efficiency.costPerSession, value: formatUsd(costPerSession), meta: dict.board.efficiency.costPerSessionMeta },
    { label: dict.board.efficiency.cacheHitRate, value: formatPercent(cacheHitRate), meta: dict.board.efficiency.cacheHitRateMeta },
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
  const activeIndex = items.findIndex((item) => item.key === value);

  return (
    <div
      className="relative grid w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-1 shadow-inner"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {activeIndex >= 0 ? (
        <span
          aria-hidden="true"
          className="absolute bottom-1 top-1 z-0 rounded-lg bg-slate-950 shadow-sm transition-transform"
          style={{
            left: "0.25rem",
            width: `calc((100% - 0.5rem) / ${items.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
      ) : null}
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
          className={`relative z-10 min-h-11 rounded-lg px-2 text-sm font-semibold transition ${
            value === item.key
              ? "text-white"
              : item.disabled
                ? "cursor-not-allowed text-slate-400"
                : "text-slate-600 hover:text-slate-950"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({
  active = false,
  label,
  value,
  meta,
  onClick,
  tone,
}: {
  active?: boolean;
  label: string;
  value: ReactNode;
  meta: ReactNode;
  onClick?: () => void;
  tone: "ink" | "mint" | "blue" | "gold";
}) {
  const tones = {
    ink: "border-slate-950 bg-slate-950 text-white",
    mint: "border-blue-600/20 bg-blue-50 text-blue-900",
    blue: "border-sky-600/18 bg-sky-50 text-sky-900",
    gold: "border-amber-600/18 bg-amber-50 text-amber-900",
  };
  const className = `otb-card-hover min-h-32 rounded-lg border p-4 text-left shadow-sm transition ${
    tones[tone]
  } ${active ? "ring-2 ring-blue-600/35 ring-offset-2 ring-offset-white" : ""}`;
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase opacity-65">{label}</p>
        <span className="mt-0.5 size-2 rounded-full bg-current opacity-55" />
      </div>
      <p className="otb-stat-number mt-5 font-mono text-3xl font-black leading-none sm:text-4xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-3 truncate text-xs opacity-60" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" aria-pressed={active} onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

export function HeroSignal({ label, value, meta }: { label: string; value: ReactNode; meta: ReactNode }) {
  return (
    <div className="otb-panel-muted min-w-0 rounded-lg px-3 py-3">
      <p className="truncate text-[11px] font-semibold uppercase text-slate-500 sm:text-xs">{label}</p>
      <p className="otb-stat-number font-display mt-2 truncate text-base font-bold tracking-tight text-slate-950 sm:text-xl" title={typeof value === "string" ? value : undefined}>{value}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-blue-600 sm:text-xs" title={typeof meta === "string" ? meta : undefined}>{meta}</p>
    </div>
  );
}

export function DailyTokenTrendChart({
  daily,
  loading,
  metric,
  trend,
}: {
  daily: TokenLeaderboardSummary["daily"];
  loading: boolean;
  metric: TokenBoardMetric;
  trend?: TokenTrendBreakdown;
}) {
  const { dict } = useI18n();
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const hiddenKeySet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);

  if (loading) {
    return <TrendLoadingBars />;
  }

  const trendDaily = trend?.daily ?? [];
  const hasMetricTrend = trendDaily.some((point) => getTrendMetricValue(point, metric) > 0);
  const effectiveMetric = trend && hasMetricTrend ? metric : "tokens";
  const chartPoints = trend && hasMetricTrend ? trendDaily : daily;
  const canStack =
    effectiveMetric !== "users" &&
    Boolean(trend && trend.segments.length > 1 && trendDaily.some((point) => point.segments.some((segment) => getTrendMetricValue(segment, effectiveMetric) > 0)));
  const orderedSegments = trend?.segments ?? [];
  const visibleSegments = orderedSegments.filter((segment) => !hiddenKeySet.has(segment.key));
  const visibleKeys = new Set(visibleSegments.map((segment) => segment.key));
  const width = 920;
  const height = 238;
  const paddingTop = 12;
  const paddingBottom = 22;
  const paddingX = 6;
  const innerHeight = height - paddingTop - paddingBottom;
  const gap = chartPoints.length > 45 ? 2 : chartPoints.length > 20 ? 3 : 5;
  const barWidth =
    chartPoints.length <= 0
      ? width
      : Math.max(2, (width - paddingX * 2 - gap * Math.max(0, chartPoints.length - 1)) / chartPoints.length);
  const valueForPoint = (point: (typeof chartPoints)[number]) => {
    if (!canStack || !hasTrendSegments(point)) {
      return getTrendMetricValue(point, effectiveMetric);
    }

    const stackValue = point.segments
      .filter((segment) => visibleKeys.has(segment.key))
      .reduce((sum, segment) => sum + getTrendMetricValue(segment, effectiveMetric), 0);

    return stackValue;
  };
  const maxValue = Math.max(1, ...chartPoints.map(valueForPoint));
  const hoveredPoint = hoveredPointIndex === null ? null : chartPoints[hoveredPointIndex] ?? null;
  const hoveredX =
    hoveredPointIndex === null
      ? 50
      : ((paddingX + hoveredPointIndex * (barWidth + gap) + barWidth / 2) / width) * 100;
  const hoverAlignClass =
    hoveredPointIndex === null || chartPoints.length <= 1
      ? "left-1/2 -translate-x-1/2 text-center"
      : hoveredPointIndex === 0
        ? "left-0 translate-x-0 text-left"
        : hoveredPointIndex === chartPoints.length - 1
          ? "right-0 translate-x-0 text-right"
          : "left-1/2 -translate-x-1/2 text-center";
  const metricLabel = metricTrendLabel(effectiveMetric, dict);
  const fallbackNotice = effectiveMetric !== metric ? dict.board.trend.fallbackNotice : "";

  function cycleLegendSegment(segment: TokenTrendSegment) {
    if (hiddenKeySet.has(segment.key)) {
      setHiddenKeys((keys) => keys.filter((key) => key !== segment.key));
      setFocusedKey(segment.key);
      return;
    }

    if (focusedKey !== segment.key) {
      setFocusedKey(segment.key);
      return;
    }

    setHiddenKeys((keys) => [...keys, segment.key]);
    setFocusedKey(null);
  }

  function resetLegend() {
    setFocusedKey(null);
    setHiddenKeys([]);
  }

  return (
    <div className="min-w-0">
      {canStack && orderedSegments.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {orderedSegments.map((segment) => {
            const isHidden = hiddenKeySet.has(segment.key);
            const isFocused = focusedKey === segment.key;
            const colorStyle = trendSegmentColorStyle(segment);

            return (
              <button
                key={segment.key}
                type="button"
                aria-pressed={isFocused}
                onClick={() => cycleLegendSegment(segment)}
                title={dict.board.trend.legendTitle(segment.label)}
                className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  isHidden
                    ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                    : isFocused
                      ? "border-blue-600/35 bg-blue-50 text-blue-900 shadow-sm"
                      : focusedKey
                        ? "border-stone-950/10 bg-white text-stone-500 opacity-65 hover:opacity-100"
                        : "border-stone-950/10 bg-white text-stone-700 hover:border-blue-600/25 hover:bg-blue-50"
                }`}
              >
                <span aria-hidden="true" className="token-trend-swatch size-2.5 rounded-full" style={colorStyle} />
                <span className="max-w-[9rem] truncate">{segment.label}</span>
              </button>
            );
          })}
          {(focusedKey || hiddenKeys.length) ? (
            <button
              type="button"
              onClick={resetLegend}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-semibold text-slate-500 transition hover:border-blue-600/25 hover:bg-blue-50 hover:text-blue-700"
            >
              {dict.board.trend.reset}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="relative rounded-lg border border-stone-950/8 bg-[linear-gradient(180deg,rgba(47,91,255,0.06),transparent)] px-2 pb-3 pt-4 dark:bg-[linear-gradient(180deg,rgba(96,165,250,0.08),transparent)]"
        onMouseLeave={() => setHoveredPointIndex(null)}
      >
        <svg
          aria-label={dict.board.trend.dayTrendAria(metricLabel, formatNumber(chartPoints.length), formatTrendMetricValue(maxValue, effectiveMetric, dict))}
          className="h-64 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            x1={paddingX}
            x2={width - paddingX}
            y1={height - paddingBottom}
            y2={height - paddingBottom}
            stroke="currentColor"
            strokeOpacity="0.16"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {chartPoints.map((point, index) => {
            const x = paddingX + index * (barWidth + gap);
            const stackValue = valueForPoint(point);
            const barHeight = Math.max(0, (stackValue / maxValue) * innerHeight);
            const isSelected = selectedDate === point.date;
            const isHovered = hoveredPointIndex === index;

            if (canStack && hasTrendSegments(point)) {
              let yCursor = height - paddingBottom;
              const rects = point.segments
                .filter((segment) => visibleKeys.has(segment.key))
                .map((segment) => {
                  const value = getTrendMetricValue(segment, effectiveMetric);
                  const segmentHeight = value > 0 ? Math.max(1, (value / maxValue) * innerHeight) : 0;
                  yCursor -= segmentHeight;
                  const colorStyle = trendSegmentColorStyle(segment);
                  const isDimmed = Boolean(focusedKey && focusedKey !== segment.key);

                  return (
                    <rect
                      key={`${point.date}:${segment.key}`}
                      className="token-trend-segment transition-opacity"
                      data-token-trend-segment={segment.key}
                      height={segmentHeight}
                      rx={Math.min(3, barWidth / 2)}
                      style={colorStyle}
                      width={barWidth}
                      x={x}
                      y={yCursor}
                      opacity={isDimmed ? 0.28 : 1}
                    />
                  );
                });

              return (
                <g key={point.date}>
                  {rects}
                  {isSelected || isHovered ? (
                    <rect
                      aria-hidden="true"
                      fill="none"
                      height={Math.max(2, barHeight)}
                      rx={Math.min(4, barWidth / 2)}
                      stroke={isSelected ? "var(--otb-energy-strong)" : "var(--otb-energy)"}
                      strokeOpacity={isSelected ? 0.85 : 0.55}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      width={barWidth + 1}
                      x={x - 0.5}
                      y={height - paddingBottom - barHeight}
                    />
                  ) : null}
                  <rect
                    aria-label={`${point.date} ${formatTrendMetricValue(stackValue, effectiveMetric, dict)}`}
                    aria-pressed={isSelected}
                    className="cursor-crosshair"
                    data-token-trend-point={point.date}
                    fill="transparent"
                    height={height}
                    onClick={() => setSelectedDate((date) => (date === point.date ? null : point.date))}
                    onBlur={() => setHoveredPointIndex((current) => (current === index ? null : current))}
                    onFocus={() => setHoveredPointIndex(index)}
                    onKeyDown={(event) => activateSvgControl(event, () => setSelectedDate((date) => (date === point.date ? null : point.date)))}
                    onMouseEnter={() => setHoveredPointIndex(index)}
                    onMouseMove={() => setHoveredPointIndex(index)}
                    pointerEvents="all"
                    role="button"
                    tabIndex={0}
                    width={Math.max(8, barWidth + gap)}
                    x={Math.max(0, x - gap / 2)}
                    y={0}
                  >
                    <title>{`${point.date} ${formatTrendMetricValue(stackValue, effectiveMetric, dict)} ${formatUtcRange(point.startAt, point.endAt)}`}</title>
                  </rect>
                </g>
              );
            }

            return (
              <g key={point.date}>
                <rect
                  className={index === chartPoints.length - 1 ? "token-trend-latest" : "token-trend-total"}
                  height={Math.max(stackValue > 0 ? 2 : 0, barHeight)}
                  rx={Math.min(3, barWidth / 2)}
                  width={barWidth}
                  x={x}
                  y={height - paddingBottom - Math.max(stackValue > 0 ? 2 : 0, barHeight)}
                />
                {isSelected || isHovered ? (
                  <rect
                    aria-hidden="true"
                    fill="none"
                    height={Math.max(2, barHeight)}
                    rx={Math.min(4, barWidth / 2)}
                    stroke={isSelected ? "var(--otb-energy-strong)" : "var(--otb-energy)"}
                    strokeOpacity={isSelected ? 0.85 : 0.55}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    width={barWidth + 1}
                    x={x - 0.5}
                    y={height - paddingBottom - barHeight}
                  />
                ) : null}
                <rect
                  aria-label={`${point.date} ${formatTrendMetricValue(stackValue, effectiveMetric, dict)}`}
                  aria-pressed={isSelected}
                  className="cursor-crosshair"
                  data-token-trend-point={point.date}
                  fill="transparent"
                  height={height}
                  onClick={() => setSelectedDate((date) => (date === point.date ? null : point.date))}
                  onBlur={() => setHoveredPointIndex((current) => (current === index ? null : current))}
                  onFocus={() => setHoveredPointIndex(index)}
                  onKeyDown={(event) => activateSvgControl(event, () => setSelectedDate((date) => (date === point.date ? null : point.date)))}
                  onMouseEnter={() => setHoveredPointIndex(index)}
                  onMouseMove={() => setHoveredPointIndex(index)}
                  pointerEvents="all"
                  role="button"
                  tabIndex={0}
                  width={Math.max(8, barWidth + gap)}
                  x={Math.max(0, x - gap / 2)}
                  y={0}
                >
                  <title>{`${point.date} ${formatTrendMetricValue(stackValue, effectiveMetric, dict)} ${formatUtcRange(point.startAt, point.endAt)}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>

        {hoveredPoint ? (
          <div
            role="tooltip"
            className={`pointer-events-none absolute top-2 z-30 min-w-[12rem] max-w-[min(18rem,calc(100vw-3rem))] rounded-lg border border-blue-600/18 bg-white/98 px-3 py-2 text-stone-950 opacity-100 shadow-sm backdrop-blur ${hoverAlignClass}`}
            style={{ left: `${hoveredX}%` }}
            data-token-trend-tooltip={hoveredPoint.date}
          >
            <span className="block font-mono text-[10px] font-semibold text-blue-600">{hoveredPoint.date}</span>
            <span className="mt-1 block truncate font-mono text-sm font-semibold leading-none">
              {formatTrendMetricValue(valueForPoint(hoveredPoint), effectiveMetric, dict)}
            </span>
            {hasTrendSegments(hoveredPoint) && canStack ? (
              <span className="mt-2 block space-y-1">
                {hoveredPoint.segments
                  .filter((segment) => visibleKeys.has(segment.key))
                  .filter((segment) => getTrendMetricValue(segment, effectiveMetric) > 0)
                  .sort((left, right) => getTrendMetricValue(right, effectiveMetric) - getTrendMetricValue(left, effectiveMetric))
                  .slice(0, 7)
                  .map((segment) => (
                    <span key={segment.key} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden="true" className="token-trend-swatch size-2 rounded-full" style={trendSegmentColorStyle(segment)} />
                        <span className="truncate">{segment.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-stone-500">
                        {formatTrendMetricValue(getTrendMetricValue(segment, effectiveMetric), effectiveMetric, dict)}
                      </span>
                    </span>
                  ))}
              </span>
            ) : null}
            <span className="mt-2 block whitespace-normal font-mono text-[10px] leading-4 text-stone-500">
              {formatUtcRange(hoveredPoint.startAt, hoveredPoint.endAt)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex justify-between gap-3 font-mono text-xs text-stone-500">
        <span>{chartPoints[0]?.date.slice(5) ?? "--"}</span>
        <span className="truncate text-center">{fallbackNotice || `${metricLabel} · ${canStack ? dict.board.trend.stacked : dict.board.trend.singleMetric}`}</span>
        <span>{chartPoints.at(-1)?.date.slice(5) ?? "--"}</span>
      </div>

      {selectedDate ? (
        <HourlyTrendDrilldown
          canStack={canStack}
          focusedKey={focusedKey}
          hiddenKeySet={hiddenKeySet}
          metric={effectiveMetric}
          selectedDate={selectedDate}
          trend={trend}
        />
      ) : null}
    </div>
  );
}

function HourlyTrendDrilldown({
  canStack,
  focusedKey,
  hiddenKeySet,
  metric,
  selectedDate,
  trend,
}: {
  canStack: boolean;
  focusedKey: string | null;
  hiddenKeySet: Set<string>;
  metric: TokenBoardMetric;
  selectedDate: string;
  trend?: TokenTrendBreakdown;
}) {
  const { dict } = useI18n();
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);
  const day = trend?.hourly.find((item) => item.date === selectedDate);

  if (!trend || !day) {
    return (
      <div className="mt-3 rounded-lg border border-amber-600/20 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        {dict.board.trend.hourlyUnsupported(formatNumber(trend?.hourlySupportedDays ?? 7), selectedDate)}
      </div>
    );
  }

  const points = day.points;
  const width = 920;
  const height = 124;
  const paddingTop = 8;
  const paddingBottom = 18;
  const paddingX = 6;
  const innerHeight = height - paddingTop - paddingBottom;
  const gap = 4;
  const barWidth = Math.max(4, (width - paddingX * 2 - gap * 23) / 24);
  const valueForPoint = (point: TokenTrendMetricValues & { segments: TokenTrendSegment[] }) => {
    if (!canStack) {
      return getTrendMetricValue(point, metric);
    }

    return point.segments
      .filter((segment) => !hiddenKeySet.has(segment.key))
      .reduce((sum, segment) => sum + getTrendMetricValue(segment, metric), 0);
  };
  const maxValue = Math.max(1, ...points.map(valueForPoint));
  const hoveredPoint = hoveredHourIndex === null ? null : points[hoveredHourIndex] ?? null;

  return (
    <div className="mt-3 rounded-lg border border-stone-950/8 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-950">{dict.board.trend.hourlyTitle(selectedDate)}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-stone-500">
            {hoveredPoint
              ? `${String(hoveredPoint.hour).padStart(2, "0")}:00 · ${formatTrendMetricValue(valueForPoint(hoveredPoint), metric, dict)}`
              : dict.board.trend.hourlyReady(formatNumber(trend.hourlySupportedDays))}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-500">
          {dict.board.trend.hours24}
        </span>
      </div>
      <div className="relative mt-2" onMouseLeave={() => setHoveredHourIndex(null)}>
        <svg
          aria-label={dict.board.trend.hourlyAria(selectedDate, formatTrendMetricValue(maxValue, metric, dict))}
          className="h-32 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            x1={paddingX}
            x2={width - paddingX}
            y1={height - paddingBottom}
            y2={height - paddingBottom}
            stroke="currentColor"
            strokeOpacity="0.16"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) => {
            const x = paddingX + index * (barWidth + gap);
            const stackValue = valueForPoint(point);
            const barHeight = Math.max(0, (stackValue / maxValue) * innerHeight);

            if (canStack) {
              let yCursor = height - paddingBottom;
              const rects = point.segments
                .filter((segment) => !hiddenKeySet.has(segment.key))
                .map((segment) => {
                  const value = getTrendMetricValue(segment, metric);
                  const segmentHeight = value > 0 ? Math.max(1, (value / maxValue) * innerHeight) : 0;
                  yCursor -= segmentHeight;
                  const isDimmed = Boolean(focusedKey && focusedKey !== segment.key);

                  return (
                    <rect
                      key={`${point.hour}:${segment.key}`}
                      className="token-trend-segment transition-opacity"
                      height={segmentHeight}
                      rx={Math.min(3, barWidth / 2)}
                      style={trendSegmentColorStyle(segment)}
                      width={barWidth}
                      x={x}
                      y={yCursor}
                      opacity={isDimmed ? 0.28 : 1}
                    />
                  );
                });

              return (
                <g key={point.hour}>
                  {rects}
                  <rect
                    aria-label={`${String(point.hour).padStart(2, "0")}:00 ${formatTrendMetricValue(stackValue, metric, dict)}`}
                    className="cursor-crosshair"
                    fill="transparent"
                    height={height}
                    onBlur={() => setHoveredHourIndex((current) => (current === index ? null : current))}
                    onFocus={() => setHoveredHourIndex(index)}
                    onKeyDown={(event) => activateSvgControl(event, () => setHoveredHourIndex(index))}
                    onMouseEnter={() => setHoveredHourIndex(index)}
                    onMouseMove={() => setHoveredHourIndex(index)}
                    pointerEvents="all"
                    role="button"
                    tabIndex={0}
                    width={Math.max(10, barWidth + gap)}
                    x={Math.max(0, x - gap / 2)}
                    y={0}
                  >
                    <title>{`${String(point.hour).padStart(2, "0")}:00 ${formatTrendMetricValue(stackValue, metric, dict)}`}</title>
                  </rect>
                </g>
              );
            }

            return (
              <g key={point.hour}>
                <rect
                  className="token-trend-total"
                  height={Math.max(stackValue > 0 ? 2 : 0, barHeight)}
                  rx={Math.min(3, barWidth / 2)}
                  width={barWidth}
                  x={x}
                  y={height - paddingBottom - Math.max(stackValue > 0 ? 2 : 0, barHeight)}
                />
                <rect
                  aria-label={`${String(point.hour).padStart(2, "0")}:00 ${formatTrendMetricValue(stackValue, metric, dict)}`}
                  className="cursor-crosshair"
                  fill="transparent"
                  height={height}
                  onBlur={() => setHoveredHourIndex((current) => (current === index ? null : current))}
                  onFocus={() => setHoveredHourIndex(index)}
                  onKeyDown={(event) => activateSvgControl(event, () => setHoveredHourIndex(index))}
                  onMouseEnter={() => setHoveredHourIndex(index)}
                  onMouseMove={() => setHoveredHourIndex(index)}
                  pointerEvents="all"
                  role="button"
                  tabIndex={0}
                  width={Math.max(10, barWidth + gap)}
                  x={Math.max(0, x - gap / 2)}
                  y={0}
                >
                  <title>{`${String(point.hour).padStart(2, "0")}:00 ${formatTrendMetricValue(stackValue, metric, dict)}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-stone-500">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

const TREND_SEGMENT_COLORS = [
  { dark: "#ff9a62", light: "#d9480f" },
  { dark: "#fb7185", light: "#be123c" },
  { dark: "#fbbf24", light: "#b45309" },
  { dark: "#2dd4bf", light: "#0f766e" },
  { dark: "#c4b5fd", light: "#7c3aed" },
  { dark: "#34d399", light: "#047857" },
  { dark: "#7dd3fc", light: "#0369a1" },
];
const OTHER_TREND_COLOR = { dark: "#a8a29e", light: "#78716c" };

function trendSegmentColorStyle(segment: TokenTrendSegment) {
  const color = segment.other ? OTHER_TREND_COLOR : TREND_SEGMENT_COLORS[hashTrendKey(segment.key) % TREND_SEGMENT_COLORS.length];

  return {
    "--trend-fill-dark": color.dark,
    "--trend-fill-light": color.light,
  } as CSSProperties;
}

function hasTrendSegments(point: unknown): point is { segments: TokenTrendSegment[]; tokens: number; startAt: string; endAt: string; date: string } {
  return Boolean(point && typeof point === "object" && Array.isArray((point as { segments?: unknown }).segments));
}

function hashTrendKey(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getTrendMetricValue(value: Partial<TokenTrendMetricValues> & { tokens: number }, metric: TokenBoardMetric) {
  if (metric === "cost") {
    return value.costUsd ?? 0;
  }

  if (metric === "sessions") {
    return value.sessions ?? 0;
  }

  if (metric === "messages") {
    return value.messages ?? 0;
  }

  if (metric === "lines") {
    return value.linesWritten ?? 0;
  }

  if (metric === "users") {
    return value.activeUsers ?? 0;
  }

  return value.tokens;
}

function formatTrendMetricValue(value: number, metric: TokenBoardMetric, dict: Dictionary) {
  if (metric === "cost") {
    return formatUsd(value);
  }

  if (metric === "sessions") {
    return dict.common.units.sessions(formatNumber(value));
  }

  if (metric === "messages") {
    return dict.common.units.messages(formatNumber(value));
  }

  if (metric === "lines") {
    return formatNumber(value);
  }

  if (metric === "users") {
    return dict.common.units.people(formatNumber(value));
  }

  return formatTokens(value);
}

function metricTrendLabel(metric: TokenBoardMetric, dict: Dictionary) {
  if (metric === "cost") {
    return dict.common.metrics.estimatedCost;
  }

  if (metric === "sessions") {
    return dict.common.metrics.sessions;
  }

  if (metric === "messages") {
    return dict.common.metrics.messages;
  }

  if (metric === "lines") {
    return dict.common.metrics.lines;
  }

  if (metric === "users") {
    return dict.common.metrics.users;
  }

  return "Token";
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
  const { dict } = useI18n();

  return (
    <th aria-sort={active ? "descending" : undefined} className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${
          active
            ? "otb-energy-bg text-white shadow-sm"
            : "text-stone-500"
        }`}
        title={active ? dict.board.leaderboard.activeSortTitle : undefined}
      >
        {children}
        {active ? <span aria-hidden="true">↓</span> : null}
      </span>
    </th>
  );
}

function rankVisual(rank: number) {
  if (rank === 1) {
    return {
      badgeClass: "border-amber-500/45 bg-[linear-gradient(135deg,var(--otb-gold-soft),#ffffff)] text-amber-900 dark:bg-[linear-gradient(135deg,var(--otb-gold-soft),rgba(15,23,42,0.92))]",
      mobileCardClass: "otb-leader-breathe border-amber-500/35 bg-[linear-gradient(135deg,rgba(255,244,204,0.95),rgba(255,255,255,0.88))] dark:bg-[linear-gradient(135deg,rgba(120,75,10,0.3),rgba(15,23,42,0.94))]",
      modelClass: "border-amber-500/30 bg-amber-50 text-amber-900",
      rowClass: "otb-leader-breathe bg-[linear-gradient(90deg,rgba(255,244,204,0.7),transparent_62%)] dark:bg-[linear-gradient(90deg,rgba(120,75,10,0.22),transparent_62%)]",
    };
  }

  if (rank === 2) {
    return {
      badgeClass: "border-slate-400/40 bg-[linear-gradient(135deg,var(--otb-silver-soft),#ffffff)] text-slate-700 dark:bg-[linear-gradient(135deg,var(--otb-silver-soft),rgba(15,23,42,0.92))]",
      mobileCardClass: "border-slate-300/60 bg-[linear-gradient(135deg,rgba(238,243,248,0.92),rgba(255,255,255,0.86))] dark:bg-[linear-gradient(135deg,rgba(75,85,99,0.24),rgba(15,23,42,0.94))]",
      modelClass: "border-slate-300 bg-slate-50 text-slate-700",
      rowClass: "bg-[linear-gradient(90deg,rgba(238,243,248,0.72),transparent_58%)] dark:bg-[linear-gradient(90deg,rgba(75,85,99,0.2),transparent_58%)]",
    };
  }

  if (rank === 3) {
    return {
      badgeClass: "border-orange-500/35 bg-[linear-gradient(135deg,var(--otb-bronze-soft),#ffffff)] text-orange-900 dark:bg-[linear-gradient(135deg,var(--otb-bronze-soft),rgba(15,23,42,0.92))]",
      mobileCardClass: "border-orange-300/55 bg-[linear-gradient(135deg,rgba(255,240,228,0.92),rgba(255,255,255,0.86))] dark:bg-[linear-gradient(135deg,rgba(124,58,18,0.24),rgba(15,23,42,0.94))]",
      modelClass: "border-orange-300 bg-orange-50 text-orange-900",
      rowClass: "bg-[linear-gradient(90deg,rgba(255,240,228,0.72),transparent_58%)] dark:bg-[linear-gradient(90deg,rgba(124,58,18,0.2),transparent_58%)]",
    };
  }

  return {
    badgeClass: "border-stone-950/10 bg-white text-stone-500",
    mobileCardClass: "border-stone-950/10 bg-white",
    modelClass: "border-stone-950/10 bg-slate-50 text-stone-700",
    rowClass: "",
  };
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
  const { dict } = useI18n();
  const metricLabel = metric === "users" ? dict.common.metrics.activeDays : dict.common.metrics[metric];
  const metricValue = metric === "lines" ? formatLines(user.linesWritten) : formatMetricValue(getUserMetricValue(user, metric), metric);
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);
  const cacheBreakdownTitle = dict.board.leaderboard.cacheBreakdown(
    formatTokens(user.inputTokens),
    formatTokens(user.cachedInputTokens),
    formatTokens(user.cacheCreationInputTokens),
    formatTokens(user.outputTokens)
  );
  const rankStyle = rankVisual(user.rank);

  return (
    <article className={`otb-card-hover rounded-lg border p-3 shadow-sm ${rankStyle.mobileCardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <Link
          href={profileHrefForUser(user)}
          className="group/profile-link flex min-w-0 items-center gap-3 rounded-lg transition"
          title={dict.board.leaderboard.viewProfileTitle(user.displayName)}
        >
          <span className={`rounded-full border px-2.5 py-1 font-mono text-xs font-black ${rankStyle.badgeClass}`}>
            #{user.rank}
          </span>
          <RankDeltaBadge previousRank={user.previousRank} rankDelta={user.rankDelta} />
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <LevelSymbol level={user.level} />
              <p className="truncate font-semibold text-stone-950 transition group-hover/profile-link:text-blue-700">{user.displayName}</p>
            </div>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </Link>
        <div className="shrink-0 text-right">
          <p className="otb-stat-number font-mono text-xl font-black text-stone-950">{metricValue}</p>
          <p className="text-xs text-stone-500">{metricLabel} ↓</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-stone-950/8 bg-slate-50 p-2 text-xs">
        <MetricMini label={dict.common.metrics.tokens} value={formatTokens(consumptionTokens)} />
        <MetricMini label={dict.common.metrics.cost} value={formatUsd(user.costUsd)} />
        <MetricMini label={dict.common.metrics.lines} value={formatLines(user.linesWritten)} />
      </div>
      <p className="mt-2 truncate text-xs text-stone-500" title={cacheBreakdownTitle}>
        {dict.board.leaderboard.readWriteCache(formatTokens(user.cachedInputTokens), formatTokens(user.cacheCreationInputTokens))}
      </p>
      {showDailyTrend ? (
        <div className="mt-3 rounded-lg border border-stone-950/8 bg-white px-3 py-2">
          <DailyUsageSparkline
            daily={daily}
            label={dict.board.leaderboard.dailyUsageLabel(user.displayName)}
            metaClassName="text-stone-500"
            range={range}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className={`rounded-md border px-2 py-1 font-semibold ${rankStyle.modelClass}`}>
          {user.topModel}
        </span>
        <span>{formatNumber(user.records)} records</span>
        {user.lastReportedAt ? <span>{dict.board.leaderboard.recent(formatRelativeTime(user.lastReportedAt, dict.common.states.justNow))}</span> : null}
        {user.deltaTokens !== null ? <span>{dict.board.leaderboard.previousPeriod(formatSignedPercent(user.deltaTokens))}</span> : null}
      </div>
    </article>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-stone-500">{label}</p>
      <p className="otb-stat-number mt-1 truncate font-mono font-black text-stone-900" title={value}>{value}</p>
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
  const { dict } = useI18n();
  const gradientId = sanitizeSvgId(useId());
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const normalizedDaily = normalizeDailyUsageSeries(daily);
  const trend = buildSparklineTrend(normalizedDaily, range, dict);
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
    ? dict.board.trend.sparklineTitle(label, firstDate, lastDate, trend.unitLabel, peak.label, formatTokens(peak.tokens), formatTokens(totalTokens))
    : dict.board.trend.sparklineEmptyTitle(label);
  const activeSummary = activePoint
    ? `${activePoint.label} ${formatTokens(activePoint.tokens)}`
    : dict.board.trend.peak(formatTokens(peak.tokens));
  const exactActiveLabel = activePoint ? formatTokens(activePoint.tokens) : "";

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
          <span className="sr-only">{dict.board.trend.hoverSparkline}</span>
        )}
      </div>
      <div
        className="relative h-12"
        onMouseLeave={() => setHoveredPointIndex(null)}
      >
        <svg
          aria-label={title}
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--otb-energy)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--otb-energy)" stopOpacity="0.02" />
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
              stroke="var(--otb-energy)"
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
              stroke="var(--otb-energy)"
              strokeDasharray="3 3"
              strokeOpacity="0.5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {points.map((point, index) => {
            const left = index === 0 ? 0 : (points[index - 1].x + point.x) / 2;
            const right = index === points.length - 1 ? width : (point.x + points[index + 1].x) / 2;
            const exactLabel = `${point.label} ${formatTokens(point.tokens)}`;

            return (
              <rect
                key={`${point.startDate}:${point.endDate}:hit`}
                aria-label={exactLabel}
                className="cursor-crosshair"
                data-daily-usage-point={point.label}
                fill="transparent"
                height={height}
                onClick={() => setHoveredPointIndex(index)}
                onBlur={() => setHoveredPointIndex((current) => (current === index ? null : current))}
                onFocus={() => setHoveredPointIndex(index)}
                onKeyDown={(event) => activateSvgControl(event, () => setHoveredPointIndex(index))}
                onMouseEnter={() => setHoveredPointIndex(index)}
                onMouseMove={() => setHoveredPointIndex(index)}
                pointerEvents="all"
                role="button"
                tabIndex={0}
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
            const dotFill = isHovered ? "bg-blue-600" : isLatest ? "bg-violet-600" : "bg-white";

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

function buildSparklineTrend(daily: TokenLeaderboardUser["daily"], range: TokenBoardRange, dict: Dictionary) {
  const bucketSize = range === "90D" ? 7 : range === "30D" ? 3 : 1;
  const unitLabel = bucketSize === 7 ? dict.board.trend.weekly : bucketSize === 3 ? dict.board.trend.threeDays : dict.board.trend.daily;

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
  const { dict } = useI18n();
  const consumptionTokens = getTokenConsumptionTokens(user);
  const daily = normalizeDailyUsageSeries(user.daily);
  const cacheBreakdownTitle = dict.board.leaderboard.cacheBreakdown(
    formatTokens(user.inputTokens),
    formatTokens(user.cachedInputTokens),
    formatTokens(user.cacheCreationInputTokens),
    formatTokens(user.outputTokens)
  );
  const rankStyle = rankVisual(user.rank);

  return (
    <tr className={`transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm ${rankStyle.rowClass}`}>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <span className={`inline-flex justify-center rounded-full border px-2 py-1 font-mono text-xs font-black ${rankStyle.badgeClass} ${user.rank === 1 ? "min-w-12 text-sm" : "min-w-10"}`}>
            #{user.rank}
          </span>
          <RankDeltaBadge previousRank={user.previousRank} rankDelta={user.rankDelta} />
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={profileHrefForUser(user)}
          className="group/profile-link flex w-fit max-w-full items-center gap-3 rounded-lg transition"
          title={dict.board.leaderboard.viewProfileTitle(user.displayName)}
        >
          <Avatar name={user.displayName} index={user.rank} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <LevelSymbol level={user.level} />
              <p className="truncate font-semibold text-stone-950 transition group-hover/profile-link:text-blue-700">{user.displayName}</p>
            </div>
            <p className="truncate text-xs text-stone-500">{user.team}</p>
          </div>
        </Link>
      </td>
      {showDailyTrend ? (
        <td className="w-[18rem] min-w-[18rem] max-w-[18rem] px-4 py-3">
          <DailyUsageSparkline fixedWidth daily={daily} label={dict.board.leaderboard.dailyUsageLabel(user.displayName)} range={range} />
        </td>
      ) : null}
      <td className="otb-stat-number px-4 py-3 text-right font-mono text-base font-black text-stone-950" title={cacheBreakdownTitle}>
        {formatTokens(consumptionTokens)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatUsd(user.costUsd)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(user.sessions)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatLines(user.linesWritten)}</td>
      <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(user.activeDays)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${rankStyle.modelClass}`}>
            {user.topModel}
          </span>
          {user.deltaTokens !== null ? (
            <span
              className={`font-mono text-xs font-semibold ${user.deltaTokens >= 0 ? "text-blue-600" : "text-red-600"}`}
              title={dict.board.leaderboard.deltaTitle}
            >
              {formatSignedPercent(user.deltaTokens)}
            </span>
          ) : null}
          {user.lastReportedAt ? (
            <span className="text-xs text-stone-400" title={dict.board.leaderboard.lastReportedTitle(formatShortDate(user.lastReportedAt))}>
              {formatNumber(user.records)} records
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function LevelSymbol({ level }: { level: TokenLeaderboardUser["level"] }) {
  const { dict } = useI18n();
  const current = level.current;
  const translated = dict.board.achievements.levels[current.id as keyof typeof dict.board.achievements.levels] ?? current;
  const name = "name" in translated ? translated.name : current.name;
  const symbol = "symbol" in translated ? translated.symbol : current.symbol;

  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold leading-none"
      style={{
        backgroundColor: `${current.color}18`,
        borderColor: `${current.color}55`,
        color: current.color,
      }}
      title={dict.board.leaderboard.levelTitle(name)}
    >
      {symbol}
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
  const { dict } = useI18n();

  if (previousRank === null) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
        {dict.board.leaderboard.newEntry}
      </span>
    );
  }

  if (!rankDelta) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
        {dict.board.leaderboard.unchanged}
      </span>
    );
  }

  const isUp = rankDelta > 0;

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
        isUp
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
      title={dict.board.leaderboard.previousRank(previousRank)}
    >
      {isUp ? "↑" : "↓"}
      {formatNumber(Math.abs(rankDelta))}
    </span>
  );
}

export function MobileLeaderboardLoading({ slow }: { slow: boolean }) {
  const { dict } = useI18n();

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
        <p className="text-center text-xs text-stone-500">{dict.board.leaderboard.slowMobile}</p>
      ) : null}
    </>
  );
}

export function LeaderboardLoadingRow({ columnCount, slow }: { columnCount: number; slow: boolean }) {
  const { dict } = useI18n();

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
            {dict.board.leaderboard.slowRow}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function LeaderboardErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { dict } = useI18n();

  return (
    <EmptyStatePanel
      title={dict.board.leaderboard.errorTitle}
      description={error || dict.board.leaderboard.errorDescription}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="otb-energy-bg inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <Icon name="refresh" />
          {dict.common.actions.retry}
        </button>
      }
    />
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
  const { dict } = useI18n();

  return (
    <EmptyStatePanel
      title={dict.board.leaderboard.emptyTitle}
      description={dict.board.leaderboard.emptyDescription}
    />
  );
}

export function LeaderboardEmptyRow({ columnCount }: { columnCount: number }) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-6">
        <LeaderboardEmptyState />
      </td>
    </tr>
  );
}

export function ShareRow({ metric, total, user }: { metric: TokenBoardMetric; total: number; user: TokenLeaderboardUser }) {
  const { dict } = useI18n();
  const value = getUserMetricValue(user, metric);
  const share = total > 0 ? value / total : 0;
  const sharePercent = Math.round(share * 100);
  const shareLabel = formatPercent(share);
  const valueLabel = metric === "lines" ? formatLines(user.linesWritten) : formatMetricValue(value, metric);

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_5rem] items-center gap-3">
      <Avatar name={user.displayName} index={user.rank} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{user.displayName}</p>
          <p className="font-mono text-xs font-semibold text-stone-500">{shareLabel}</p>
        </div>
        <div
          aria-label={dict.board.leaderboard.shareProgressAria(user.displayName, shareLabel)}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={sharePercent}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/80 shadow-inner"
          role="progressbar"
        >
          <div
            className="otb-energy-bar h-full rounded-full"
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
      </div>
      <p className="text-right font-mono text-sm font-semibold">{valueLabel}</p>
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
    <div className="grid h-64 grid-cols-12 items-end gap-1 rounded-lg border border-stone-950/8 bg-[linear-gradient(180deg,rgba(17,19,15,0.04),transparent)] px-3 pb-3 pt-5">
      {TREND_SKELETON_HEIGHTS.map((height, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="otb-skeleton block w-full rounded-t-[3px]"
          style={{ height }}
        />
      ))}
    </div>
  );
}

export function EmptyPanelMessage() {
  const { dict } = useI18n();

  return <p className="rounded-lg border border-stone-950/8 bg-white/60 px-3 py-4 text-center text-sm text-stone-500">{dict.board.leaderboard.noRealData}</p>;
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
                <div className="otb-energy-bar h-full rounded-full" style={{ width: `${Math.max(2, item.share * 100)}%` }} />
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
  const { dict } = useI18n();

  if (!viewer) {
    return null;
  }

  if (viewer.authenticated) {
    return (
      <div className="flex w-full items-center gap-2 xl:w-auto">
        <span className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 xl:flex-none">
          <Icon name="github" />
          <span className="truncate">@{viewer.user?.githubLogin || viewer.user?.displayName || "GitHub"}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100"
          title={dict.board.status.logoutConfirm}
        >
          <Icon name="logout" />
          {dict.common.actions.logout}
        </button>
      </div>
    );
  }

  return null;
}
