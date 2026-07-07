"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  getTokenConsumptionTokens,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
} from "@open-token-board/core";

import type { ViewerState } from "./types";
import { Avatar, Skeleton } from "./shared-ui";
import { formatNumber, formatPercent, formatSignedPercent, formatTokens, formatUsd } from "./utils";

export function TeamBattlePanel({
  loading,
  summary,
}: {
  loading: boolean;
  summary: TokenLeaderboardSummary;
}) {
  const teams = summary.teams ?? [];

  if (!loading && teams.length < 2) {
    return null;
  }

  if (loading) {
    return (
      <section className="otb-panel rounded-lg p-4" data-testid="team-battle-section">
        <DimensionHeader title="小队对抗" meta={<Skeleton className="h-3 w-20 align-middle" />} />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-lg border border-stone-950/10 bg-white p-4 shadow-sm">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-5 h-7 w-28" />
              <Skeleton className="mt-4 h-3 w-full" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="otb-panel rounded-lg p-4" data-testid="team-battle-section">
      <DimensionHeader title="小队对抗" meta={`${teams.length} 支小队 · 按总量排序`} />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => {
          const champion = team.rank === 1;
          const visibleMembers = team.members.slice(0, 5);
          const overflowMembers = Math.max(0, team.activeUsers - visibleMembers.length);

          return (
            <article
              key={team.name}
              className={`otb-card-hover min-w-0 rounded-lg border p-4 shadow-sm ${
                champion ? "otb-leader-breathe" : "bg-white"
              }`}
              style={champion ? championCardStyle : undefined}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-black ${
                        champion ? "bg-[var(--otb-gold)] text-white" : "bg-slate-950 text-white"
                      }`}
                    >
                      {team.rank}
                    </span>
                    <h2 className="truncate text-base font-semibold text-slate-950" title={team.name}>
                      {team.name}
                    </h2>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    {formatNumber(team.activeUsers)} 人 · {formatUsd(team.costUsd)}
                  </p>
                </div>
                <TeamDeltaBadge value={team.deltaTokens} />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <MetricBlock label="总量" value={formatTokens(team.tokens)} />
                <MetricBlock label="人均" value={formatTokens(team.tokensPerUser)} />
              </div>

              <div className="mt-5 flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center">
                  {visibleMembers.map((member, index) => (
                    <span key={member.userId} className={index ? "-ml-2" : ""} title={`${member.displayName} · ${formatTokens(member.tokens)}`}>
                      <Avatar name={member.displayName} index={index} />
                    </span>
                  ))}
                  {overflowMembers ? (
                    <span className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-600 ring-1 ring-stone-950/10">
                      +{overflowMembers}
                    </span>
                  ) : null}
                </div>
                <p className="shrink-0 font-mono text-xs text-stone-500">{formatPercent(team.share)}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ProjectConsumptionPanel({
  loading,
  summary,
}: {
  loading: boolean;
  summary: TokenLeaderboardSummary;
}) {
  const projects = summary.projects ?? [];
  const maxTokens = Math.max(1, ...projects.map((project) => project.tokens));

  if (!loading && !projects.length) {
    return null;
  }

  return (
    <section className="otb-panel rounded-lg p-4" data-testid="project-consumption-section">
      <DimensionHeader
        title="项目消耗"
        meta={loading ? <Skeleton className="h-3 w-16 align-middle" /> : `${projects.length} 个项目`}
      />
      <div className="mt-4 space-y-3">
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))
          : projects.map((project) => (
              <div key={`${project.rank}:${project.name}`} className="min-w-0">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-stone-500">#{project.rank}</span>
                      <p className="truncate text-sm font-semibold text-slate-950" title={project.name}>
                        {project.name}
                      </p>
                      {project.other ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          其他
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-stone-500">
                      {formatNumber(project.activeUsers)} 人参与 · 主力 {project.topModel}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold text-slate-950">{formatTokens(project.tokens)}</p>
                    <p className="mt-1 font-mono text-xs text-stone-500">{formatUsd(project.costUsd)}</p>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="otb-energy-bar h-full rounded-full"
                    style={{ width: `${Math.max(2, (project.tokens / maxTokens) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}

export function UsageDistributionPanel({
  loading,
  summary,
  viewer,
}: {
  loading: boolean;
  summary: TokenLeaderboardSummary;
  viewer: ViewerState | null;
}) {
  const distribution = summary.distribution;
  const buckets = distribution?.buckets ?? [];
  const viewerUser = findViewerUser(summary.users, viewer);
  const viewerTokens = viewerUser ? getTokenConsumptionTokens(viewerUser) : null;
  const viewerBucketKey = viewerTokens === null ? "" : buckets.find((bucket) => tokenInBucket(viewerTokens, bucket))?.key ?? "";
  const viewerPercentile = viewerTokens === null ? null : userPercentile(summary.users, viewerTokens);
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));

  if (!loading && !buckets.length) {
    return null;
  }

  return (
    <section className="otb-panel rounded-lg p-4" data-testid="usage-distribution-section">
      <DimensionHeader
        title="团队分布"
        meta={loading ? <Skeleton className="h-3 w-20 align-middle" /> : `${formatNumber(distribution?.totalUsers ?? 0)} 位活跃用户`}
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 rounded-lg border border-stone-950/10 bg-white p-3">
          {loading ? (
            <Skeleton className="h-44 w-full rounded-lg" />
          ) : (
            <DistributionSvg buckets={buckets} maxCount={maxCount} viewerBucketKey={viewerBucketKey} />
          )}
        </div>
        <div className="grid content-start gap-2 sm:grid-cols-4 lg:grid-cols-1">
          <PercentileTile label="P50" value={loading ? null : distribution?.percentiles.p50 ?? 0} />
          <PercentileTile label="P90" value={loading ? null : distribution?.percentiles.p90 ?? 0} />
          <PercentileTile label="P99" value={loading ? null : distribution?.percentiles.p99 ?? 0} />
          <div
            className={`rounded-lg border px-3 py-3 ${
              viewerPercentile === null
                ? "border-stone-950/10 bg-white"
                : "border-blue-600/25 bg-[var(--otb-energy-gradient-subtle)]"
            }`}
            data-testid="viewer-distribution-badge"
          >
            <p className="text-xs font-semibold text-stone-500">我的位置</p>
            <p className="mt-2 font-mono text-xl font-black text-slate-950">
              {loading ? <Skeleton className="h-6 w-16" /> : viewerPercentile === null ? "--" : `P${viewerPercentile}`}
            </p>
            <p className="mt-1 truncate text-xs text-stone-500">
              {viewerTokens === null ? "未匹配" : formatTokens(viewerTokens)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DimensionHeader({ title, meta }: { title: string; meta: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <span className="shrink-0 font-mono text-xs text-stone-500">{meta}</span>
    </div>
  );
}

function TeamDeltaBadge({ value }: { value: number | null }) {
  const tone =
    value === null || value === 0
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : value > 0
        ? "border-emerald-600/20 bg-emerald-50 text-emerald-700"
        : "border-red-600/20 bg-red-50 text-red-700";
  const label = value === null ? "新队" : value === 0 ? "持平" : `${value > 0 ? "↑" : "↓"} ${formatSignedPercent(value)}`;

  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className="otb-stat-number mt-1 truncate font-mono text-2xl font-black text-slate-950" title={value}>
        {value}
      </p>
    </div>
  );
}

function PercentileTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-stone-950/10 bg-white px-3 py-3">
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className="mt-2 font-mono text-xl font-black text-slate-950">
        {value === null ? <Skeleton className="h-6 w-16" /> : formatTokens(value)}
      </p>
    </div>
  );
}

function DistributionSvg({
  buckets,
  maxCount,
  viewerBucketKey,
}: {
  buckets: TokenLeaderboardSummary["distribution"]["buckets"];
  maxCount: number;
  viewerBucketKey: string;
}) {
  const width = 420;
  const height = 190;
  const chartTop = 18;
  const chartHeight = 104;
  const gap = 12;
  const barWidth = buckets.length ? (width - gap * (buckets.length - 1)) / buckets.length : width;

  return (
    <svg
      aria-label="团队用量分布直方图"
      className="block h-auto w-full"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line x1="0" x2={width} y1={chartTop + chartHeight} y2={chartTop + chartHeight} stroke="currentColor" strokeOpacity="0.12" />
      {buckets.map((bucket, index) => {
        const barHeight = Math.max(8, (bucket.count / maxCount) * chartHeight);
        const x = index * (barWidth + gap);
        const y = chartTop + chartHeight - barHeight;
        const active = bucket.key === viewerBucketKey;

        return (
          <g key={bucket.key}>
            <rect
              height={barHeight}
              rx="7"
              style={{ fill: active ? "var(--otb-energy-strong)" : "var(--otb-energy)" }}
              opacity={active ? 1 : 0.72}
              width={barWidth}
              x={x}
              y={y}
            />
            {active ? (
              <rect
                fill="none"
                height={barHeight + 8}
                rx="9"
                stroke="var(--otb-energy-strong)"
                strokeWidth="2"
                width={barWidth + 8}
                x={x - 4}
                y={y - 4}
              />
            ) : null}
            <text
              fill="currentColor"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
              fontSize="13"
              fontWeight="700"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={Math.max(12, y - 6)}
            >
              {bucket.count}
            </text>
            <text
              fill="currentColor"
              fontSize="12"
              opacity="0.64"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={chartTop + chartHeight + 24}
            >
              {bucket.label}
            </text>
            <text
              fill="currentColor"
              fontSize="11"
              opacity="0.48"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={chartTop + chartHeight + 43}
            >
              {formatPercent(bucket.share)}
            </text>
            {active ? (
              <text
                fill="var(--otb-energy-strong)"
                fontSize="12"
                fontWeight="800"
                textAnchor="middle"
                x={x + barWidth / 2}
                y={height - 6}
              >
                你
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function tokenInBucket(tokens: number, bucket: TokenLeaderboardSummary["distribution"]["buckets"][number]) {
  return tokens >= bucket.minTokens && (bucket.maxTokens === null ? true : tokens < bucket.maxTokens);
}

function findViewerUser(users: TokenLeaderboardUser[], viewer: ViewerState | null) {
  if (!viewer?.authenticated || !viewer.user) {
    return null;
  }

  const userId = viewer.user.userId?.toLowerCase();
  const login = viewer.user.githubLogin?.toLowerCase();
  const displayName = viewer.user.displayName?.toLowerCase();

  return (
    users.find((user) => userId && user.userId.toLowerCase() === userId) ??
    users.find((user) => login && [user.userId, user.displayName].some((value) => value.toLowerCase() === login)) ??
    users.find((user) => displayName && user.displayName.toLowerCase() === displayName) ??
    null
  );
}

function userPercentile(users: TokenLeaderboardUser[], tokens: number) {
  const values = users.map((user) => getTokenConsumptionTokens(user)).filter((value) => value > 0);
  if (!values.length) {
    return 0;
  }

  const usersAtOrBelow = values.filter((value) => value <= tokens).length;
  return Math.max(1, Math.min(100, Math.round((usersAtOrBelow / values.length) * 100)));
}

const championCardStyle: CSSProperties = {
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--otb-gold-soft) 82%, var(--surface)), color-mix(in srgb, var(--surface) 94%, transparent))",
  borderColor: "color-mix(in srgb, var(--otb-gold) 46%, transparent)",
};
