import Link from "next/link";

import {
  CODEX_BENCHMARK_REPEAT_COUNT,
  CODEX_BENCHMARK_TASKS,
  buildCodexBenchmarkDailySnapshots,
  type CodexBenchmarkDailySnapshot,
  type CodexBenchmarkDailyTaskSummary,
  type CodexBenchmarkSpeedBand,
  type CodexBenchmarkTask,
  type CodexBenchmarkTaskStatus,
} from "@open-token-board/core";

import { TokenBoardLogoMark } from "@/components/token-board-logo";

export function CodexBenchmarkApp({ now = new Date() }: { now?: Date }) {
  const snapshots = buildCodexBenchmarkDailySnapshots(now);
  const today = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2] ?? today;
  const iqDelta = today.iqScore - previous.iqScore;
  const speedDelta = today.speedScore - previous.speedScore;
  const maxP90 = Math.max(1, ...snapshots.map((snapshot) => snapshot.p90TotalSeconds));

  return (
    <main className="min-w-0 bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
            <TokenBoardLogoMark className="size-7 shrink-0" decorative />
            <span className="truncate">Open Token Board</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/board"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              Token 榜单
            </Link>
            <Link
              href="/"
              className="hidden min-h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 sm:inline-flex"
            >
              首页
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-950 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-white">
                Codex Health
              </span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-blue-700">
                {today.date}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {CODEX_BENCHMARK_REPEAT_COUNT} runs/day
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
              今日 Codex 智商与速度评测集
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              固定 S1-S5 每日题库，把“聪明不聪明、快不快、会不会乱改”拆成可复跑指标。当前分数使用内置示例 run 展示口径，接真实 runner 后可替换为生产数据。
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ScoreTile
                label="今日 IQ"
                value={`${today.iqScore.toFixed(1)}`}
                suffix="/100"
                meta={`较昨日 ${formatSignedScore(iqDelta)}`}
                tone="ink"
              />
              <ScoreTile
                label="今日速度"
                value={today.speedBand}
                suffix={`${today.speedScore.toFixed(1)}/100`}
                meta={`较昨日 ${formatSignedScore(speedDelta)}`}
                tone={today.speedBand === "Fast" ? "mint" : today.speedBand === "Normal" ? "blue" : "gold"}
              />
              <ScoreTile
                label="一次成功率"
                value={formatPercent(today.firstPassRate)}
                suffix="first pass"
                meta={`测试通过 ${formatPercent(today.testPassRate)}`}
                tone="blue"
              />
              <ScoreTile
                label="P90 完成耗时"
                value={formatDuration(today.p90TotalSeconds)}
                suffix="per run"
                meta={`平均重试 ${today.avgRetries.toFixed(1)} 次`}
                tone="gold"
              />
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
            <p className="font-mono text-xs font-semibold uppercase text-blue-200">Daily weather</p>
            <h2 className="mt-3 text-xl font-semibold leading-snug">{today.weather}</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">{today.recommendation}</p>
            <div className="mt-5 grid gap-2 border-t border-white/10 pt-4 text-xs text-slate-300">
              <EvidenceLine label="样本量" value={`${today.sampleRuns} 次完整 S1-S5`} />
              <EvidenceLine label="IQ 口径" value="测试、范围、指令、根因、路径效率" />
              <EvidenceLine label="Speed 口径" value="首动作、总耗时、命令等待、重试、输出速度" />
            </div>
          </aside>
        </section>

        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">过去 7 天趋势</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">每天跑 {CODEX_BENCHMARK_REPEAT_COUNT} 次，展示 median IQ、median Speed 与 P90 耗时。</p>
            </div>
            <div className="flex gap-2 font-mono text-[11px] text-slate-500">
              <span className="rounded-full border border-slate-200 px-2 py-1">IQ</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">Speed</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">P90</span>
            </div>
          </div>
          <div className="mt-5 grid min-h-72 gap-3 sm:grid-cols-7">
            {snapshots.map((snapshot) => (
              <TrendDay key={snapshot.date} maxP90={maxP90} snapshot={snapshot} />
            ))}
          </div>
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold">今日题目明细</h2>
              <span className="font-mono text-xs text-slate-500">S1-S5 · median score</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">任务</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3 text-right">IQ</th>
                    <th className="px-4 py-3 text-right">Speed</th>
                    <th className="px-4 py-3 text-right">通过率</th>
                    <th className="px-4 py-3 text-right">一次成功</th>
                    <th className="px-4 py-3 text-right">P90</th>
                    <th className="px-4 py-3">失败信号</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {today.taskSummaries.map((summary) => (
                    <TaskScoreRow key={summary.taskId} summary={summary} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="grid gap-3">
            <ProtocolCard
              title="每日协议"
              lines={[
                `每个任务跑 ${CODEX_BENCHMARK_REPEAT_COUNT} 次，取 median 分数。`,
                "同一天固定 prompt、fixture、验收脚本。",
                "记录 p90 耗时，避免单次慢请求误导结论。",
              ]}
            />
            <ProtocolCard
              title="IQ Score"
              lines={[
                "测试通过与隐藏验收权重最高。",
                "范围控制、遵守指令、根因解释单独计分。",
                "重试越多，路径效率扣分越多。",
              ]}
            />
            <ProtocolCard
              title="Speed Score"
              lines={[
                "首个有效动作越快越好。",
                "总完成耗时和命令等待分开统计。",
                "Fast mode 应单独标记，不和默认模式混算。",
              ]}
            />
          </aside>
        </section>

        <section className="mt-5">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">固定每日题库</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">这 5 道题覆盖小修、读代码、UI 类型、歧义范围和长上下文。</p>
            </div>
            <span className="font-mono text-xs text-slate-500">benchmark set v0.1</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {CODEX_BENCHMARK_TASKS.map((task) => (
              <TaskDefinitionCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      </div>
    </main>
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
  tone: "ink" | "mint" | "blue" | "gold";
  value: string;
}) {
  const tones = {
    ink: "border-slate-950 bg-slate-950 text-white",
    mint: "border-emerald-600/20 bg-emerald-50 text-emerald-950",
    blue: "border-blue-600/20 bg-blue-50 text-blue-950",
    gold: "border-amber-600/25 bg-amber-50 text-amber-950",
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
      <span className="text-right font-mono text-slate-100">{value}</span>
    </div>
  );
}

function TrendDay({ maxP90, snapshot }: { maxP90: number; snapshot: CodexBenchmarkDailySnapshot }) {
  return (
    <div className="grid min-h-64 grid-rows-[1fr_auto] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-3 items-end gap-2">
        <TrendBar label="IQ" value={snapshot.iqScore} height={snapshot.iqScore} tone="ink" />
        <TrendBar label="Speed" value={snapshot.speedScore} height={snapshot.speedScore} tone="blue" />
        <TrendBar
          label="P90"
          value={snapshot.p90TotalSeconds}
          height={(snapshot.p90TotalSeconds / maxP90) * 100}
          tone="gold"
          formatter={formatDuration}
        />
      </div>
      <div>
        <p className="truncate font-mono text-xs font-semibold text-slate-950">{snapshot.date.slice(5)}</p>
        <p className="mt-1 truncate text-[11px] text-slate-500">{snapshot.speedBand}</p>
      </div>
    </div>
  );
}

function TrendBar({
  formatter = (value) => value.toFixed(0),
  height,
  label,
  tone,
  value,
}: {
  formatter?: (value: number) => string;
  height: number;
  label: string;
  tone: "ink" | "blue" | "gold";
  value: number;
}) {
  const tones = {
    ink: "bg-slate-950",
    blue: "bg-blue-600",
    gold: "bg-amber-500",
  };

  return (
    <div className="flex h-full min-h-48 flex-col justify-end">
      <div
        className={`min-h-3 rounded-t transition ${tones[tone]}`}
        style={{ height: `${Math.max(5, Math.min(100, height))}%` }}
        title={`${label}: ${formatter(value)}`}
      />
      <p className="mt-2 truncate text-center font-mono text-[10px] text-slate-500">{formatter(value)}</p>
    </div>
  );
}

function TaskScoreRow({ summary }: { summary: CodexBenchmarkDailyTaskSummary }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-mono text-xs font-semibold text-blue-600">{summary.taskId}</p>
        <p className="mt-1 font-semibold text-slate-950">{summary.title}</p>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={summary.status} />
      </td>
      <td className="px-4 py-3 text-right font-mono">{summary.medianIQ.toFixed(1)}</td>
      <td className="px-4 py-3 text-right font-mono">{summary.medianSpeed.toFixed(1)}</td>
      <td className="px-4 py-3 text-right font-mono">{formatPercent(summary.passRate)}</td>
      <td className="px-4 py-3 text-right font-mono">{formatPercent(summary.firstPassRate)}</td>
      <td className="px-4 py-3 text-right font-mono">{formatDuration(summary.p90Seconds)}</td>
      <td className="max-w-[16rem] px-4 py-3 text-xs leading-5 text-slate-500">
        {summary.failureReason ?? "无明显失败信号"}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: CodexBenchmarkTaskStatus }) {
  const labels: Record<CodexBenchmarkTaskStatus, string> = {
    passed: "Passed",
    unstable: "Unstable",
    failed: "Failed",
  };
  const tones: Record<CodexBenchmarkTaskStatus, string> = {
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

function ProtocolCard({ lines, title }: { lines: string[]; title: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {lines.map((line) => (
          <p key={line} className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}

function TaskDefinitionCard({ task }: { task: CodexBenchmarkTask }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs font-semibold text-blue-600">{task.id} · {task.shortTitle}</p>
          <h3 className="mt-2 text-base font-semibold text-slate-950">{task.title}</h3>
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {task.difficulty}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{task.goal}</p>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Prompt</p>
        <p className="mt-2 text-sm leading-6 text-slate-800">{task.prompt}</p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TaskList title="验收" items={task.verification} />
        <TaskList title="护栏" items={task.guardrails} />
      </div>
    </article>
  );
}

function TaskList({ items, title }: { items: string[]; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
        {items.map((item) => (
          <li key={item} className="rounded-md bg-slate-50 px-2.5 py-1.5">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedScore(value: number) {
  if (Math.abs(value) < 0.05) {
    return "0.0";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;

  if (minutes <= 0) {
    return `${rest}s`;
  }

  return `${minutes}m ${rest}s`;
}
