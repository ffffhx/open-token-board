"use client";

import Link from "next/link";
import { useCallback } from "react";

import { AppNavLinks } from "@/components/app-nav-links";
import { benchmarkApiBase, usePrivateBenchmarkAccess } from "@/components/private-benchmark-access";
import { TokenBoardLogoMark } from "@/components/token-board-logo";

export function BenchmarkAccessGate({
  apiBaseUrl,
  children,
}: {
  apiBaseUrl?: string;
  children: React.ReactNode;
}) {
  const access = usePrivateBenchmarkAccess(apiBaseUrl);
  const loginWithGitHub = useCallback(() => {
    const base = benchmarkApiBase(apiBaseUrl);
    window.location.href = `${base}/api/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`;
  }, [apiBaseUrl]);

  if (access.allowed) {
    return children;
  }

  const viewer = access.user?.githubLogin ? `@${access.user.githubLogin}` : access.user?.displayName || "当前账号";
  const title = access.loading
    ? "正在确认访问权限"
    : access.authenticated
      ? "AI 评测仅所有者可见"
      : "登录后查看 AI 评测";
  const description = access.loading
    ? "正在读取当前 GitHub 登录态。"
    : access.authenticated
      ? `${viewer} 没有查看这个评测页的权限。`
      : "这个评测页只对站点所有者开放。";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
            <TokenBoardLogoMark className="size-7 shrink-0" decorative />
            <span className="truncate">Open Token Board</span>
          </Link>
          <AppNavLinks active="bench" className="justify-end" />
        </nav>
      </header>

      <section className="mx-auto flex max-w-2xl flex-col items-start px-4 py-16 sm:px-6 lg:px-8">
        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-mono text-xs font-semibold uppercase text-blue-700">
          private benchmark
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
        {access.error ? <p className="mt-3 font-mono text-xs text-amber-700">权限接口暂不可用：{access.error}</p> : null}
        {!access.loading && !access.authenticated ? (
          <button
            type="button"
            onClick={loginWithGitHub}
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            GitHub 登录
          </button>
        ) : null}
        <Link
          href="/"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}

