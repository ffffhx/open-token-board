"use client";

import { useId, useMemo, useState } from "react";

import type { TokenDailyUsagePoint } from "@open-token-board/core";
import { formatTokens } from "@/components/token-leaderboard/utils";
import { useI18n } from "@/i18n";

type IsometricContributionGraphProps = {
  ariaLabel: string;
  daily: TokenDailyUsagePoint[];
  emptyLabel: string;
  height?: number;
  maxColumns?: number;
  minHeight?: number;
  peakLabel: (date: string, tokens: string) => string;
  quietLabel: string;
  showHoverLabel?: boolean;
  variant?: "card" | "compact" | "share";
};

type ContributionCell = {
  date: string;
  tokens: number;
  week: number;
  weekday: number;
};

type IsoPoint = {
  x: number;
  y: number;
};

type IsoBar = ContributionCell & {
  color: IsoColor;
  height: number;
  origin: IsoPoint;
  sortKey: number;
};

type IsoColor = {
  left: string;
  right: string;
  top: string;
};

const ISO_COLORS: IsoColor[] = [
  { left: "var(--iso-empty-left, #d9e2ef)", right: "var(--iso-empty-right, #cbd5e1)", top: "var(--iso-empty-top, #f1f5f9)" },
  { left: "var(--iso-low-left, #8fd7c3)", right: "var(--iso-low-right, #54b89c)", top: "var(--iso-low-top, #bff3df)" },
  { left: "var(--iso-mid-left, #44b8d0)", right: "var(--iso-mid-right, #168ba6)", top: "var(--iso-mid-top, #7de0ef)" },
  { left: "var(--iso-high-left, #5969f3)", right: "var(--iso-high-right, #3344c8)", top: "var(--iso-high-top, #8ca0ff)" },
  { left: "var(--iso-peak-left, #d6862f)", right: "var(--iso-peak-right, #aa5d12)", top: "var(--iso-peak-top, #ffd166)" },
];

export function IsometricContributionGraph({
  ariaLabel,
  daily,
  emptyLabel,
  height = 286,
  maxColumns = 53,
  minHeight = 4,
  peakLabel,
  quietLabel,
  showHoverLabel = true,
  variant = "card",
}: IsometricContributionGraphProps) {
  const { dict } = useI18n();
  const rawGradientId = useId();
  const gradientId = `iso-grid-${rawGradientId.replace(/:/g, "")}`;
  const [hovered, setHovered] = useState<TokenDailyUsagePoint | null>(null);
  const chart = useMemo(() => buildIsometricChart(daily, { maxColumns, minHeight }), [daily, maxColumns, minHeight]);
  const peak = chart.peak;
  const hoverText = hovered ? `${hovered.date} · ${formatTokens(hovered.tokens)}` : "";
  const summary = peak && peak.tokens > 0 ? peakLabel(peak.date, formatTokens(peak.tokens)) : quietLabel;
  const className =
    variant === "share"
      ? "otb-iso-graph otb-iso-graph-share block w-full"
      : variant === "compact"
        ? "otb-iso-graph otb-iso-graph-compact block w-full"
        : "otb-iso-graph block w-full";

  return (
    <div className={variant === "card" ? "min-w-0" : undefined}>
      {showHoverLabel ? (
        <div className="mb-2 min-h-5 text-right font-mono text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          {hoverText || summary}
        </div>
      ) : null}
      <svg
        aria-label={`${ariaLabel}. ${summary}`}
        className={className}
        data-contribution-3d="true"
        height={height}
        role="img"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--iso-grid-line-a, rgba(47, 91, 255, 0.22))" />
            <stop offset="1" stopColor="var(--iso-grid-line-b, rgba(0, 184, 217, 0.18))" />
          </linearGradient>
        </defs>
        <path
          aria-hidden="true"
          d={chart.floorPath}
          fill="var(--iso-floor, rgba(241, 245, 249, 0.72))"
          stroke={`url(#${gradientId})`}
          strokeWidth="1"
        />
        {chart.weekLines.map((line) => (
          <path
            key={`w-${line.index}`}
            aria-hidden="true"
            d={`M${line.start.x.toFixed(2)} ${line.start.y.toFixed(2)}L${line.end.x.toFixed(2)} ${line.end.y.toFixed(2)}`}
            fill="none"
            stroke="var(--iso-grid-line, rgba(100, 116, 139, 0.14))"
            strokeWidth="0.8"
          />
        ))}
        {chart.weekdayLines.map((line) => (
          <path
            key={`d-${line.index}`}
            aria-hidden="true"
            d={`M${line.start.x.toFixed(2)} ${line.start.y.toFixed(2)}L${line.end.x.toFixed(2)} ${line.end.y.toFixed(2)}`}
            fill="none"
            stroke="var(--iso-grid-line, rgba(100, 116, 139, 0.14))"
            strokeWidth="0.8"
          />
        ))}
        {chart.bars.map((bar) => (
          <g
            key={bar.date}
            data-contribution-3d-bar={bar.date}
            data-token-height={bar.height.toFixed(2)}
            onMouseEnter={() => setHovered({ date: bar.date, startAt: "", endAt: "", tokens: bar.tokens })}
            onMouseLeave={() => setHovered(null)}
          >
            <path d={barFacePath(bar, "left")} fill={bar.color.left} />
            <path d={barFacePath(bar, "right")} fill={bar.color.right} />
            <path d={barFacePath(bar, "top")} fill={bar.color.top}>
              <title>{`${bar.date} · ${formatTokens(bar.tokens)}`}</title>
            </path>
          </g>
        ))}
        {!chart.bars.length ? (
          <text fill="var(--color-slate-500)" fontSize="11" textAnchor="middle" x={chart.width / 2} y={chart.height / 2}>
            {emptyLabel}
          </text>
        ) : null}
      </svg>
      {variant === "card" ? (
        <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>{dict.profile.sections.less}</span>
          {ISO_COLORS.map((color, index) => (
            <span
              key={index}
              className="h-3 w-4 rounded-[3px] border border-slate-200 dark:border-slate-700"
              style={{ backgroundColor: color.top }}
            />
          ))}
          <span>{dict.profile.sections.more}</span>
        </div>
      ) : null}
    </div>
  );
}

