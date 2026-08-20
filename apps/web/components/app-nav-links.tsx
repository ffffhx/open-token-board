"use client";

import Link from "next/link";

import { LanguageToggle } from "@/components/language-toggle";
import { usePrivateBenchmarkAccess } from "@/components/private-benchmark-access";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/i18n";

type AppNavPage = "home" | "board" | "card" | "limits" | "speed" | "bench";
type AppNavTheme = "light" | "dark";

const navItems: Array<{ key: AppNavPage; href: string }> = [
  { key: "home", href: "/" },
  { key: "board", href: "/board" },
  { key: "card", href: "/card" },
  { key: "limits", href: "/limits" },
  { key: "speed", href: "/speed" },
  { key: "bench", href: "/bench" },
];

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function AppNavLinks({
  active,
  className,
  hideHome = false,
  theme = "light",
}: {
  active: AppNavPage;
  className?: string;
  hideHome?: boolean;
  theme?: AppNavTheme;
}) {
  const { dict } = useI18n();
  const benchmarkAccess = usePrivateBenchmarkAccess();
  const visibleItems = navItems.filter((item) => {
    if (hideHome && item.key === "home") return false;
    return item.key !== "bench" || benchmarkAccess.allowed;
  });

  return (
    <nav aria-label={dict.common.nav.ariaLabel} className={classes("flex flex-wrap items-center gap-2", className)}>
      {visibleItems.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={classes(
              "relative inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold transition",
              isActive && "after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-current",
              theme === "dark" && isActive && "border border-white/20 bg-white/10 text-white shadow-sm",
              theme === "dark" && !isActive && "text-slate-300 hover:bg-white/10 hover:text-white",
              theme === "light" && isActive && "border border-blue-200 bg-blue-50 text-blue-700 shadow-sm",
              theme === "light" &&
                !isActive &&
                "border border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm",
            )}
          >
            {dict.common.nav[item.key]}
          </Link>
        );
      })}
      <LanguageToggle
        className={
          theme === "dark"
            ? "border-white/20 bg-white/10 text-slate-300 hover:border-white/30 hover:bg-white/15 hover:text-white"
            : undefined
        }
      />
      <ThemeToggle
        className={
          theme === "dark"
            ? "border-white/20 bg-white/10 text-slate-300 hover:border-white/30 hover:bg-white/15 hover:text-white"
            : undefined
        }
      />
    </nav>
  );
}
