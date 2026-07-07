"use client";

import type { TokenDailyUsagePoint, TokenWrappedResponse } from "@open-token-board/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IsometricContributionGraph } from "@/components/profile/isometric-contribution-graph";
import { normalizeProfileLogin } from "@/components/profile/utils";
import { TokenBoardLogoMark } from "@/components/token-board-logo";
import { EmptyStateIllustration } from "@/components/token-leaderboard/shared-ui";
import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
  normalizeApiBaseUrl,
} from "@/components/token-leaderboard/utils";
import { useI18n } from "@/i18n";
import type { Dictionary } from "@/i18n/dictionaries";

type LoadState = "empty" | "error" | "loading" | "not-found" | "ready";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function WrappedClient({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { dict } = useI18n();
  const copy = dict.wrapped;
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
      setError(copy.states.apiMissing);
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
          throw new Error(copy.states.invalidShape);
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
          setError(fetchError instanceof Error ? fetchError.message : copy.states.readFailed);
        }
      });

    return () => {
      active = false;
    };
  }, [copy.states.apiMissing, copy.states.invalidShape, copy.states.readFailed, normalizedApiBaseUrl, requestedLogin, requestedPeriod]);

  if (state === "ready" && wrapped) {
    return <WrappedStory quickPeriods={quickPeriods} wrapped={wrapped} />;
  }

  return (
    <main className="min-h-[100svh] bg-[#fff8e7] text-[#171018] dark:bg-[#110a16] dark:text-[#fff8e7]">
      <WrappedTopBar login={requestedLogin} period={requestedPeriod} quickPeriods={quickPeriods} />
      <section className="mx-auto flex min-h-[100svh] max-w-4xl flex-col items-center justify-center px-5 py-24 text-center">
        {state === "loading" ? (
          <div className="w-full max-w-xl space-y-4" role="status" aria-label={copy.states.loadingAria}>
            <div className="otb-skeleton h-5 w-36 rounded-full bg-[#171018]/15 dark:bg-white/15" />
            <div className="otb-skeleton h-24 rounded-lg bg-[#171018]/15 dark:bg-white/15" />
            <div className="otb-skeleton h-40 rounded-lg bg-[#171018]/10 dark:bg-white/10" />
          </div>
        ) : (
          <div className="max-w-xl">
            <EmptyStateIllustration className="mx-auto h-32 w-44 text-[#e03a6f] dark:text-[#ff7aa7]" />
            <p className="font-mono text-xs font-semibold uppercase text-[#e03a6f] dark:text-[#ff7aa7]">
              Open Token Board Wrapped
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight text-[#171018] sm:text-6xl dark:text-[#fff8e7]">
              {emptyTitle(state, copy)}
            </h1>
            <p className="mt-5 text-base leading-7 text-[#5c4a50] dark:text-[#d8c9cf]">
              {emptyDescription(state, requestedLogin, requestedPeriod, error, copy)}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {requestedLogin ? (
                quickPeriodItems(quickPeriods, copy.periods).map((item) => (
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
                  {copy.states.findUser}
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
  const { dict, locale } = useI18n();
  const copy = dict.wrapped;
  const topModel = wrapped.topModels[0];
  const topProject = wrapped.topProjects[0];
  const periodLabel = formatWrappedPeriodLabel(wrapped.period.value, locale);

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#fff8e7] text-[#171018] dark:bg-[#110a16] dark:text-[#fff8e7]">
      <WrappedTopBar login={wrapped.user.login} period={wrapped.period.value} quickPeriods={quickPeriods} />
      <TokenPulseBackdrop />

      <StorySection accent="rose" eyebrow={`${periodLabel} · @${wrapped.user.githubLogin}`}>
        <div className="max-w-4xl">
          <h1 className="text-5xl font-black leading-[0.95] sm:text-7xl lg:text-8xl">
            {copy.story.opener}
          </h1>
          <p className="mt-6 break-words font-mono text-6xl font-black leading-none text-[#e03a6f] sm:text-8xl lg:text-9xl dark:text-[#ff7aa7]">
            {formatTokens(wrapped.totals.tokens)}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <SignalStat label={copy.story.rank} value={wrapped.ranking.rank ? `#${wrapped.ranking.rank}` : "--"} meta={`${wrapped.ranking.team} · ${dict.common.units.people(formatNumber(wrapped.ranking.totalUsers))}`} />
            <SignalStat label={copy.story.estimatedCost} value={formatUsd(wrapped.totals.costUsd)} meta={copy.story.notActualBill} />
            <SignalStat label={copy.story.sessions} value={formatNumber(wrapped.totals.sessions)} meta={copy.story.activeDaysMeta(formatNumber(wrapped.totals.activeDays))} />
          </div>
        </div>
      </StorySection>

      <StorySection accent="gold" eyebrow={copy.story.peakDay}>
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
          <div>
            <p className="text-lg font-semibold text-[#765e13] dark:text-[#ffe08a]">
              {wrapped.peakDay.date ? copy.story.peakDaySentence(formatDayLabel(wrapped.peakDay.date, locale)) : copy.story.noPeakDay}
            </p>
            <p className="mt-5 font-mono text-6xl font-black leading-none text-[#c58a00] sm:text-8xl dark:text-[#ffd45a]">
              {formatTokens(wrapped.peakDay.tokens)}
            </p>
            <p className="mt-6 max-w-2xl text-2xl font-black leading-tight sm:text-4xl">
              {wrapped.peakDay.tokens > 0 ? tokenMetaphor(wrapped.peakDay.tokens, copy.metaphors) : copy.story.quietRepo}
            </p>
          </div>
          <div className="rounded-lg border border-[#171018]/15 bg-white/55 p-4 shadow-[0_30px_80px_rgba(23,16,24,0.16)] backdrop-blur dark:border-white/15 dark:bg-white/10">
            <MiniDailyGraphic daily={wrapped.daily} mode="bars" />
          </div>
        </div>
      </StorySection>

      <StorySection accent="cyan" eyebrow={copy.story.mainConfig}>
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="text-4xl font-black leading-tight sm:text-6xl">
              {copy.story.mainModelTitle}
              <span className="mt-3 block break-words font-mono text-[#00a7a0] dark:text-[#6ff7ee]">
                {topModel?.name ?? "--"}
              </span>
            </h2>
            <p className="mt-5 text-xl font-semibold leading-8 text-[#3e5657] dark:text-[#c5f7f2]">
              {topModel ? copy.story.modelShare(formatPercent(topModel.share)) : copy.story.noModelPreference}
            </p>
          </div>
          <div className="space-y-5">
            <BreakdownBlock title={copy.story.topModels} items={wrapped.topModels} color="#00a7a0" />
            <BreakdownBlock title={copy.story.topProjects} items={wrapped.topProjects} color="#e03a6f" />
            <p className="text-sm font-semibold text-[#5c4a50] dark:text-[#d8c9cf]">
              {topProject ? copy.story.projectShare(topProject.name, formatPercent(topProject.share)) : copy.story.noProjectDistribution}
            </p>
          </div>
        </div>
      </StorySection>

      <StorySection accent="ink" eyebrow={copy.story.rhythmHonor}>
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)] lg:items-center">
          <div>
            <h2 className="text-4xl font-black leading-tight sm:text-6xl">
              {copy.story.rhythmTitle}
            </h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <SignalStat label={copy.story.activeDays} value={`${formatNumber(wrapped.totals.activeDays)}d`} meta={copy.story.activeDaysWindow(formatNumber(wrapped.period.days))} />
              <SignalStat label={copy.story.longestStreak} value={`${formatNumber(wrapped.streak.days)}d`} meta={formatDateRange(wrapped.streak.startDate, wrapped.streak.endDate, locale)} />
              <SignalStat label={copy.story.nightRatio} value={formatPercent(wrapped.night.ratio)} meta={copy.story.nightMeta(formatTokens(wrapped.night.tokens))} />
            </div>
            <WrappedIsometricPreview wrapped={wrapped} />
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
  const { dict } = useI18n();
  const items = quickPeriodItems(quickPeriods, dict.wrapped.periods);

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-[#171018]/10 bg-[#fff8e7]/82 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#110a16]/82">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-black">
          <TokenBoardLogoMark className="size-7 shrink-0" decorative />
          <span className="truncate">Open Token Board</span>
        </Link>
        <nav aria-label={dict.wrapped.periods.aria} className="flex gap-2 overflow-x-auto pb-1 sm:justify-end sm:pb-0">
          {items.map((item) => {
            const selected = item.period === period;
            return (
              <Link
                key={item.period}
                href={login ? wrappedHref(login, item.period) : "/wrapped/"}
                aria-current={selected ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold transition ${
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
  const { dict } = useI18n();
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
            {dict.common.states.noData}
          </p>
        )}
      </div>
    </section>
  );
}

function HonorStrip({ wrapped }: { wrapped: TokenWrappedResponse }) {
  const { dict, locale } = useI18n();
  const copy = dict.wrapped;
  const badges = wrapped.achievements.newBadges;
  const levelUps = wrapped.achievements.levelUps;
  const levelBefore = translateLevel(wrapped.achievements.levelBefore, dict);
  const levelAfter = translateLevel(wrapped.achievements.levelAfter, dict);

  return (
    <section className="rounded-lg border border-[#171018]/12 bg-white/60 p-5 backdrop-blur dark:border-white/12 dark:bg-white/10">
      <p className="text-sm font-black text-[#5c4a50] dark:text-[#d8c9cf]">{copy.story.newHonors}</p>
      <div className="mt-4 space-y-3">
        {levelUps.map((level) => (
          <div key={level.id} className="rounded-lg border border-[#171018]/10 bg-[#171018] p-3 text-white dark:border-white/10 dark:bg-[#fff8e7] dark:text-[#171018]">
            <p className="font-mono text-xs font-black">{copy.story.levelUp(translateLevel(level, dict).name)}</p>
            <p className="mt-1 text-xs opacity-70">{formatShortDateOnly(level.reachedAt, locale)}</p>
          </div>
        ))}
        {badges.map((badge) => {
          const translated = translateBadge(badge, dict);
          return (
            <div key={badge.id} className="rounded-lg border border-[#e03a6f]/25 bg-[#e03a6f]/10 p-3 dark:border-[#ff7aa7]/35 dark:bg-[#ff7aa7]/12">
              <p className="font-mono text-xs font-black">{translated.name}</p>
              <p className="mt-1 text-xs text-[#6d5b62] dark:text-[#d8c9cf]">{translated.description}</p>
            </div>
          );
        })}
        {!levelUps.length && !badges.length ? (
          <p className="rounded-lg border border-[#171018]/10 px-3 py-6 text-center text-sm font-semibold text-[#6d5b62] dark:border-white/10 dark:text-[#c8b8bf]">
            {copy.story.noNewHonor(levelBefore.name, levelAfter.name)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ShareSection({ wrapped }: { wrapped: TokenWrappedResponse }) {
  const { dict } = useI18n();
  const shareCopy = dict.wrapped.share;
  const [exporting, setExporting] = useState(false);
  const [include3d, setInclude3d] = useState(true);
  const [hint, setHint] = useState(shareCopy.initialHint);
  const [pageUrl, setPageUrl] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  useEffect(() => {
    setHint(shareCopy.initialHint);
  }, [shareCopy.initialHint]);

  const download = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");

    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `token-wrapped-${safeFileName(wrapped.user.login)}-${safeFileName(wrapped.period.value)}.png`;
      link.href = dataUrl;
      link.click();
      setHint(shareCopy.pngReady);
    } catch {
      setHint(shareCopy.pngFailed);
    } finally {
      setExporting(false);
    }
  }, [shareCopy.pngFailed, shareCopy.pngReady, wrapped.period.value, wrapped.user.login]);

  const copy = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setHint("");

    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      if (!blob || !navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("clipboard unsupported");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setHint(shareCopy.imageCopied);
    } catch {
      setHint(shareCopy.imageCopyUnsupported);
    } finally {
      setExporting(false);
    }
  }, [shareCopy.imageCopied, shareCopy.imageCopyUnsupported]);

  return (
    <section className="relative z-10 flex min-h-[100svh] snap-start items-center px-5 py-24 sm:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
        <div className="overflow-x-auto pb-2">
          <div ref={cardRef} className="w-[390px] max-w-full">
            <WrappedShareCard include3d={include3d} pageUrl={pageUrl} wrapped={wrapped} />
          </div>
        </div>
        <div>
          <p className="font-mono text-xs font-black uppercase text-[#e03a6f] dark:text-[#ff7aa7]">{shareCopy.eyebrow}</p>
          <h2 className="mt-4 text-4xl font-black leading-tight">{shareCopy.title}</h2>
          <div className="mt-6 space-y-3">
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#171018]/15 bg-white/60 px-4 text-sm font-black dark:border-white/15 dark:bg-white/10">
              <input
                type="checkbox"
                checked={include3d}
                onChange={(event) => setInclude3d(event.target.checked)}
                className="size-4 accent-[#e03a6f]"
              />
              <span>{shareCopy.include3d}</span>
            </label>
            <button
              type="button"
              onClick={download}
              disabled={exporting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#171018] px-5 text-sm font-black text-white transition hover:bg-[#e03a6f] disabled:opacity-60 dark:bg-[#fff8e7] dark:text-[#171018] dark:hover:bg-[#ffb0ca]"
            >
              {exporting ? dict.common.actions.generating : shareCopy.savePng}
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={exporting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#171018]/15 bg-white/60 px-5 text-sm font-black transition hover:border-[#e03a6f] hover:text-[#e03a6f] disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:hover:border-[#ff7aa7] dark:hover:text-[#ffb0ca]"
            >
              {shareCopy.copyImage}
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

function WrappedIsometricPreview({ wrapped }: { wrapped: TokenWrappedResponse }) {
  const { dict } = useI18n();
  const columns = Math.max(2, Math.ceil(wrapped.daily.length / 7));

  return (
    <div className="mt-6 rounded-lg border border-[#171018]/12 bg-white/60 p-4 shadow-[0_16px_42px_rgba(23,16,24,0.08)] backdrop-blur dark:border-white/12 dark:bg-white/10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black text-[#5c4a50] dark:text-[#d8c9cf]">{dict.wrapped.story.isometricTitle}</p>
          <p className="mt-1 text-xs font-semibold text-[#6d5b62] dark:text-[#c8b8bf]">{dict.wrapped.story.isometricMeta}</p>
        </div>
        <p className="font-mono text-xs font-black text-[#171018] dark:text-[#fff8e7]">{wrapped.period.value}</p>
      </div>
      <div className="mt-3 overflow-hidden">
        <IsometricContributionGraph
          ariaLabel={dict.wrapped.story.isometricAria}
          daily={wrapped.daily}
          emptyLabel={dict.common.states.noData}
          height={150}
          maxColumns={columns}
          minHeight={5}
          peakLabel={dict.wrapped.story.isometricPeak}
          quietLabel={dict.wrapped.story.isometricQuiet}
          showHoverLabel={false}
          variant="compact"
        />
      </div>
    </div>
  );
}

function WrappedShareCard({
  include3d,
  pageUrl,
  wrapped,
}: {
  include3d: boolean;
  pageUrl: string;
  wrapped: TokenWrappedResponse;
}) {
  const { dict, locale } = useI18n();
  const copy = dict.wrapped.share;
  const topModel = wrapped.topModels[0]?.name ?? "--";
  const topProject = wrapped.topProjects[0]?.name ?? "--";
  const periodLabel = formatWrappedPeriodLabel(wrapped.period.value, locale);
  const columns = Math.max(2, Math.ceil(wrapped.daily.length / 7));

  return (
    <article className="overflow-hidden rounded-lg bg-[#171018] p-5 text-[#fff8e7] shadow-2xl">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-black uppercase text-[#ff7aa7]">Token Wrapped</p>
          <h3 className="mt-2 truncate text-2xl font-black">{wrapped.user.displayName}</h3>
          <p className="mt-1 truncate font-mono text-xs text-[#c8b8bf]">@{wrapped.user.githubLogin} · {periodLabel}</p>
        </div>
        <div className="rounded-lg border border-[#ffd45a]/35 bg-[#ffd45a]/12 px-3 py-2 text-right">
          <p className="font-mono text-2xl font-black text-[#ffd45a]">{wrapped.ranking.rank ? `#${wrapped.ranking.rank}` : "--"}</p>
          <p className="text-[11px] text-[#fff1bd]">{wrapped.ranking.team}</p>
        </div>
      </header>

      <div className="mt-7">
        <p className="text-xs font-black text-[#c8b8bf]">{copy.totalUsage}</p>
        <p className="mt-2 break-words font-mono text-5xl font-black leading-none text-[#ff7aa7]">
          {formatTokens(wrapped.totals.tokens)}
        </p>
        <p className="mt-3 text-sm font-semibold text-[#d8c9cf]">
          {copy.cardStats(formatNumber(wrapped.totals.sessions), formatNumber(wrapped.totals.activeDays), formatUsd(wrapped.totals.costUsd))}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <ShareMetric label={copy.topModel} value={topModel} />
        <ShareMetric label={copy.topProject} value={topProject} />
        <ShareMetric label={copy.nightShare} value={formatPercent(wrapped.night.ratio)} />
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.06] p-3">
        {include3d ? (
          <IsometricContributionGraph
            ariaLabel={copy.daily3dAria}
            daily={wrapped.daily}
            emptyLabel={dict.common.states.noData}
            height={118}
            maxColumns={columns}
            minHeight={5}
            peakLabel={dict.wrapped.story.isometricPeak}
            quietLabel={dict.wrapped.story.isometricQuiet}
            showHoverLabel={false}
            variant="share"
          />
        ) : (
          <MiniDailyGraphic daily={wrapped.daily} mode={wrapped.daily.length > 70 ? "heatmap" : "bars"} />
        )}
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
  const { dict } = useI18n();
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const width = 320;
  const height = 104;
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (daily.length - 1)) / daily.length);

  return (
    <svg className="block h-28 w-full" role="img" aria-label={dict.wrapped.share.dailyBarsAria} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
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
  const { dict } = useI18n();
  const maxTokens = Math.max(1, ...daily.map((point) => point.tokens));
  const cell = 5;
  const gap = 1;
  const columns = Math.ceil(daily.length / 7);
  const width = columns * (cell + gap) - gap;
  const height = 7 * (cell + gap) - gap;

  return (
    <svg className="block h-24 w-full" role="img" aria-label={dict.wrapped.share.dailyHeatmapAria} viewBox={`0 0 ${width} ${height}`}>
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

function quickPeriodItems(quickPeriods: ReturnType<typeof buildQuickPeriods>, labels: Dictionary["wrapped"]["periods"]) {
  return [
    { label: labels.thisMonth, period: quickPeriods.thisMonth },
    { label: labels.lastMonth, period: quickPeriods.lastMonth },
    { label: labels.thisYear, period: quickPeriods.thisYear },
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

function tokenMetaphor(tokens: number, metaphors: Dictionary["wrapped"]["metaphors"]) {
  const variants = [
    metaphors.novel(formatCompact(Math.max(0.1, tokens / 900_000))),
    metaphors.spec(formatNumber(Math.max(1, Math.round(tokens / 260_000)))),
    metaphors.books(formatNumber(Math.max(1, Math.round(tokens / 180_000)))),
  ];

  return variants[Math.abs(Math.round(tokens)) % variants.length];
}

function formatDayLabel(value: string, locale: string) {
  const parsed = parseDay(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(parsed);
}

function formatDateRange(startDate: string | null, endDate: string | null, locale: string) {
  if (!startDate || !endDate || startDate === endDate) {
    return startDate ? formatDayLabel(startDate, locale) : "--";
  }

  return `${formatDayLabel(startDate, locale)} - ${formatDayLabel(endDate, locale)}`;
}

function formatShortDateOnly(value: string, locale: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatWrappedPeriodLabel(value: string, locale: string) {
  const monthMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (monthMatch) {
    return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC", year: "numeric" }).format(
      new Date(Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1))
    );
  }

  if (/^\d{4}$/.test(value)) {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric" }).format(
      new Date(Date.UTC(Number(value), 0, 1))
    );
  }

  return value;
}

function parseDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
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

function translateLevel<T extends { id: string; name: string }>(level: T, dict: Dictionary): T {
  const translated = dict.board.achievements.levels[level.id as keyof typeof dict.board.achievements.levels];
  return translated ? { ...level, name: translated.name } : level;
}

function translateBadge<T extends { description: string; id: string; name: string }>(badge: T, dict: Dictionary): T {
  const translated = dict.board.achievements.badges[badge.id as keyof typeof dict.board.achievements.badges];
  return translated ? { ...badge, description: translated.description, name: translated.name } : badge;
}

function emptyTitle(state: LoadState, copy: Dictionary["wrapped"]) {
  if (state === "not-found") return copy.states.notFoundTitle;
  if (state === "error") return copy.states.errorTitle;
  return copy.states.emptyTitle;
}

function emptyDescription(state: LoadState, login: string, period: string, error: string, copy: Dictionary["wrapped"]) {
  if (state === "not-found") return copy.states.notFoundDescription(login);
  if (state === "error") return error || copy.states.errorDescription;
  if (!login) return copy.states.missingLoginDescription;
  return copy.states.emptyDescription(login, period);
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
