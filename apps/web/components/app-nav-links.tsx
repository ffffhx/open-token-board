"use client";

import Link from "next/link";

type AppNavPage = "home" | "board" | "limits" | "bench";
type AppNavTheme = "light" | "dark";

const navItems: Array<{ key: AppNavPage; href: string; label: string }> = [
  { key: "home", href: "/", label: "首页" },
  { key: "board", href: "/board", label: "Token 榜单" },
  { key: "limits", href: "/limits", label: "额度面板" },
  { key: "bench", href: "/bench", label: "Codex 评测" },
];

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function AppNavLinks({
  active,
  className,
  theme = "light",
}: {
  active: AppNavPage;
  className?: string;
  theme?: AppNavTheme;
}) {
  return (
    <nav aria-label="页面导航" className={classes("flex flex-wrap items-center gap-2", className)}>
      {navItems.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={classes(
              "inline-flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold transition",
              theme === "dark" && isActive && "bg-white text-slate-950",
              theme === "dark" && !isActive && "text-slate-300 hover:bg-white/10 hover:text-white",
              theme === "light" && isActive && "border border-blue-200 bg-blue-50 text-blue-700",
              theme === "light" &&
                !isActive &&
                "border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
