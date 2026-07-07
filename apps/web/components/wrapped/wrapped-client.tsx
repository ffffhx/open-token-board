"use client";

import type { TokenDailyUsagePoint, TokenWrappedResponse } from "@open-token-board/core";
import { toBlob, toPng } from "html-to-image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizeProfileLogin } from "@/components/profile/utils";
import { TokenBoardLogoMark } from "@/components/token-board-logo";
import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
  normalizeApiBaseUrl,
} from "@/components/token-leaderboard/utils";

type LoadState = "empty" | "error" | "loading" | "not-found" | "ready";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function WrappedClient({ apiBaseUrl }: { apiBaseUrl: string }) {
  const searchParams = useSearchParams();
  const quickPeriods = useMemo(() => buildQuickPeriods(new Date()), []);
  const requestedLogin = normalizeProfileLogin(searchParams.get("login") || searchParams.get("user"));
  const requestedPeriod = normalizeWrappedPeriod(searchParams.get("period")) || quickPeriods.thisMonth;
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const [state, setState] = useState<LoadState>(requestedLogin ? "loading" : "empty");
  const [wrapped, setWrapped] = useState<TokenWrappedResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestedLogin) {
      setState("empty");
      setWrapped(null);
      setError("");
      return;
    }

    if (!normalizedApiBaseUrl) {
      setState("error");
      setWrapped(null);
      setError("未配置 Token Board API，无法读取 Wrapped。");
      return;
    }

    let active = true;
    const params = new URLSearchParams({ login: requestedLogin, period: requestedPeriod });
    setState("loading");
    setError("");

    fetch(`${normalizedApiBaseUrl}/api/usage/wrapped?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 404) {
          throw new WrappedNotFoundError();
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json() as Promise<TokenWrappedResponse>;
      })
      .then((payload) => {
        if (!isWrappedResponse(payload)) {
          throw new Error("后端返回格式不正确");
        }

        if (active) {
          setWrapped(payload);
          setState(payload.totals.tokens > 0 ? "ready" : "empty");
        }
      })
      .catch((fetchError) => {
        if (!active) {
          return;
        }

        setWrapped(null);
        if (fetchError instanceof WrappedNotFoundError) {
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
  }, [normalizedApiBaseUrl, requestedLogin, requestedPeriod]);

  if (state === "ready" && wrapped) {
    return <WrappedStory quickPeriods={quickPeriods} wrapped={wrapped} />;
  }

  return (
    <main className="min-h-[100svh] bg-[#fff8e7] text-[#171018] dark:bg-[#110a16] dark:text-[#fff8e7]">
      <WrappedTopBar login={requestedLogin} period={requestedPeriod} quickPeriods={quickPeriods} />
      <section className="mx-auto flex min-h-[100svh] max-w-4xl flex-col items-center justify-center px-5 py-24 text-center">
        {state === "loading" ? (
          <div className="w-full max-w-xl space-y-4" role="status" aria-label="正在加载 Wrapped">
            <div className="h-5 w-36 animate-pulse rounded-full bg-[#171018]/15 dark:bg-white/15" />
            <div className="h-24 animate-pulse rounded-lg bg-[#171018]/15 dark:bg-white/15" />
            <div className="h-40 animate-pulse rounded-lg bg-[#171018]/10 dark:bg-white/10" />
          </div>
        ) : (
          <div className="max-w-xl">
            <p className="font-mono text-xs font-semibold uppercase text-[#e03a6f] dark:text-[#ff7aa7]">
              Open Token Board Wrapped
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight text-[#171018] sm:text-6xl dark:text-[#fff8e7]">
              {emptyTitle(state)}
            </h1>
            <p className="mt-5 text-base leading-7 text-[#5c4a50] dark:text-[#d8c9cf]">
              {emptyDescription(state, requestedLogin, requestedPeriod, error)}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {requestedLogin ? (
                quickPeriodItems(quickPeriods).map((item) => (
                  <Link
                    key={item.period}
                    href={wrappedHref(requestedLogin, item.period)}
                    className="inline-flex min-h-11 items-center rounded-lg border border-[#171018]/15 bg-white/65 px-4 text-sm font-semibold transition hover:border-[#e03a6f] hover:text-[#e03a6f] dark:border-white/15 dark:bg-white/10 dark:hover:border-[#ff7aa7] dark:hover:text-[#ffb0ca]"
                  >
                    {item.label}
                  </Link>
                ))
              ) : (
                <Link
                  href="/board"
                  className="inline-flex min-h-11 items-center rounded-lg bg-[#171018] px-5 text-sm font-semibold text-white transition hover:bg-[#e03a6f] dark:bg-[#fff8e7] dark:text-[#171018] dark:hover:bg-[#ffb0ca]"
                >
                  去榜单找一个用户
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function WrappedStory({
  quickPeriods,
  wrapped,
}: {
  quickPeriods: ReturnType<typeof buildQuickPeriods>;
  wrapped: TokenWrappedResponse;
}) {
  const topModel = wrapped.topModels[0];
  const topProject = wrapped.topProjects[0];

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#fff8e7] text-[#171018] dark:bg-[#110a16] dark:text-[#fff8e7]">
      <WrappedTopBar login={wrapped.user.login} period={wrapped.period.value} quickPeriods={quickPeriods} />
      <TokenPulseBackdrop />

      <StorySection accent="rose" eyebrow={`${wrapped.period.label} · @${wrapped.user.githubLogin}`}>
        <div className="max-w-4xl">
          <h1 className="text-5xl font-black leading-[0.95] sm:text-7xl lg:text-8xl">
            你把这个周期烧成了
          </h1>
          <p className="mt-6 break-words font-mono text-6xl font-black leading-none text-[#e03a6f] sm:text-8xl lg:text-9xl dark:text-[#ff7aa7]">
            {formatTokens(wrapped.totals.tokens)}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <SignalStat label="团队排名" value={wrapped.ranking.rank ? `#${wrapped.ranking.rank}` : "--"} meta={`${wrapped.ranking.team} · ${formatNumber(wrapped.ranking.totalUsers)} 人`} />
            <SignalStat label="估算费用" value={formatUsd(wrapped.totals.costUsd)} meta="非实际账单" />
            <SignalStat label="会话数" value={formatNumber(wrapped.totals.sessions)} meta={`${formatNumber(wrapped.totals.activeDays)} 个活跃日`} />
          </div>
        </div>
      </StorySection>

      <StorySection accent="gold" eyebrow="峰值日">
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
          <div>
            <p className="text-lg font-semibold text-[#765e13] dark:text-[#ffe08a]">
              {wrapped.peakDay.date ? `${formatDayLabel(wrapped.peakDay.date)} 是最疯狂的一天` : "这个周期没有峰值日"}
            </p>
            <p className="mt-5 font-mono text-6xl font-black leading-none text-[#c58a00] sm:text-8xl dark:text-[#ffd45a]">
              {formatTokens(wrapped.peakDay.tokens)}
            </p>
            <p className="mt-6 max-w-2xl text-2xl font-black leading-tight sm:text-4xl">
              {wrapped.peakDay.tokens > 0 ? tokenMetaphor(wrapped.peakDay.tokens) : "安静得像刚新建的空仓库。"}
            </p>
          </div>
          <div className="rounded-lg border border-[#171018]/15 bg-white/55 p-4 shadow-[0_30px_80px_rgba(23,16,24,0.16)] backdrop-blur dark:border-white/15 dark:bg-white/10">
            <MiniDailyGraphic daily={wrapped.daily} mode="bars" />
          </div>
        </div>
      </StorySection>

      <StorySection accent="cyan" eyebrow="主力配置">
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="text-4xl font-black leading-tight sm:text-6xl">
              主力模型是
              <span className="mt-3 block break-words font-mono text-[#00a7a0] dark:text-[#6ff7ee]">
                {topModel?.name ?? "--"}
              </span>
            </h2>
            <p className="mt-5 text-xl font-semibold leading-8 text-[#3e5657] dark:text-[#c5f7f2]">
              {topModel ? `它吃掉了 ${formatPercent(topModel.share)} 的 token。` : "模型还没有形成偏好。"}
            </p>
          </div>
          <div className="space-y-5">
            <BreakdownBlock title="模型前三" items={wrapped.topModels} color="#00a7a0" />
            <BreakdownBlock title="项目前三" items={wrapped.topProjects} color="#e03a6f" />
            <p className="text-sm font-semibold text-[#5c4a50] dark:text-[#d8c9cf]">
              {topProject ? `项目火力集中在「${topProject.name}」，占 ${formatPercent(topProject.share)}。` : "项目还没有可展示的分布。"}
            </p>
          </div>
        </div>
      </StorySection>

      <StorySection accent="ink" eyebrow="节奏与荣誉">
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)] lg:items-center">
          <div>
            <h2 className="text-4xl font-black leading-tight sm:text-6xl">
              你不是偶尔出现，<br />你是在持续加热。
            </h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <SignalStat label="活跃天数" value={`${formatNumber(wrapped.totals.activeDays)}d`} meta={`${formatNumber(wrapped.period.days)} 天窗口`} />
              <SignalStat label="最长连续" value={`${formatNumber(wrapped.streak.days)}d`} meta={formatDateRange(wrapped.streak.startDate, wrapped.streak.endDate)} />
              <SignalStat label="深夜比例" value={formatPercent(wrapped.night.ratio)} meta={`0-6 点 · ${formatTokens(wrapped.night.tokens)}`} />
            </div>
          </div>
          <HonorStrip wrapped={wrapped} />
        </div>
      </StorySection>

      <ShareSection wrapped={wrapped} />
    </main>
  );
}

