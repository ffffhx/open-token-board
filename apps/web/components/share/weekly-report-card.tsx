import type { TokenLeaderboardSummary, TokenLeaderboardUser } from "@open-token-board/core";

import { TokenBoardLogoMark } from "@/components/token-board-logo";
import {
  formatNumber,
  formatSignedPercent,
  formatTokens,
  formatUsd,
} from "@/components/token-leaderboard/utils";

export type WeeklyReport = {
  displayName: string;
  rank: number;
  totalUsers: number;
  percentile: number;
  tokens: number;
  costUsd: number;
  sessions: number;
  activeDays: number;
  topModel: string;
  topTool: string;
  share: number;
  deltaTokens: number | null;
  daily: { date: string; tokens: number }[];
  rangeLabel: string;
  startLabel: string;
  endLabel: string;
  peakDay: { label: string; tokens: number } | null;
  vibe: { emoji: string; title: string; subtitle: string };
};

const RANGE_LABEL: Record<string, string> = {
  "1D": "近 24 小时",
  "7D": "本周",
  "30D": "近 30 天",
  "90D": "近 90 天",
};

function shortDate(iso: string): string {
  // iso is YYYY-MM-DD
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

function pickVibe(user: TokenLeaderboardUser): WeeklyReport["vibe"] {
  const model = user.topModel.toLowerCase();
  if (user.rank === 1) {
    return { emoji: "👑", title: "榜单霸主", subtitle: "本区间消耗第一，无人能及" };
  }
  if (user.share >= 0.3) {
    return { emoji: "🔥", title: "全场焦点", subtitle: `一个人贡献了全榜 ${Math.round(user.share * 100)}% 的 token` };
  }
  if (model.includes("opus")) {
    return { emoji: "🧠", title: "重度 Opus 玩家", subtitle: "把最强模型用到飞起" };
  }
  if (user.activeDays >= 7) {
    return { emoji: "🗓️", title: "全勤选手", subtitle: "这段时间没有一天掉线" };
  }
  if (user.sessions >= 1000) {
    return { emoji: "⚡", title: "高频冲刺", subtitle: `${formatNumber(user.sessions)} 个会话，手速惊人` };
  }
  return { emoji: "🚀", title: "稳定输出", subtitle: "保持节奏，持续编码" };
}

export function buildWeeklyReport(
  summary: TokenLeaderboardSummary,
  query: string | undefined,
): WeeklyReport | null {
  const users = summary.users ?? [];
  if (users.length === 0) return null;
  const wanted = query?.trim().toLowerCase();
  const user =
    (wanted && users.find((u) => u.displayName.toLowerCase() === wanted || u.userId.toLowerCase() === wanted)) ||
    users[0];
  if (!user) return null;

  const totalUsers = summary.activeUsers || users.length;
  const peak = (user.daily ?? []).reduce<{ date: string; tokens: number } | null>((best, point) => {
    if (!best || point.tokens > best.tokens) return { date: point.date, tokens: point.tokens };
    return best;
  }, null);

  return {
    displayName: user.displayName,
    rank: user.rank,
    totalUsers,
    percentile: totalUsers > 0 ? (totalUsers - user.rank) / totalUsers : 0,
    tokens: user.tokens,
    costUsd: user.costUsd,
    sessions: user.sessions,
    activeDays: user.activeDays,
    topModel: user.topModel,
    topTool: user.topTool,
    share: user.share,
    deltaTokens: user.deltaTokens,
    daily: (user.daily ?? []).map((p) => ({ date: p.date, tokens: p.tokens })),
    rangeLabel: RANGE_LABEL[summary.range] ?? summary.range,
    startLabel: shortDate(user.daily?.[0]?.date ?? ""),
    endLabel: shortDate(user.daily?.[user.daily.length - 1]?.date ?? ""),
    peakDay: peak ? { label: shortDate(peak.date), tokens: peak.tokens } : null,
    vibe: pickVibe(user),
  };
}

function Sparkline({ daily }: { daily: WeeklyReport["daily"] }) {
  const width = 372;
  const height = 64;
  const values = daily.map((d) => d.tokens);
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 8) - 4;
    return { x, y };
  });
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      aria-hidden="true"
      className="w-full"
      height={height}
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <linearGradient id="otb-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#otb-spark)" />
      <path d={line} fill="none" stroke="#60a5fa" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <circle cx={last.x} cy={last.y} fill="#f87171" r="4" stroke="#0b1220" strokeWidth="2" />
    </svg>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
      <p className="font-mono text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

