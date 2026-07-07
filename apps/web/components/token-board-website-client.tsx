"use client";

import Link from "next/link";

import { AppNavLinks } from "@/components/app-nav-links";
import { LandingCommandCopy, LandingLiveNumbers } from "@/components/landing-interactions";
import { TokenBoardLogo } from "@/components/token-board-logo";
import { useI18n } from "@/i18n";

const NPX_INSTALL_COMMAND = "npx --yes token-board-agent install";
const NPX_STATUS_COMMAND = "npx --yes token-board-agent status";
const NPX_UNINSTALL_COMMAND = "npx --yes token-board-agent uninstall";

export type HeroStats = {
  activeUsers: number;
  leaderName: string;
  leaderTokens: number;
  topModel: string;
  totalTokens: number;
};

export function TokenBoardWebsiteClient({ stats }: { stats: HeroStats | null }) {
  const { dict } = useI18n();
  const landing = dict.landing;
  const workflowCommands = [NPX_INSTALL_COMMAND, NPX_STATUS_COMMAND, NPX_UNINSTALL_COMMAND];

  return (
    <main className="min-w-0 bg-slate-100 text-slate-950">
      <HeroSection stats={stats} />

      <section id="capabilities" className="border-y border-slate-200 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase text-blue-600">{landing.capabilities.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{landing.capabilities.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{landing.capabilities.description}</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {landing.capabilities.cards.map((card) => (
              <article key={card.title} className="otb-card-hover overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
                <FeaturePreview variant={card.preview as "profile" | "rank" | "sync"} />
                <div className="p-5">
                  <p className="font-mono text-xs text-blue-600">{card.meta}</p>
                  <h3 className="mt-4 text-lg font-semibold">{card.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{card.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">{landing.workflow.eyebrow}</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{landing.workflow.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{landing.workflow.description}</p>
            </div>
            <Link
              href="/board"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              {landing.workflow.openBoard}
            </Link>
          </div>

          <div className="mt-8 grid gap-4">
            {landing.workflow.steps.map((step, index) => (
              <article key={step.title} className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:p-6">
                <div className="flex size-14 items-center justify-center rounded-lg bg-blue-600 font-mono text-base font-semibold text-white">
                  {step.eyebrow}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-base font-semibold">{step.title}</h3>
                    <span className="font-mono text-xs text-blue-600">{step.commandLabel}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
                  <pre className="mt-4 rounded-lg bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100">
                    <code className="block whitespace-pre-wrap break-all">{workflowCommands[index]}</code>
                  </pre>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="border-y border-slate-200 bg-slate-950 px-4 py-14 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-blue-300">{landing.privacy.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{landing.privacy.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{landing.privacy.description}</p>
          </div>

          <div className="grid gap-3">
            {landing.privacy.items.map((item) => (
              <div key={item} className="rounded-lg border border-white/10 bg-white/6 px-4 py-3 text-sm leading-6 text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroSection({ stats }: { stats: HeroStats | null }) {
  const { dict } = useI18n();
  const hero = dict.landing.hero;

  return (
    <section className="relative min-h-[82svh] overflow-hidden bg-slate-950 text-white">
      <HeroDashboardScene />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.92),rgba(15,23,42,0.72)_48%,rgba(15,23,42,0.88))]" />

      <nav className="relative z-10 mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link href="/" className="text-white">
          <TokenBoardLogo />
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <a href="#capabilities" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white lg:inline-flex">
            {hero.capabilities}
          </a>
          <a href="#privacy" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white lg:inline-flex">
            {hero.privacy}
          </a>
          <AppNavLinks active="home" hideHome theme="dark" />
        </div>
      </nav>

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-10 pt-14 sm:px-6 sm:pt-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(26rem,0.72fr)] lg:items-end">
          <div className="max-w-4xl">
            <p className="font-mono text-xs font-semibold uppercase text-blue-200">{hero.eyebrow}</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.96] sm:text-7xl lg:text-8xl">Open Token Board</h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-slate-100 sm:text-xl">{hero.tagline}</p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">{hero.description}</p>
            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-[auto_minmax(18rem,1fr)]">
              <Link
                href="/board"
                className="otb-energy-bg inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                {hero.cta}
              </Link>
              <LandingCommandCopy command={NPX_INSTALL_COMMAND} />
            </div>
          </div>

          <div className="min-w-0">
            {stats ? (
              <LandingLiveNumbers stats={stats} />
            ) : (
              <div className="rounded-lg border border-white/12 bg-white/10 p-4 backdrop-blur">
                <p className="font-mono text-xs font-semibold uppercase text-blue-100">{hero.liveSummary}</p>
                <p className="mt-3 text-2xl font-black text-white">{hero.connectingTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{hero.connectingBody}</p>
              </div>
            )}
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.07] px-4 py-3 text-xs leading-5 text-slate-300 backdrop-blur">
              {hero.highlight}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturePreview({ variant }: { variant: "profile" | "rank" | "sync" }) {
  if (variant === "sync") {
    return (
      <div className="border-b border-slate-200 bg-slate-950 p-4 text-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-400" />
          <span className="size-2 rounded-full bg-amber-300" />
          <span className="size-2 rounded-full bg-emerald-300" />
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] p-3 font-mono text-xs leading-6">
          <p className="text-blue-200">$ token-board-agent status</p>
          <p className="text-emerald-200">✓ LaunchAgent running</p>
          <p className="text-slate-300">last upload: 2 min ago</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="otb-energy-bar h-full w-[72%] rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "profile") {
    return (
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#edf2ff)] p-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-[linear-gradient(135deg,#2f5bff,#8a3ffc)]" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-28 rounded-full bg-slate-900" />
              <div className="mt-2 h-2 w-20 rounded-full bg-slate-200" />
            </div>
            <div className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-xs font-black text-amber-800">#3</div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-1">
            {[2, 4, 1, 5, 3, 6, 2, 7, 5, 8, 4, 6].map((level, index) => (
              <span key={index} className="h-3 rounded-[3px]" style={{ backgroundColor: `rgba(47,91,255,${0.1 + level * 0.08})` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#eef4ff)] p-4">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {["Syfyivan", "ffffhx", "OpenBoard"].map((name, index) => (
          <div key={name} className={`grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 ${index === 0 ? "bg-amber-50/70" : ""}`}>
            <span className={`rounded-full border px-2 py-1 text-center font-mono text-xs font-black ${index === 0 ? "border-amber-300 bg-white text-amber-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              #{index + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="otb-energy-bar h-full rounded-full" style={{ width: `${82 - index * 18}%` }} />
              </div>
            </div>
            <span className="text-right font-mono text-sm font-black text-slate-950">{["8.7M", "6.1M", "4.8M"][index]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroDashboardScene() {
  const { dict } = useI18n();
  const hero = dict.landing.hero;

  return (
    <div aria-hidden="true" className="absolute inset-0 min-w-[58rem] opacity-95">
      <div className="absolute left-1/2 top-20 w-[76rem] -translate-x-1/2 rotate-[-3deg] rounded-lg border border-white/10 bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="h-3 w-36 rounded-full bg-blue-100" />
            <div className="mt-3 h-7 w-80 rounded bg-slate-900" />
            <div className="mt-3 h-3 w-52 rounded-full bg-slate-200" />
          </div>
          <div className="grid w-96 grid-cols-4 gap-2 rounded-lg bg-slate-100 p-1">
            {["1D", "7D", "30D", "90D"].map((item, index) => (
              <div key={item} className={`h-10 rounded-lg ${index === 1 ? "bg-white shadow-sm" : "bg-transparent"}`} />
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {hero.sceneSignals.map((item, index) => (
            <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="h-3 w-24 rounded-full bg-slate-300" />
              <div className={`mt-4 h-6 rounded ${index === 1 ? "w-28 bg-blue-600" : "w-36 bg-slate-900"}`} />
              <div className="mt-3 h-3 w-20 rounded-full bg-blue-100" />
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[5rem_10rem_1fr_9rem_7rem_9rem] bg-slate-50 px-4 py-3 text-xs text-slate-400">
            {hero.sceneColumns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {["Syfyivan", "ffffhx", "OpenBoard"].map((name, index) => (
            <div key={name} className="grid grid-cols-[5rem_10rem_1fr_9rem_7rem_9rem] items-center border-t border-slate-100 px-4 py-4">
              <div className="font-mono text-sm font-semibold text-slate-500">#{index + 1}</div>
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-blue-50 ring-1 ring-blue-200" />
                <div>
                  <div className="h-3 w-20 rounded-full bg-slate-900" />
                  <div className="mt-2 h-2 w-12 rounded-full bg-slate-200" />
                </div>
              </div>
              <div className="flex h-14 items-end gap-2 pr-8">
                {[44, 68, 38, 31, 49, 47, 42].map((height, barIndex) => (
                  <div key={barIndex} className="flex-1 rounded-t bg-blue-600" style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="h-4 w-20 rounded bg-slate-900" />
              <div className="h-3 w-10 rounded-full bg-slate-300" />
              <div className="h-7 w-20 rounded-md bg-amber-50 ring-1 ring-amber-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