function WrappedTopBar({
  login,
  period,
  quickPeriods,
}: {
  login: string;
  period: string;
  quickPeriods: ReturnType<typeof buildQuickPeriods>;
}) {
  const items = quickPeriodItems(quickPeriods);

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-[#171018]/10 bg-[#fff8e7]/82 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#110a16]/82">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-black">
          <TokenBoardLogoMark className="size-7 shrink-0" decorative />
          <span className="truncate">Open Token Board</span>
        </Link>
        <nav aria-label="Wrapped 周期" className="flex gap-2 overflow-x-auto pb-1 sm:justify-end sm:pb-0">
          {items.map((item) => {
            const selected = item.period === period;
            return (
              <Link
                key={item.period}
                href={login ? wrappedHref(login, item.period) : "/wrapped/"}
                aria-current={selected ? "page" : undefined}
                className={`inline-flex min-h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold transition ${
                  selected
                    ? "border-[#171018] bg-[#171018] text-white dark:border-[#fff8e7] dark:bg-[#fff8e7] dark:text-[#171018]"
                    : "border-[#171018]/15 bg-white/55 text-[#4f4248] hover:border-[#e03a6f] hover:text-[#e03a6f] dark:border-white/15 dark:bg-white/10 dark:text-[#d8c9cf] dark:hover:border-[#ff7aa7] dark:hover:text-[#ffb0ca]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function StorySection({
  accent,
  children,
  eyebrow,
}: {
  accent: "cyan" | "gold" | "ink" | "rose";
  children: React.ReactNode;
  eyebrow: string;
}) {
  const accentClass = {
    cyan: "text-[#00a7a0] dark:text-[#6ff7ee]",
    gold: "text-[#c58a00] dark:text-[#ffd45a]",
    ink: "text-[#171018] dark:text-[#fff8e7]",
    rose: "text-[#e03a6f] dark:text-[#ff7aa7]",
  }[accent];

  return (
    <section className="relative z-10 flex min-h-[100svh] snap-start items-center px-5 py-24 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <p className={`font-mono text-xs font-black uppercase ${accentClass}`}>{eyebrow}</p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

function SignalStat({ label, meta, value }: { label: string; meta: string; value: string }) {
  return (
    <div className="min-h-28 rounded-lg border border-[#171018]/12 bg-white/60 p-4 shadow-[0_16px_42px_rgba(23,16,24,0.08)] backdrop-blur dark:border-white/12 dark:bg-white/10">
      <p className="text-xs font-black text-[#5c4a50] dark:text-[#d8c9cf]">{label}</p>
      <p className="mt-3 truncate font-mono text-3xl font-black" title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs font-semibold text-[#6d5b62] dark:text-[#c8b8bf]" title={meta}>
        {meta}
      </p>
    </div>
  );
}

function BreakdownBlock({
  color,
  items,
  title,
}: {
  color: string;
  items: Array<{ name: string; share: number; tokens: number }>;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[#171018]/12 bg-white/60 p-4 backdrop-blur dark:border-white/12 dark:bg-white/10">
      <h3 className="text-sm font-black">{title}</h3>
      <div className="mt-4 space-y-4">
        {items.length ? (
          items.map((item) => (
            <div key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate font-mono font-black" title={item.name}>
                  {item.name}
                </p>
                <p className="shrink-0 font-mono text-xs font-semibold">{formatTokens(item.tokens)}</p>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-[#171018]/10 dark:bg-white/12">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, item.share * 100)}%`, backgroundColor: color }} />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-[#171018]/10 px-3 py-5 text-center text-sm font-semibold text-[#6d5b62] dark:border-white/10 dark:text-[#c8b8bf]">
            暂无数据
          </p>
        )}
      </div>
    </section>
  );
}

function HonorStrip({ wrapped }: { wrapped: TokenWrappedResponse }) {
  const badges = wrapped.achievements.newBadges;
  const levelUps = wrapped.achievements.levelUps;

  return (
    <section className="rounded-lg border border-[#171018]/12 bg-white/60 p-5 backdrop-blur dark:border-white/12 dark:bg-white/10">
      <p className="text-sm font-black text-[#5c4a50] dark:text-[#d8c9cf]">本周期新荣誉</p>
      <div className="mt-4 space-y-3">
        {levelUps.map((level) => (
          <div key={level.id} className="rounded-lg border border-[#171018]/10 bg-[#171018] p-3 text-white dark:border-white/10 dark:bg-[#fff8e7] dark:text-[#171018]">
            <p className="font-mono text-xs font-black">升级到 {level.name}</p>
            <p className="mt-1 text-xs opacity-70">{formatShortDateOnly(level.reachedAt)}</p>
          </div>
        ))}
        {badges.map((badge) => (
          <div key={badge.id} className="rounded-lg border border-[#e03a6f]/25 bg-[#e03a6f]/10 p-3 dark:border-[#ff7aa7]/35 dark:bg-[#ff7aa7]/12">
            <p className="font-mono text-xs font-black">{badge.name}</p>
            <p className="mt-1 text-xs text-[#6d5b62] dark:text-[#d8c9cf]">{badge.description}</p>
          </div>
        ))}
        {!levelUps.length && !badges.length ? (
          <p className="rounded-lg border border-[#171018]/10 px-3 py-6 text-center text-sm font-semibold text-[#6d5b62] dark:border-white/10 dark:text-[#c8b8bf]">
            没有新徽章，但等级从 {wrapped.achievements.levelBefore.name} 走到了 {wrapped.achievements.levelAfter.name}。
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ShareSection({ wrapped }: { wrapped: TokenWrappedResponse }) {
  const [exporting, setExporting] = useState(false);
  const [hint, setHint] = useState("导出后发到群里，看看谁的周期更离谱。");
  const [pageUrl, setPageUrl] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  const download = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");

    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `token-wrapped-${safeFileName(wrapped.user.login)}-${safeFileName(wrapped.period.value)}.png`;
      link.href = dataUrl;
      link.click();
      setHint("PNG 已生成。");
    } catch {
      setHint("生成图片失败，可以直接对分享卡截图。");
    } finally {
      setExporting(false);
    }
  }, [wrapped.period.value, wrapped.user.login]);

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

  return (
    <section className="relative z-10 flex min-h-[100svh] snap-start items-center px-5 py-24 sm:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
        <div className="overflow-x-auto pb-2">
          <div ref={cardRef} className="w-[390px] max-w-full">
            <WrappedShareCard pageUrl={pageUrl} wrapped={wrapped} />
          </div>
        </div>
        <div>
          <p className="font-mono text-xs font-black uppercase text-[#e03a6f] dark:text-[#ff7aa7]">分享卡</p>
          <h2 className="mt-4 text-4xl font-black leading-tight">把这份 Wrapped 带走</h2>
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={download}
              disabled={exporting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#171018] px-5 text-sm font-black text-white transition hover:bg-[#e03a6f] disabled:opacity-60 dark:bg-[#fff8e7] dark:text-[#171018] dark:hover:bg-[#ffb0ca]"
            >
              {exporting ? "生成中…" : "保存 PNG"}
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={exporting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#171018]/15 bg-white/60 px-5 text-sm font-black transition hover:border-[#e03a6f] hover:text-[#e03a6f] disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:hover:border-[#ff7aa7] dark:hover:text-[#ffb0ca]"
            >
              复制图片
            </button>
          </div>
          <p className="mt-4 min-h-6 text-sm font-semibold leading-6 text-[#6d5b62] dark:text-[#c8b8bf]" aria-live="polite">
            {hint}
          </p>
        </div>
      </div>
    </section>
  );
}

function WrappedShareCard({ pageUrl, wrapped }: { pageUrl: string; wrapped: TokenWrappedResponse }) {
  const topModel = wrapped.topModels[0]?.name ?? "--";
  const topProject = wrapped.topProjects[0]?.name ?? "--";

  return (
    <article className="overflow-hidden rounded-lg bg-[#171018] p-5 text-[#fff8e7] shadow-2xl">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-black uppercase text-[#ff7aa7]">Token Wrapped</p>
          <h3 className="mt-2 truncate text-2xl font-black">{wrapped.user.displayName}</h3>
          <p className="mt-1 truncate font-mono text-xs text-[#c8b8bf]">@{wrapped.user.githubLogin} · {wrapped.period.label}</p>
        </div>
        <div className="rounded-lg border border-[#ffd45a]/35 bg-[#ffd45a]/12 px-3 py-2 text-right">
          <p className="font-mono text-2xl font-black text-[#ffd45a]">{wrapped.ranking.rank ? `#${wrapped.ranking.rank}` : "--"}</p>
          <p className="text-[11px] text-[#fff1bd]">{wrapped.ranking.team}</p>
        </div>
      </header>

      <div className="mt-7">
        <p className="text-xs font-black text-[#c8b8bf]">总消耗</p>
        <p className="mt-2 break-words font-mono text-5xl font-black leading-none text-[#ff7aa7]">
          {formatTokens(wrapped.totals.tokens)}
        </p>
        <p className="mt-3 text-sm font-semibold text-[#d8c9cf]">
          {formatNumber(wrapped.totals.sessions)} 会话 · {formatNumber(wrapped.totals.activeDays)} 活跃日 · {formatUsd(wrapped.totals.costUsd)}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <ShareMetric label="主力模型" value={topModel} />
        <ShareMetric label="最热项目" value={topProject} />
        <ShareMetric label="深夜占比" value={formatPercent(wrapped.night.ratio)} />
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.06] p-3">
        <MiniDailyGraphic daily={wrapped.daily} mode={wrapped.daily.length > 70 ? "heatmap" : "bars"} />
      </div>

      <footer className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-[11px] text-[#c8b8bf]">
        <span className="font-mono font-black">Open Token Board</span>
        <span className="truncate text-right" title={pageUrl}>
          {pageUrl || "open-token-board"}
        </span>
      </footer>
    </article>
  );
}

function ShareMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.06] p-2">
      <p className="text-[10px] font-semibold text-[#c8b8bf]">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-black" title={value}>
        {value}
      </p>
    </div>
  );
}

function MiniDailyGraphic({
  daily,
  mode,
}: {
  daily: TokenDailyUsagePoint[];
  mode: "bars" | "heatmap";
}) {
  if (!daily.length) {
    return <div className="h-24 rounded-lg border border-current/10" />;
  }

  if (mode === "heatmap") {
    return <MiniHeatmap daily={daily} />;
  }

  return <MiniBars daily={daily} />;
}

function MiniBars({ daily }: { daily: TokenDailyUsagePoint[] }) {
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const width = 320;
  const height = 104;
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (daily.length - 1)) / daily.length);

  return (
    <svg className="block h-28 w-full" role="img" aria-label="周期每日 token 柱状图" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {daily.map((point, index) => {
        const barHeight = point.tokens > 0 ? Math.max(3, (point.tokens / maxTokens) * (height - 8)) : 2;
        const x = index * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect key={point.date} fill={index % 2 ? "#00a7a0" : "#e03a6f"} height={barHeight} rx="2" width={barWidth} x={x} y={y}>
            <title>{`${point.date} · ${formatNumber(point.tokens)} tokens`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function MiniHeatmap({ daily }: { daily: TokenDailyUsagePoint[] }) {
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const cell = 5;
  const gap = 1;
  const columns = Math.ceil(daily.length / 7);
  const width = columns * (cell + gap) - gap;
  const height = 7 * (cell + gap) - gap;

  return (
    <svg className="block h-24 w-full" role="img" aria-label="周期每日 token 热力图" viewBox={`0 0 ${width} ${height}`}>
      {daily.map((point, index) => {
        const intensity = point.tokens / maxTokens;
        return (
          <rect
            key={point.date}
            fill={wrappedHeatColor(intensity)}
            height={cell}
            rx="1"
            width={cell}
            x={Math.floor(index / 7) * (cell + gap)}
            y={(index % 7) * (cell + gap)}
          >
            <title>{`${point.date} · ${formatNumber(point.tokens)} tokens`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function TokenPulseBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-55 mix-blend-multiply dark:opacity-35 dark:mix-blend-screen"
      preserveAspectRatio="none"
      viewBox="0 0 1000 1000"
    >
      {Array.from({ length: 9 }, (_, index) => {
        const y = 130 + index * 92;
        const offset = index * 41;
        return (
          <path
            key={index}
            d={`M-40 ${y} C ${130 + offset} ${y - 90}, ${210 + offset} ${y + 120}, ${360 + offset} ${y} S ${660 + offset} ${y - 130}, 1040 ${y + 20}`}
            fill="none"
            stroke={index % 3 === 0 ? "#e03a6f" : index % 3 === 1 ? "#00a7a0" : "#c58a00"}
            strokeLinecap="round"
            strokeOpacity="0.22"
            strokeWidth={index % 2 ? 4 : 7}
          />
        );
      })}
    </svg>
  );
}

function buildQuickPeriods(now: Date) {
  const parts = shanghaiParts(now);
  const thisMonth = `${parts.year}-${pad2(parts.month)}`;
  const lastMonthDate = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  const lastMonth = `${lastMonthDate.getUTCFullYear()}-${pad2(lastMonthDate.getUTCMonth() + 1)}`;

  return {
    thisMonth,
    lastMonth,
    thisYear: String(parts.year),
  };
}

function quickPeriodItems(quickPeriods: ReturnType<typeof buildQuickPeriods>) {
  return [
    { label: "本月", period: quickPeriods.thisMonth },
    { label: "上月", period: quickPeriods.lastMonth },
    { label: "今年", period: quickPeriods.thisYear },
  ];
}

function normalizeWrappedPeriod(value: string | null) {
  const text = value?.trim() || "";
  if (/^\d{4}$/.test(text) || /^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }
  return "";
}

function wrappedHref(login: string, period: string) {
  return `/wrapped/?login=${encodeURIComponent(login)}&period=${encodeURIComponent(period)}`;
}

function tokenMetaphor(tokens: number) {
  const variants = [
    `相当于把《红楼梦》读了 ${formatCompact(Math.max(0.1, tokens / 900_000))} 遍。`,
    `够把一份 20 万字需求文档来回喂给模型 ${formatNumber(Math.max(1, Math.round(tokens / 260_000)))} 轮。`,
    `差不多能塞进 ${formatNumber(Math.max(1, Math.round(tokens / 180_000)))} 本 300 页技术书草稿。`,
  ];

  return variants[Math.abs(Math.round(tokens)) % variants.length];
}

function formatDayLabel(value: string) {
  const [, month, day] = value.split("-");
  return month && day ? `${Number(month)} 月 ${Number(day)} 日` : value;
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate || startDate === endDate) {
    return startDate ? formatDayLabel(startDate) : "--";
  }

  return `${formatDayLabel(startDate)} - ${formatDayLabel(endDate)}`;
}

function formatShortDateOnly(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function shanghaiParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function wrappedHeatColor(intensity: number) {
  if (intensity <= 0) return "#2a202b";
  if (intensity < 0.25) return "#59354a";
  if (intensity < 0.5) return "#e03a6f";
  if (intensity < 0.75) return "#00a7a0";
  return "#ffd45a";
}

function emptyTitle(state: LoadState) {
  if (state === "not-found") return "没有找到这个用户";
  if (state === "error") return "Wrapped 加载失败";
  return "这个周期还没点火";
}

function emptyDescription(state: LoadState, login: string, period: string, error: string) {
  if (state === "not-found") return `当前后端没有 @${login || "该用户"} 的公开 token 记录。`;
  if (state === "error") return error || "请稍后刷新再试。";
  if (!login) return "请从公开主页或榜单进入，或在地址栏使用 /wrapped?login=github_login。";
  return `@${login} 在 ${period} 暂时没有可生成 Wrapped 的记录。`;
}

function safeFileName(name: string) {
  return name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "wrapped";
}

function isWrappedResponse(value: unknown): value is TokenWrappedResponse {
  const payload = value as Partial<TokenWrappedResponse>;

  return (
    Boolean(value) &&
    typeof value === "object" &&
    Boolean(payload.user) &&
    Boolean(payload.period) &&
    Boolean(payload.totals) &&
    Boolean(payload.ranking) &&
    Array.isArray(payload.daily) &&
    Array.isArray(payload.topModels) &&
    Array.isArray(payload.topProjects)
  );
}

class WrappedNotFoundError extends Error {}