export function WeeklyReportCard({ report }: { report: WeeklyReport }) {
  const initial = report.displayName.trim().slice(0, 1).toUpperCase() || "U";
  const deltaText =
    report.deltaTokens === null ? "新上榜" : `环比 ${formatSignedPercent(report.deltaTokens)}`;
  const deltaTone =
    report.deltaTokens === null
      ? "text-slate-300"
      : report.deltaTokens >= 0
        ? "text-emerald-300"
        : "text-rose-300";

  return (
    <article className="otb-fixed-dark-card relative w-[420px] max-w-full overflow-hidden rounded-lg bg-[linear-gradient(135deg,#0b1220_0%,#141a33_48%,#07111f_100%)] p-6 text-white shadow-2xl ring-1 ring-white/10">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />

      <header className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TokenBoardLogoMark className="size-6" decorative />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Open Token Board
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-blue-200">
          {report.rangeLabel} · {report.startLabel}–{report.endLabel}
        </span>
      </header>

      <div className="relative mt-6 flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-bold text-white shadow-lg shadow-blue-900/40">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{report.displayName}</p>
          <p className="text-xs text-slate-400">
            {report.rangeLabel}战报 · 共 {report.totalUsers} 位选手
          </p>
        </div>
        <span className="ml-auto rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-center">
          <span className="block font-mono text-xl font-bold leading-none text-amber-200">#{report.rank}</span>
          <span className="mt-1 block text-[10px] text-amber-200/80">超过 {Math.round(report.percentile * 100)}%</span>
        </span>
      </div>

      <div className="relative mt-6">
        <p className="text-xs uppercase tracking-wide text-slate-400">{report.rangeLabel}消耗</p>
        <p className="mt-1 font-mono text-5xl font-bold leading-none text-white">
          {formatTokens(report.tokens)}
          <span className="ml-2 align-baseline text-base font-medium text-slate-400">tokens</span>
        </p>
        <p className="mt-2 text-sm">
          <span className="text-blue-300">占全榜 {Math.round(report.share * 100)}%</span>
          <span className="mx-2 text-slate-600">·</span>
          <span className={deltaTone}>{deltaText}</span>
        </p>
      </div>

      <div className="relative mt-5">
        <Sparkline daily={report.daily} />
      </div>

      <div className="relative mt-5 grid grid-cols-3 gap-2">
        <StatBox label="估算成本" value={formatUsd(report.costUsd)} />
        <StatBox label="会话数" value={formatNumber(report.sessions)} />
        <StatBox label="活跃天数" value={`${report.activeDays} 天`} />
      </div>

      <div className="relative mt-5 space-y-2 text-sm">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <span className="text-base">{report.vibe.emoji}</span>
          <div className="min-w-0">
            <p className="font-semibold text-white">{report.vibe.title}</p>
            <p className="truncate text-xs text-slate-400">{report.vibe.subtitle}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-[11px] text-slate-400">主力模型</p>
            <p className="truncate font-mono text-sm font-semibold text-white">{report.topModel}</p>
            <p className="truncate text-[11px] text-slate-500">{report.topTool}</p>
          </div>
          {report.peakDay ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <p className="text-[11px] text-slate-400">最肝的一天</p>
              <p className="font-mono text-sm font-semibold text-white">{report.peakDay.label}</p>
              <p className="text-[11px] text-slate-500">{formatTokens(report.peakDay.tokens)} tokens</p>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="relative mt-6 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-slate-500">
        <span className="font-mono">open-token-board</span>
        <span>AI 编码 Token 排行榜</span>
      </footer>
    </article>
  );
}
