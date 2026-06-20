import Link from "next/link";

import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogoMark } from "@/components/token-board-logo";

export type BenchmarkTab = "codex" | "claude" | "compare";

const tabs: Array<{ key: BenchmarkTab; href: string; label: string }> = [
  { key: "compare", href: "/bench", label: "对比总览" },
  { key: "codex", href: "/bench/codex", label: "Codex 评测" },
  { key: "claude", href: "/bench/claude", label: "Claude Code 评测" },
];

function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function BenchmarkShell({
  active,
  children,
}: {
  active: BenchmarkTab;
  children: React.ReactNode;
}) {
  return (
    <main className="min-w-0 bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
            <TokenBoardLogoMark className="size-7 shrink-0" decorative />
            <span className="truncate">Open Token Board</span>
          </Link>
          <AppNavLinks active="bench" className="justify-end" />
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-semibold transition",
                  isActive
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </main>
  );
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm leading-6 text-slate-500">{children}</p>
      <p className="mt-3 font-mono text-xs text-slate-400">
        运行：node tools/eval-runner/run.mjs --agent both --task all
      </p>
    </div>
  );
}