export function buildIsometricContributionCells(daily: TokenDailyUsagePoint[], maxColumns = 53): ContributionCell[] {
  return daily.slice(-maxColumns * 7).map((point, index) => ({
    date: point.date,
    tokens: point.tokens,
    week: Math.floor(index / 7),
    weekday: index % 7,
  }));
}

export function tokenHeight(tokens: number, maxTokens: number, maxHeight: number, minHeight = 4) {
  if (tokens <= 0 || maxTokens <= 0) {
    return 0;
  }

  const ratio = Math.log1p(tokens) / Math.log1p(maxTokens);
  return Math.max(minHeight, ratio * maxHeight);
}

function buildIsometricChart(
  daily: TokenDailyUsagePoint[],
  options: {
    maxColumns: number;
    minHeight: number;
  }
) {
  const cells = buildIsometricContributionCells(daily, options.maxColumns);
  const activeCells = cells.filter((cell) => cell.tokens > 0);
  const maxTokens = Math.max(1, ...activeCells.map((cell) => cell.tokens));
  const tileWidth = options.maxColumns > 20 ? 10 : 14;
  const tileDepth = options.maxColumns > 20 ? 6 : 8;
  const maxHeight = options.maxColumns > 20 ? 72 : 54;
  const xScale = tileWidth;
  const yScale = tileDepth;
  const padX = options.maxColumns > 20 ? 34 : 18;
  const padTop = maxHeight + 16;
  const padBottom = 22;

  const project = (week: number, weekday: number): IsoPoint => ({
    x: (week - weekday) * (xScale / 2),
    y: (week + weekday) * (yScale / 2),
  });

  const corners = [
    project(0, 0),
    project(options.maxColumns, 0),
    project(options.maxColumns, 7),
    project(0, 7),
  ];
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const offsetX = padX - minX;
  const offsetY = padTop - minY;
  const place = (week: number, weekday: number): IsoPoint => {
    const point = project(week, weekday);
    return { x: point.x + offsetX, y: point.y + offsetY };
  };

  const bars = cells
    .map<IsoBar>((cell) => ({
      ...cell,
      color: isoColor(cell.tokens, maxTokens),
      height: tokenHeight(cell.tokens, maxTokens, maxHeight, options.minHeight),
      origin: place(cell.week, cell.weekday),
      sortKey: cell.week + cell.weekday,
    }))
    .sort((left, right) => left.sortKey - right.sortKey || left.weekday - right.weekday);

  const floor = [place(0, 0), place(options.maxColumns, 0), place(options.maxColumns, 7), place(0, 7)];
  const floorPath = `M${floor[0].x.toFixed(2)} ${floor[0].y.toFixed(2)}L${floor[1].x.toFixed(2)} ${floor[1].y.toFixed(2)}L${floor[2].x.toFixed(2)} ${floor[2].y.toFixed(2)}L${floor[3].x.toFixed(2)} ${floor[3].y.toFixed(2)}Z`;
  const width = Math.ceil(maxX - minX + padX * 2);
  const height = Math.ceil(maxY - minY + padTop + padBottom);
  const peak = activeCells.reduce<ContributionCell | null>(
    (best, cell) => (!best || cell.tokens > best.tokens ? cell : best),
    null
  );

  return {
    bars,
    floorPath,
    height,
    peak,
    weekdayLines: Array.from({ length: 8 }, (_, index) => ({
      end: place(options.maxColumns, index),
      index,
      start: place(0, index),
    })),
    weekLines: Array.from({ length: options.maxColumns + 1 }, (_, index) => ({
      end: place(index, 7),
      index,
      start: place(index, 0),
    })).filter((line) => line.index % (options.maxColumns > 20 ? 4 : 1) === 0 || line.index === options.maxColumns),
    width,
  };
}

function barFacePath(bar: IsoBar, face: "left" | "right" | "top") {
  const top = { x: bar.origin.x, y: bar.origin.y - bar.height };
  const right = { x: top.x + 5, y: top.y + 3 };
  const front = { x: top.x, y: top.y + 6 };
  const left = { x: top.x - 5, y: top.y + 3 };
  const baseRight = { x: right.x, y: right.y + bar.height };
  const baseFront = { x: front.x, y: front.y + bar.height };
  const baseLeft = { x: left.x, y: left.y + bar.height };

  if (face === "top") {
    return polygonPath([top, right, front, left]);
  }

  if (face === "right") {
    return polygonPath([right, baseRight, baseFront, front]);
  }

  return polygonPath([left, front, baseFront, baseLeft]);
}

function polygonPath(points: IsoPoint[]) {
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join("")}Z`;
}

function isoColor(tokens: number, maxTokens: number) {
  if (tokens <= 0) return ISO_COLORS[0];
  const ratio = Math.log1p(tokens) / Math.log1p(Math.max(1, maxTokens));
  if (ratio < 0.35) return ISO_COLORS[1];
  if (ratio < 0.58) return ISO_COLORS[2];
  if (ratio < 0.82) return ISO_COLORS[3];
  return ISO_COLORS[4];
}
