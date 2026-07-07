"use client";

import { toBlob, toPng } from "html-to-image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TokenDailyUsagePoint } from "@open-token-board/core";
import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogoMark } from "@/components/token-board-logo";
import { EmptyStatePanel, Icon, LoadingSpinner, Skeleton } from "@/components/token-leaderboard/shared-ui";
import {
  formatNumber,
  formatPercent,
  formatShortDate,
  formatTokens,
  formatUsd,
  normalizeApiBaseUrl,
} from "@/components/token-leaderboard/utils";

import type { PublicProfileNamedUsage, PublicProfileResponse } from "./types";
import { normalizeProfileLogin } from "./utils";

type LoadState = "empty" | "error" | "loading" | "not-found" | "ready";

const RANGE_LABELS = {
  "1D": "24 小时",
  "7D": "7 天",
  "30D": "30 天",
  "90D": "90 天",
  week: "本周",
  month: "本月",
  lastweek: "上周",
  lastmonth: "上月",
};

export function PublicProfileClient({ apiBaseUrl }: { apiBaseUrl: string }) {
  const searchParams = useSearchParams();
  const requestedLogin = normalizeProfileLogin(searchParams.get("login") || searchParams.get("user"));
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const [state, setState] = useState<LoadState>(requestedLogin ? "loading" : "empty");
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestedLogin) {
      setProfile(null);
      setState("empty");
      setError("");
      return;
    }

    if (!normalizedApiBaseUrl) {
      setProfile(null);
      setState("error");
      setError("未配置 Token Board API，无法读取公开个人主页。");
      return;
    }

    let active = true;
    setState("loading");
    setError("");

    fetch(`${normalizedApiBaseUrl}/api/usage/user?login=${encodeURIComponent(requestedLogin)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 404) {
          throw new PublicProfileNotFoundError();
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json() as Promise<PublicProfileResponse>;
      })
      .then((payload) => {
        if (!isPublicProfileResponse(payload)) {
          throw new Error("后端返回格式不正确");
        }

        if (active) {
          setProfile(payload);
          setState("ready");
        }
      })
      .catch((fetchError) => {
        if (!active) {
          return;
        }

        setProfile(null);
        if (fetchError instanceof PublicProfileNotFoundError) {
          setState("not-found");
          setError("");
        } else {
          setState("error");
          setError(fetchError instanceof Error ? fetchError.message : "读取失败");
        }
      });

    return () => {
      active = false;
    };
  }, [normalizedApiBaseUrl, requestedLogin]);

  return (
    <main className="mx-auto min-h-[100svh] max-w-7xl px-4 py-6 font-sans text-slate-950 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
          <TokenBoardLogoMark className="size-7 shrink-0" decorative />
          <span className="truncate">Open Token Board</span>
        </Link>
        <AppNavLinks active="board" className="justify-start sm:justify-end" />
      </header>

      {state === "ready" && profile ? (
        <ProfileDashboard apiBaseUrl={normalizedApiBaseUrl} profile={profile} />
      ) : state === "loading" ? (
        <ProfileLoading />
      ) : (
        <ProfileEmpty
          title={
            state === "empty"
              ? "缺少 GitHub login"
              : state === "not-found"
                ? "没有找到这个用户的上报数据"
                : "公开个人主页加载失败"
          }
          description={
            state === "empty"
              ? "请从榜单用户名进入，或在地址栏使用 /u?login=github_login。"
              : state === "not-found"
                ? `当前后端没有 @${requestedLogin || "该用户"} 的公开 token 记录。`
                : error || "请稍后刷新再试。"
          }
        />
      )}
    </main>
  );
}

function ProfileDashboard({ apiBaseUrl, profile }: { apiBaseUrl: string; profile: PublicProfileResponse }) {
  const [shareVisible, setShareVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hint, setHint] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const profileData = profile.profile;
  const totals = profileData.totals;
  const daily30 = profileData.daily365.slice(-30);
  const primaryRanking =
    profileData.rankings.find((ranking) => ranking.range === "30D") ??
    profileData.rankings.find((ranking) => ranking.rank !== null) ??
    profileData.rankings[0];
  const topModel = profileData.models[0]?.name ?? "--";
  const topTool = profileData.tools[0]?.name ?? "--";
  const cacheHitRate = totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0;
  const peakDay = profileData.daily365.reduce<TokenDailyUsagePoint | null>(
    (best, point) => (!best || point.tokens > best.tokens ? point : best),
    null
  );

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  const showShareCard = useCallback(() => {
    setShareVisible(true);
    setHint("分享卡已生成，可以保存为 PNG。");
  }, []);

  const download = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");

    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `token-profile-${safeFileName(profile.user.login)}.png`;
      link.href = dataUrl;
      link.click();
      setHint("PNG 已生成。");
    } catch {
      setHint("生成图片失败，可以直接对分享卡截图。");
    } finally {
      setExporting(false);
    }
  }, [profile.user.login]);

  const copy = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");

    try {
      const blob = await toBlob(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      if (!blob || !navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("clipboard unsupported");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setHint("已复制图片。");
    } catch {
      setHint("当前浏览器不支持复制图片，请改用保存 PNG。");
    } finally {
      setExporting(false);
    }
  }, []);

  const copyBadgeMarkdown = useCallback(async () => {
    const badgeUrl = `${apiBaseUrl}/api/badge?login=${encodeURIComponent(profile.user.login)}&style=weekly`;
    const targetUrl = pageUrl || `/u?login=${encodeURIComponent(profile.user.login)}`;
    const markdown = `[![Open Token Board](${badgeUrl})](${targetUrl})`;

    try {
      await navigator.clipboard.writeText(markdown);
      setHint("已复制徽章 Markdown。");
    } catch {
      setHint("当前浏览器不支持复制文本，请稍后重试。");
    }
  }, [apiBaseUrl, pageUrl, profile.user.login]);

  return (
    <div className="space-y-5 py-6">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <img
              alt=""
              className="size-16 shrink-0 rounded-lg border border-slate-200 bg-slate-50"
              height={64}
              src={profile.user.avatarUrl}
              width={64}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-xs font-semibold text-blue-700">
                  @{profile.user.githubLogin}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {profile.user.team || "GitHub"}
                </span>
              </div>
              <h1 className="mt-3 truncate text-3xl font-semibold leading-tight text-slate-950">
                {profile.user.displayName}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {profileData.joinedAt ? `加入统计 ${formatShortDate(profileData.joinedAt)}` : "等待更多统计"}
                {profileData.lastReportedAt ? ` · 最近上报 ${formatShortDate(profileData.lastReportedAt)}` : ""}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {profileData.rankings.map((ranking) => (
              <RankBadge key={ranking.range} ranking={ranking} />
            ))}
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <p className="text-sm text-slate-600">
              主力模型 <span className="font-mono font-semibold text-slate-950">{topModel}</span>
              <span className="mx-2 text-slate-300">/</span>
              常用工具 <span className="font-mono font-semibold text-slate-950">{topTool}</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[34rem]">
              <button
                type="button"
                onClick={showShareCard}
                className="otb-energy-bg inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <Icon name="download" />
                生成分享卡
              </button>
              <button
                type="button"
                onClick={copyBadgeMarkdown}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-600/20 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-600/35 hover:bg-blue-50 hover:shadow-md"
              >
                <Icon name="copy" />
                复制徽章
              </button>
              <Link
                href={`/wrapped/?login=${encodeURIComponent(profile.user.login)}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-800 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100 hover:shadow-md"
              >
                查看 Wrapped
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProfileStat label="总消耗 Token" meta="加入以来" tone="ink" value={formatTokens(totals.tokens)} />
        <ProfileStat label="估算费用" meta="非实际账单" tone="gold" value={formatUsd(totals.costUsd)} />
        <ProfileStat label="活跃天数" meta={`${formatNumber(totals.records)} 条记录`} tone="green" value={`${formatNumber(totals.activeDays)}d`} />
        <ProfileStat
          label="会话数"
          meta={`读缓存 ${formatPercent(cacheHitRate)} · 写 ${formatTokens(totals.cacheCreationInputTokens)}`}
          tone="blue"
          value={formatNumber(totals.sessions)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <ContributionHeatmap daily={profileData.daily365} />
        <DailyUsageBars daily={daily30} peakDay={peakDay} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <BreakdownPanel title="模型分布" items={profileData.models} meta={`${profileData.models.length} 个模型`} />
        <BreakdownPanel title="工具分布" items={profileData.tools} meta={`${profileData.tools.length} 个工具`} />
      </div>

      {shareVisible ? (
        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center">
          <div className="overflow-x-auto">
            <div ref={cardRef} className="w-fit">
              <ProfileShareCard
                daily={profileData.daily365}
                pageUrl={pageUrl}
                peakDay={peakDay}
                primaryRanking={primaryRanking}
                profile={profile}
              />
            </div>
          </div>
          <div className="space-y-3">
            <button
              type="button"
              onClick={download}
              disabled={exporting}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:opacity-60"
            >
              {exporting ? <LoadingSpinner tone="light" /> : <Icon name="download" />}
              保存 PNG
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={exporting}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
            >
              复制图片
            </button>
            <p className="min-h-5 text-sm leading-6 text-slate-500" aria-live="polite">
              {hint}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RankBadge({ ranking }: { ranking: PublicProfileResponse["profile"]["rankings"][number] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{RANGE_LABELS[ranking.range]}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-slate-950">
        {ranking.rank ? `#${ranking.rank}` : "--"}
        <span className="ml-1 text-sm text-slate-400">/ {formatNumber(ranking.totalUsers)}</span>
      </p>
      <p className="mt-1 truncate text-xs text-blue-600">{formatTokens(ranking.tokens)}</p>
    </div>
  );
}

function ProfileStat({
  label,
  meta,
  tone,
  value,
}: {
  label: string;
  meta: string;
  tone: "blue" | "gold" | "green" | "ink";
  value: string;
}) {
  const tones = {
    blue: "border-sky-600/18 bg-sky-50 text-sky-900",
    gold: "border-amber-600/18 bg-amber-50 text-amber-900",
    green: "border-emerald-600/18 bg-emerald-50 text-emerald-900",
    ink: "border-slate-950 bg-slate-950 text-white",
  };

  return (
    <div className={`min-h-32 rounded-lg border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase opacity-65">{label}</p>
      <p className="mt-5 truncate font-mono text-3xl font-semibold leading-none" title={value}>
        {value}
      </p>
      <p className="mt-3 truncate text-xs opacity-60" title={meta}>
        {meta}
      </p>
    </div>
  );
}

function ContributionHeatmap({ daily }: { daily: TokenDailyUsagePoint[] }) {
  const [hovered, setHovered] = useState<{ date: string; tokens: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => buildContributionCells(daily), [daily]);
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const monthLabels = useMemo(() => buildMonthLabels(cells), [cells]);
  const cellSize = 11;
  const gap = 3;
  const left = 30;
  const top = 22;
  const width = left + 53 * (cellSize + gap) - gap;
  const height = top + 7 * (cellSize + gap) - gap;
  const weekdays = ["", "周一", "", "周三", "", "周五", ""];

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollLeft = node.scrollWidth;
    }
  }, [cells.length]);

  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">年度贡献热力图</h2>
          <p className="mt-1 text-xs text-slate-500">近 365 天 · Asia/Shanghai</p>
        </div>
        <div className="min-h-6 text-right font-mono text-xs text-slate-500">
          {hovered ? `${hovered.date} · ${formatTokens(hovered.tokens)}` : "少 → 多"}
        </div>
      </div>
      <div ref={scrollRef} className="mt-4 max-w-full overflow-x-auto pb-1">
        <svg
          aria-label="近 365 天 Token 用量热力图"
          className="block"
          height={height}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
        >
          {monthLabels.map((label) => (
            <text key={`${label.month}-${label.x}`} fill="var(--color-slate-500)" fontSize="10" x={left + label.x} y="10">
              {label.month}
            </text>
          ))}
          {weekdays.map((weekday, index) => (
            <text key={`${weekday}-${index}`} fill="var(--color-slate-500)" fontSize="10" textAnchor="end" x="24" y={top + index * (cellSize + gap) + 9}>
              {weekday}
            </text>
          ))}
          {cells.map((cell) => {
            const x = left + cell.week * (cellSize + gap);
            const y = top + cell.weekday * (cellSize + gap);
            const level = heatLevel(cell.tokens, maxTokens);

            return (
              <rect
                key={cell.date}
                fill={heatColor(level)}
                height={cellSize}
                onBlur={() => setHovered(null)}
                onFocus={() => setHovered({ date: cell.date, tokens: cell.tokens })}
                onMouseEnter={() => setHovered({ date: cell.date, tokens: cell.tokens })}
                onMouseLeave={() => setHovered(null)}
                rx="2"
                tabIndex={0}
                width={cellSize}
                x={x}
                y={y}
              >
                <title>{`${cell.date} · ${formatNumber(cell.tokens)} tokens`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-slate-500">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className="size-3 rounded-[3px] border border-slate-200" style={{ backgroundColor: heatColor(level) }} />
        ))}
        <span>多</span>
      </div>
    </section>
  );
}

function DailyUsageBars({ daily, peakDay }: { daily: TokenDailyUsagePoint[]; peakDay: TokenDailyUsagePoint | null }) {
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">近 30 天趋势</h2>
          <p className="mt-1 text-xs text-slate-500">
            峰值 {peakDay ? `${peakDay.date.slice(5)} · ${formatTokens(peakDay.tokens)}` : "--"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid h-64 grid-cols-[repeat(30,minmax(5px,1fr))] items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 pb-3 pt-5">
        {daily.map((point, index) => {
          const isLatest = index === daily.length - 1;
          return (
            <span key={point.date} className="flex h-full min-w-0 items-end" title={`${point.date} · ${formatNumber(point.tokens)} tokens`}>
              <span
                className={`block w-full rounded-t-[3px] ${isLatest ? "bg-amber-500" : "bg-blue-600"}`}
                style={{ height: `${Math.max(2, (point.tokens / maxTokens) * 100)}%` }}
              />
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs text-slate-500">
        <span>{daily[0]?.date.slice(5) ?? "--"}</span>
        <span>{daily.at(-1)?.date.slice(5) ?? "--"}</span>
      </div>
    </section>
  );
}

function BreakdownPanel({
  items,
  meta,
  title,
}: {
  items: PublicProfileNamedUsage[];
  meta: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="font-mono text-xs text-slate-500">{meta}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate font-medium text-slate-800" title={item.name}>
                  {item.name}
                </p>
                <p className="shrink-0 font-mono text-slate-500">{formatTokens(item.tokens)}</p>
              </div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, item.share * 100)}%` }} />
                </div>
                <p className="truncate text-right text-xs text-slate-500">{formatPercent(item.share)}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            暂无数据
          </p>
        )}
      </div>
    </section>
  );
}

function ProfileShareCard({
  daily,
  pageUrl,
  peakDay,
  primaryRanking,
  profile,
}: {
  daily: TokenDailyUsagePoint[];
  pageUrl: string;
  peakDay: TokenDailyUsagePoint | null;
  primaryRanking: PublicProfileResponse["profile"]["rankings"][number] | undefined;
  profile: PublicProfileResponse;
}) {
  const totals = profile.profile.totals;
  const rankLabel = primaryRanking?.rank ? `#${primaryRanking.rank}` : "--";

  return (
    <article className="w-[720px] overflow-hidden rounded-lg bg-slate-950 p-6 text-white shadow-2xl">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenBoardLogoMark className="size-8 shrink-0" decorative />
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{profile.user.displayName}</p>
            <p className="font-mono text-xs text-blue-300">@{profile.user.githubLogin}</p>
          </div>
        </div>
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-right">
          <p className="font-mono text-3xl font-semibold text-amber-200">{rankLabel}</p>
          <p className="text-xs text-amber-100/70">{primaryRanking ? RANGE_LABELS[primaryRanking.range] : "当前排名"}</p>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_16rem] gap-5">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">累计消耗</p>
          <p className="mt-2 font-mono text-5xl font-semibold leading-none">{formatTokens(totals.tokens)}</p>
          <p className="mt-2 text-sm text-slate-400">
            {formatNumber(totals.sessions)} sessions · {formatNumber(totals.activeDays)} active days · {formatUsd(totals.costUsd)}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <ShareMetric label="主力模型" value={profile.profile.models[0]?.name ?? "--"} />
            <ShareMetric label="常用工具" value={profile.profile.tools[0]?.name ?? "--"} />
            <ShareMetric label="峰值日期" value={peakDay ? peakDay.date.slice(5) : "--"} />
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs font-semibold text-slate-400">年度热力图</p>
          <div className="mt-3">
            <ContributionHeatmapMini daily={daily} />
          </div>
        </div>
      </div>

      <footer className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-slate-400">
        <span className="font-mono">Open Token Board</span>
        <span className="max-w-[32rem] truncate text-right" title={pageUrl}>
          {pageUrl || "open-token-board"}
        </span>
      </footer>
    </article>
  );
}

function ShareMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-white" title={value}>
        {value}
      </p>
    </div>
  );
}

function ContributionHeatmapMini({ daily }: { daily: TokenDailyUsagePoint[] }) {
  const cells = buildContributionCells(daily);
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const cellSize = 4;
  const gap = 1;
  const width = 53 * (cellSize + gap) - gap;
  const height = 7 * (cellSize + gap) - gap;

  return (
    <svg aria-hidden="true" className="block w-full" height={height} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      {cells.map((cell) => (
        <rect
          key={cell.date}
          fill={heatColor(heatLevel(cell.tokens, maxTokens))}
          height={cellSize}
          rx="1"
          width={cellSize}
          x={cell.week * (cellSize + gap)}
          y={cell.weekday * (cellSize + gap)}
        />
      ))}
    </svg>
  );
}

function ProfileLoading() {
  return (
    <div className="space-y-5 py-6" role="status" aria-label="正在加载公开个人主页">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}

function ProfileEmpty({ description, title }: { description: string; title: string }) {
  return (
    <section className="mx-auto mt-10 max-w-2xl">
      <EmptyStatePanel
        title={title}
        description={description}
        action={
          <Link
            href="/board"
            className="otb-energy-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            返回榜单
          </Link>
        }
      />
    </section>
  );
}

class PublicProfileNotFoundError extends Error {}

function isPublicProfileResponse(value: unknown): value is PublicProfileResponse {
  const payload = value as Partial<PublicProfileResponse>;

  return (
    Boolean(value) &&
    typeof value === "object" &&
    Boolean(payload.user) &&
    Boolean(payload.profile) &&
    Array.isArray(payload.profile?.daily365) &&
    Array.isArray(payload.profile?.rankings) &&
    Array.isArray(payload.profile?.models) &&
    Array.isArray(payload.profile?.tools)
  );
}

type ContributionCell = {
  date: string;
  tokens: number;
  week: number;
  weekday: number;
};

function buildContributionCells(daily: TokenDailyUsagePoint[]): ContributionCell[] {
  const values = new Map(daily.map((point) => [point.date, point.tokens]));
  const lastDate = parseDayKey(daily.at(-1)?.date) ?? startOfUtcDay(new Date());
  const gridEnd = addDays(lastDate, 6 - lastDate.getUTCDay());
  const gridStart = addDays(gridEnd, -370);
  const cells: ContributionCell[] = [];

  for (let week = 0; week < 53; week += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(gridStart, week * 7 + weekday);
      const key = toDayKey(date);
      cells.push({
        date: key,
        tokens: values.get(key) ?? 0,
        week,
        weekday,
      });
    }
  }

  return cells;
}

function buildMonthLabels(cells: ContributionCell[]) {
  const labels: Array<{ month: string; x: number }> = [];
  const seen = new Set<string>();
  const cellStep = 14;

  for (const cell of cells) {
    if (cell.weekday !== 0) {
      continue;
    }

    const date = parseDayKey(cell.date);
    if (!date) {
      continue;
    }

    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (seen.has(monthKey) || date.getUTCDate() > 7) {
      continue;
    }

    seen.add(monthKey);
    labels.push({
      month: `${date.getUTCMonth() + 1}月`,
      x: cell.week * cellStep,
    });
  }

  return labels;
}

function heatLevel(tokens: number, maxTokens: number) {
  if (tokens <= 0) return 0;
  const ratio = tokens / Math.max(1, maxTokens);
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function heatColor(level: number) {
  return [
    "var(--color-slate-100)",
    "var(--color-emerald-100)",
    "var(--color-emerald-300)",
    "var(--color-emerald-500)",
    "var(--color-emerald-700)",
  ][level] ?? "var(--color-slate-100)";
}

function parseDayKey(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toDayKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function safeFileName(name: string) {
  return name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "profile";
}
