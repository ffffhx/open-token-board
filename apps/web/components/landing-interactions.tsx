"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/token-leaderboard/shared-ui";
import { formatNumber, formatTokens } from "@/components/token-leaderboard/utils";

type LandingStats = {
  activeUsers: number;
  leaderName: string;
  leaderTokens: number;
  topModel: string;
  totalTokens: number;
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useAnimatedNumber(value: number, durationMs = 900) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplayValue(value);
      return undefined;
    }

    let frame = 0;
    let startTime = 0;
    const from = displayValue;
    const delta = value - from;

    const tick = (time: number) => {
      if (!startTime) startTime = time;
      const progress = Math.min(1, (time - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(from + delta * eased);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, value]);

  return displayValue;
}

export function LandingLiveNumbers({ stats }: { stats: LandingStats }) {
  const animatedTokens = useAnimatedNumber(stats.totalTokens);
  const animatedUsers = useAnimatedNumber(stats.activeUsers, 700);
  const leaderTokens = useAnimatedNumber(stats.leaderTokens, 760);
  const items = useMemo(
    () => [
      { label: "7 日总 token", value: formatTokens(animatedTokens), meta: "全站滚动消耗" },
      { label: "参与人数", value: `${formatNumber(animatedUsers)} 人`, meta: "自动上报中" },
      { label: "当前榜首", value: stats.leaderName, meta: `${formatTokens(leaderTokens)} · ${stats.topModel}` },
    ],
    [animatedTokens, animatedUsers, leaderTokens, stats.leaderName, stats.topModel]
  );

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-white/12 bg-white/10 p-4 backdrop-blur">
          <p className="text-xs font-semibold uppercase text-slate-300">{item.label}</p>
          <p className="otb-stat-number mt-2 truncate font-mono text-2xl font-black text-white sm:text-3xl" title={item.value}>
            {item.value}
          </p>
          <p className="mt-1 truncate text-xs text-blue-100" title={item.meta}>
            {item.meta}
          </p>
        </div>
      ))}
    </div>
  );
}

export function LandingCommandCopy({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return undefined;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [copied, failed]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <>
      <div className="flex min-h-12 min-w-0 overflow-hidden rounded-lg border border-white/18 bg-white/10 text-white shadow-sm backdrop-blur">
        <code className="min-w-0 flex-1 truncate px-4 py-3 font-mono text-xs leading-6 text-slate-100 sm:text-sm" title={command}>
          {command}
        </code>
        <button
          type="button"
          onClick={copyCommand}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 border-l border-white/14 px-4 text-sm font-semibold transition hover:bg-white/12"
          aria-label="复制加入命令"
        >
          <Icon name={copied ? "check" : "copy"} />
          <span className="hidden sm:inline">{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      {copied || failed ? (
        <div
          role="status"
          aria-live="polite"
          className={`otb-toast-pop pointer-events-none fixed left-1/2 top-5 z-[100] -translate-x-1/2 rounded-lg border px-4 py-3 text-sm font-semibold shadow-lg ring-4 backdrop-blur-xl ${
            failed
              ? "border-red-300/50 bg-red-50 text-red-900 ring-red-500/10"
              : "border-blue-300/50 bg-blue-50 text-blue-900 ring-blue-500/10"
          }`}
        >
          {failed ? "复制失败，请手动复制命令" : "加入命令已复制"}
        </div>
      ) : null}
    </>
  );
}
