"use client";

import {
  summarizeAgent,
  getBenchmarkPayload,
  kindTitle,
  type BenchmarkAgentId,
  type BenchmarkTaskStatus,
  type BenchmarkTaskSummary,
} from "@open-token-board/core";

import { BenchmarkAccessGate } from "@/components/benchmark/benchmark-access-gate";
import {
  BenchmarkShell,
  EmptyState,
  formatDuration,
  formatPercent,
  type BenchmarkTab,
} from "@/components/benchmark/benchmark-shell";

export function BenchmarkAgentApp({
  agent,
  apiBaseUrl,
  tab,
}: {
  agent: BenchmarkAgentId;
  apiBaseUrl?: string;
  tab: BenchmarkTab;
}) {
  return (
    <BenchmarkAccessGate apiBaseUrl={apiBaseUrl}>
      <BenchmarkAgentContent agent={agent} tab={tab} />
    </BenchmarkAccessGate>
  );
}

function BenchmarkAgentContent({ agent, tab }: { agent: BenchmarkAgentId; tab: BenchmarkTab }) {
  const payload = getBenchmarkPayload();
  const summary = summarizeAgent(agent);

  if (!summary) {
    return (
      <BenchmarkShell active={tab}>
        <EmptyState>尚未跑出 {agent === "codex" ? "Codex" : "Claude Code"} 的真实评测数据。</EmptyState>
      </BenchmarkShell>
    );
  }

  return (
    <BenchmarkShell active={tab}>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-950 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-white">
              {summary.agentLabel} Health
            </span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-blue-700">
              {summary.date}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              真实跑测
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {summary.taskCount} 题 · {summary.sampleRuns} 轮
            </span>
          </div>
          <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
            {summary.agentLabel} 智商与速度评测
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {summary.modelLabel} 在 {summary.taskCount} 道沙盒编程题上的真实表现：每题真正调用 CLI 执行、计时，并用隐藏脚本判分。
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <ScoreTile label="IQ 综合" value={summary.iqScore.toFixed(1)} suffix="/100" meta={`根因命中 ${formatPercent(summary.rootCauseRate)}`} tone="ink" />
            <ScoreTile label="代码质量" value={summary.qualityScore ? summary.qualityScore.toFixed(1) : "—"} suffix="双盲互评" meta="可读/简洁/鲁棒/地道" tone="violet" />
            <ScoreTile
              label="速度"
              value={summary.speedBand}
              suffix={`${summary.speedScore.toFixed(1)}/100`}
              meta={`中位 ${formatDuration(summary.medianTotalSeconds)}`}
              tone={summary.speedBand === "Fast" ? "mint" : summary.speedBand === "Normal" ? "blue" : "gold"}
            />
            <ScoreTile label="通过率" value={formatPercent(summary.passRate)} suffix="passed" meta={`一次成功 ${formatPercent(summary.firstPassRate)}`} tone="blue" />
            <ScoreTile label="P90 耗时" value={formatDuration(summary.p90TotalSeconds)} suffix="per task" meta={`范围控制 ${formatPercent(summary.scopeSafeRate)}`} tone="gold" />
          </div>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <p className="font-mono text-xs font-semibold uppercase text-blue-200">今日天气</p>
          <h2 className="mt-3 text-xl font-semibold leading-snug">{summary.weather}</h2>
          <p className="mt-4 text-sm leading-6 text-slate-300">{summary.recommendation}</p>
          <div className="mt-5 grid gap-2 border-t border-white/10 pt-4 text-xs text-slate-300">
            <EvidenceLine label="模型" value={summary.modelLabel} />
            <EvidenceLine label="平均重试" value={`${summary.avgRetries.toFixed(1)} 次`} />
            <EvidenceLine label="输出 token" value={summary.totalOutputTokens.toLocaleString()} />
            <EvidenceLine label="生成时间" value={payload.generatedAt.slice(0, 16).replace("T", " ")} />
          </div>
        </aside>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">逐题明细</h2>
          <span className="font-mono text-xs text-slate-500">{summary.taskCount} tasks · real run</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">任务</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">IQ</th>
                <th className="px-4 py-3 text-right">质量</th>
                <th className="px-4 py-3 text-right">Speed</th>
                <th className="px-4 py-3 text-right">耗时</th>
                <th className="px-4 py-3 text-right">改动</th>
                <th className="px-4 py-3">失败信号</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.taskSummaries.map((t) => (
                <TaskRow key={t.taskId} summary={t} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </BenchmarkShell>
  );
}

function TaskRow({ summary }: { summary: BenchmarkTaskSummary }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-mono text-xs font-semibold text-blue-600">{summary.taskId}</p>
        <p className="mt-1 font-semibold text-slate-950">{summary.title}</p>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {kindTitle(summary.kind)} · {summary.difficulty}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={summary.status} />
      </td>
      <td className="px-4 py-3 text-right font-mono">{summary.iqScore.toFixed(1)}</td>
      <td className="px-4 py-3 text-right font-mono text-violet-700">{summary.qualityScore != null ? summary.qualityScore.toFixed(1) : "—"}</td>
      <td className="px-4 py-3 text-right font-mono">{summary.speedScore.toFixed(1)}</td>
      <td className="px-4 py-3 text-right font-mono">{formatDuration(summary.totalSeconds)}</td>
      <td className="px-4 py-3 text-right font-mono">{summary.changedFiles}</td>
      <td className="max-w-[16rem] px-4 py-3 text-xs leading-5 text-slate-500">
        {summary.failureReason ?? (summary.scopeSafe ? "通过，范围正确" : "改动超范围")}
      </td>
    </tr>
  );
}

function ScoreTile({
  label,
  meta,
  suffix,
  tone,
  value,
}: {
  label: string;
  meta: string;
  suffix: string;
  tone: "ink" | "mint" | "blue" | "gold" | "violet";
  value: string;
}) {
  const tones = {
    ink: "border-slate-950 bg-slate-950 text-white",
    mint: "border-emerald-600/20 bg-emerald-50 text-emerald-950",
    blue: "border-blue-600/20 bg-blue-50 text-blue-950",
    gold: "border-amber-600/25 bg-amber-50 text-amber-950",
    violet: "border-violet-600/25 bg-violet-50 text-violet-950",
  };
  return (
    <div className={`min-h-32 rounded-lg border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase opacity-65">{label}</p>
        <span className="mt-1 size-2 rounded-full bg-current opacity-50" />
      </div>
      <p className="mt-5 flex min-w-0 items-end gap-2 font-mono">
        <span className="truncate text-3xl font-semibold leading-none sm:text-4xl">{value}</span>
        <span className="pb-1 text-xs font-semibold opacity-60">{suffix}</span>
      </p>
      <p className="mt-3 truncate text-xs opacity-65" title={meta}>{meta}</p>
    </div>
  );
}

function EvidenceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="max-w-[60%] truncate text-right font-mono text-slate-100" title={value}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: BenchmarkTaskStatus }) {
  const labels: Record<BenchmarkTaskStatus, string> = { passed: "Passed", unstable: "Unstable", failed: "Failed" };
  const tones: Record<BenchmarkTaskStatus, string> = {
    passed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    unstable: "border-amber-200 bg-amber-50 text-amber-800",
    failed: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase ${tones[status]}`}>
      {labels[status]}
    </span>
  );
}
