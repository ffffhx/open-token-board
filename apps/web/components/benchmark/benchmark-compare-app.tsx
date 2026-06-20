"use client";

import {
  buildComparison,
  buildUiShowcase,
  hasUiData,
  summarizeAgent,
  getBenchmarkPayload,
  kindTitle,
  AGENT_LABELS,
  type BenchmarkAgentId,
  type BenchmarkComparisonMetric,
  type BenchmarkComparisonTaskRow,
  type BenchmarkUiShowcaseRow,
} from "@open-token-board/core";

import { BenchmarkAccessGate } from "@/components/benchmark/benchmark-access-gate";
import {
  BenchmarkShell,
  EmptyState,
  formatDuration,
  formatPercent,
} from "@/components/benchmark/benchmark-shell";

export function BenchmarkCompareApp({ apiBaseUrl }: { apiBaseUrl?: string }) {
  return (
    <BenchmarkAccessGate apiBaseUrl={apiBaseUrl}>
      <BenchmarkCompareContent />
    </BenchmarkAccessGate>
  );
}

function BenchmarkCompareContent() {
  const payload = getBenchmarkPayload();
  const comparison = buildComparison();
  const codex = summarizeAgent("codex");
  const claude = summarizeAgent("claude-code");

  if (!comparison.hasData || !codex || !claude) {
    return (
      <BenchmarkShell active="compare">
        <EmptyState>还没有可对比的真实数据：需要 Codex 和 Claude Code 两端都跑过同一题集。</EmptyState>
      </BenchmarkShell>
    );
  }

  const codexWins = comparison.taskRows.filter((r) => r.iqWinner === "codex").length;
  const claudeWins = comparison.taskRows.filter((r) => r.iqWinner === "claude-code").length;
  const ties = comparison.taskRows.length - codexWins - claudeWins;

  return (
    <BenchmarkShell active="compare">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-950 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-white">
            Codex vs Claude Code
          </span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-blue-700">
            {comparison.date}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            真实跑测 · {comparison.taskRows.length} 题
          </span>
        </div>
        <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
          {comparison.headline}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          同一套 {comparison.taskRows.length} 道沙盒编程题，分别真实调用 {codex.modelLabel} 和 {claude.modelLabel}，
          统一隐藏脚本判分。按 IQ 综合分，Codex 赢 {codexWins} 题 · Claude Code 赢 {claudeWins} 题 · 打平 {ties} 题。
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {comparison.metrics.map((m) => (
            <MetricCard key={m.key} metric={m} />
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <AgentMiniCard
          agent="codex"
          modelLabel={codex.modelLabel}
          iq={codex.iqScore}
          speed={codex.speedScore}
          pass={codex.passRate}
          p90={codex.p90TotalSeconds}
          weather={codex.weather}
        />
        <AgentMiniCard
          agent="claude-code"
          modelLabel={claude.modelLabel}
          iq={claude.iqScore}
          speed={claude.speedScore}
          pass={claude.passRate}
          p90={claude.p90TotalSeconds}
          weather={claude.weather}
        />
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">逐题对比</h2>
          <span className="font-mono text-xs text-slate-500">IQ / Speed / 耗时 · 胜者高亮</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">任务</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3 text-right">Codex IQ</th>
                <th className="px-4 py-3 text-right">Claude IQ</th>
                <th className="px-4 py-3 text-right">Codex 耗时</th>
                <th className="px-4 py-3 text-right">Claude 耗时</th>
                <th className="px-4 py-3">IQ 胜者</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {comparison.taskRows.map((row) => (
                <CompareRow key={row.taskId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {hasUiData() && <UiShowcase rows={buildUiShowcase()} />}

      <p className="mt-4 font-mono text-xs text-slate-400">
        数据生成于 {payload.generatedAt.slice(0, 16).replace("T", " ")} · 由 tools/eval-runner 真实执行
      </p>
    </BenchmarkShell>
  );
}

function UiShowcase({ rows }: { rows: BenchmarkUiShowcaseRow[] }) {
  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">UI 还原对比</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            给同一份设计稿的文字规格，两个 agent 各写 HTML/CSS，渲染截图后由 codex+claude 双视觉裁判打还原度分。
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500">{rows.length} 个 UI 题 · fidelity 0-100</span>
      </div>
      <div className="grid gap-5">
        {rows.map((row) => (
          <UiShowcaseCard key={row.taskId} row={row} />
        ))}
      </div>
    </section>
  );
}

function UiShowcaseCard({ row }: { row: BenchmarkUiShowcaseRow }) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h3 className="font-semibold text-slate-950">{row.title}</h3>
        {row.fidelityWinner !== "tie" && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              row.fidelityWinner === "codex" ? "bg-slate-950 text-white" : "bg-violet-600 text-white"
            }`}
          >
            {AGENT_LABELS[row.fidelityWinner]} 还原更准
          </span>
        )}
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <Shot label="目标设计稿" src={row.target} badge="target" />
        <Shot
          label="Codex"
          src={row.codex?.shot}
          badge={row.codex ? `还原度 ${row.codex.fidelity}` : "—"}
          notes={row.codex?.notes}
          seconds={row.codex?.totalSeconds}
        />
        <Shot
          label="Claude Code"
          src={row.claude?.shot}
          badge={row.claude ? `还原度 ${row.claude.fidelity}` : "—"}
          notes={row.claude?.notes}
          seconds={row.claude?.totalSeconds}
        />
      </div>
    </article>
  );
}

function Shot({
  badge,
  label,
  notes,
  seconds,
  src,
}: {
  badge: string;
  label: string;
  notes?: string;
  seconds?: number;
  src?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">
          {badge}
        </span>
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="w-full rounded-md border border-slate-200 bg-slate-100" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
          未渲染
        </div>
      )}
      {(notes || seconds != null) && (
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          {seconds != null && <span className="font-mono">{seconds}s</span>}
          {notes ? ` · ${notes}` : ""}
        </p>
      )}
    </div>
  );
}

function MetricCard({ metric }: { metric: BenchmarkComparisonMetric }) {
  const fmt = (v: number) =>
    metric.unit === "percent"
      ? `${Math.round(v)}%`
      : metric.unit === "seconds"
        ? formatDuration(v)
        : v.toFixed(1);
  const codexWin = metric.winner === "codex";
  const claudeWin = metric.winner === "claude-code";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-slate-500">{metric.label}</p>
        {metric.winner !== "tie" && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {AGENT_LABELS[metric.winner]} 胜
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Side label="Codex" value={fmt(metric.codex)} win={codexWin} tone="ink" />
        <Side label="Claude" value={fmt(metric.claude)} win={claudeWin} tone="violet" />
      </div>
    </div>
  );
}

function Side({ label, value, win, tone }: { label: string; value: string; win: boolean; tone: "ink" | "violet" }) {
  const base = tone === "ink" ? "border-slate-200" : "border-slate-200";
  const winCls =
    win && tone === "ink"
      ? "border-slate-950 bg-slate-950 text-white"
      : win && tone === "violet"
        ? "border-violet-600 bg-violet-600 text-white"
        : "bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border px-3 py-2 ${base} ${winCls}`}>
      <p className="text-[10px] font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}

function AgentMiniCard({
  agent,
  iq,
  modelLabel,
  p90,
  pass,
  speed,
  weather,
}: {
  agent: BenchmarkAgentId;
  iq: number;
  modelLabel: string;
  p90: number;
  pass: number;
  speed: number;
  weather: string;
}) {
  const accent = agent === "codex" ? "text-slate-950" : "text-violet-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className={`text-sm font-semibold ${accent}`}>{AGENT_LABELS[agent]}</p>
        <span className="font-mono text-xs text-slate-400">{modelLabel}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{weather}</p>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Stat label="IQ" value={iq.toFixed(1)} />
        <Stat label="Speed" value={speed.toFixed(1)} />
        <Stat label="通过" value={formatPercent(pass)} />
        <Stat label="P90" value={formatDuration(p90)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-2">
      <p className="font-mono text-base font-semibold text-slate-950">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase text-slate-400">{label}</p>
    </div>
  );
}

function CompareRow({ row }: { row: BenchmarkComparisonTaskRow }) {
  const winnerCls = (who: BenchmarkAgentId) =>
    row.iqWinner === who ? "font-semibold text-slate-950" : "text-slate-500";
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-mono text-xs font-semibold text-blue-600">{row.taskId}</p>
        <p className="mt-1 font-semibold text-slate-950">{row.title}</p>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {kindTitle(row.kind)} · {row.difficulty}
        </span>
      </td>
      <td className={`px-4 py-3 text-right font-mono ${winnerCls("codex")}`}>
        {row.codex ? row.codex.iqScore.toFixed(1) : "—"}
        {row.codex && !row.codex.passed && <span className="ml-1 text-[10px] text-red-500">✗</span>}
      </td>
      <td className={`px-4 py-3 text-right font-mono ${winnerCls("claude-code")}`}>
        {row.claude ? row.claude.iqScore.toFixed(1) : "—"}
        {row.claude && !row.claude.passed && <span className="ml-1 text-[10px] text-red-500">✗</span>}
      </td>
      <td className="px-4 py-3 text-right font-mono text-slate-500">{row.codex ? formatDuration(row.codex.totalSeconds) : "—"}</td>
      <td className="px-4 py-3 text-right font-mono text-slate-500">{row.claude ? formatDuration(row.claude.totalSeconds) : "—"}</td>
      <td className="px-4 py-3">
        {row.iqWinner === "tie" ? (
          <span className="text-xs text-slate-400">持平</span>
        ) : (
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              row.iqWinner === "codex" ? "bg-slate-950 text-white" : "bg-violet-600 text-white"
            }`}
          >
            {AGENT_LABELS[row.iqWinner]}
          </span>
        )}
      </td>
    </tr>
  );
}
