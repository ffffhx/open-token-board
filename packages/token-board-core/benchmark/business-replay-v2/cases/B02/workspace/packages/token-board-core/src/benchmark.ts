// Agent-agnostic real benchmark layer.
//
// Unlike `codex-benchmark.ts` (which renders synthetic demo data for a single
// hard-coded agent), this module consumes the REAL results produced by the eval
// runner (tools/eval-runner) — it invokes Codex and Claude Code headless on
// sandboxed tasks and measures actual timing / pass rates. The runner writes
// `src/benchmark-data.generated.ts`; everything here summarizes & compares it.

import { BENCHMARK_DATA } from "./benchmark-data.generated";

export type BenchmarkAgentId = "codex" | "claude-code";

export type BenchmarkTaskKind =
  | "typescript-fix"
  | "code-reading"
  | "ui-typecheck"
  | "ambiguity-control"
  | "long-context"
  | "refactor"
  | "algorithm";

export type BenchmarkTaskStatus = "passed" | "unstable" | "failed";
export type BenchmarkSpeedBand = "Fast" | "Normal" | "Slow";

export interface BenchmarkIQWeights {
  tests: number;
  firstPass: number;
  scopeControl: number;
  instructionFollowing: number;
  rootCause: number;
  pathEfficiency: number;
}

export interface BenchmarkSpeedTargets {
  targetFirstActionSeconds: number;
  maxFirstActionSeconds: number;
  targetDurationSeconds: number;
  maxDurationSeconds: number;
  targetCommandWaitSeconds: number;
  maxCommandWaitSeconds: number;
  targetOutputTokensPerSecond: number;
  floorOutputTokensPerSecond: number;
}

export interface BenchmarkTaskMeta {
  id: string;
  title: string;
  shortTitle: string;
  kind: BenchmarkTaskKind;
  difficulty: "low" | "medium" | "high";
  prompt: string;
  allowedFiles: string[];
  weights: BenchmarkIQWeights;
  speedTargets: BenchmarkSpeedTargets;
}

export interface BenchmarkTaskResult {
  taskId: string;
  title?: string;
  kind?: BenchmarkTaskKind;
  passed: boolean;
  firstPass: boolean;
  scopeSafe: boolean;
  followedInstructions: boolean;
  rootCauseLocated: boolean;
  retries: number;
  toolTurns: number;
  changedFiles: number;
  firstActionSeconds: number;
  totalSeconds: number;
  commandWaitSeconds: number;
  outputTokensPerSecond: number;
  inputTokens?: number;
  outputTokens?: number;
  failureReason?: string;
}

export interface BenchmarkRun {
  id: string;
  agent: BenchmarkAgentId;
  modelLabel: string;
  startedAt: string;
  taskResults: BenchmarkTaskResult[];
}

export interface BenchmarkQualityEntry {
  codex: number;
  "claude-code": number;
  codexDims?: BenchmarkQualityDims;
  claudeDims?: BenchmarkQualityDims;
  judges?: number;
  winner: BenchmarkAgentId | "tie";
}

export interface BenchmarkQualityDims {
  readability: number;
  simplicity: number;
  robustness: number;
  idiomatic: number;
}

export interface BenchmarkUiResult {
  taskId: string;
  totalSeconds: number;
  outputTokens: number;
  rendered: boolean;
  fidelity: number;
  fidelityByJudge?: { codex?: number; claude?: number };
  notes?: string;
  shot: string;
  target: string;
}

export interface BenchmarkUiSection {
  tasks: Array<{ id: string; title: string; shortTitle: string; difficulty: string; prompt: string }>;
  byAgent: { codex: BenchmarkUiResult[]; "claude-code": BenchmarkUiResult[] };
}

export interface BenchmarkPayload {
  generatedAt: string;
  date: string;
  codexModel: string;
  tasks: BenchmarkTaskMeta[];
  runs: BenchmarkRun[];
  quality?: Record<string, BenchmarkQualityEntry>;
  ui?: BenchmarkUiSection;
  judgedAt?: string;
  uiGeneratedAt?: string;
}

export interface BenchmarkUiShowcaseRow {
  taskId: string;
  title: string;
  prompt: string;
  target: string;
  codex?: BenchmarkUiResult;
  claude?: BenchmarkUiResult;
  fidelityWinner: BenchmarkAgentId | "tie";
}

export interface BenchmarkTaskSummary {
  taskId: string;
  title: string;
  shortTitle: string;
  kind: BenchmarkTaskKind;
  difficulty: "low" | "medium" | "high";
  status: BenchmarkTaskStatus;
  passRate: number;
  iqScore: number;
  speedScore: number;
  totalSeconds: number;
  firstActionSeconds: number;
  changedFiles: number;
  scopeSafe: boolean;
  rootCauseLocated: boolean;
  outputTokens: number;
  qualityScore?: number;
  failureReason?: string;
}

export interface BenchmarkAgentSummary {
  agent: BenchmarkAgentId;
  agentLabel: string;
  modelLabel: string;
  date: string;
  sampleRuns: number;
  taskCount: number;
  iqScore: number;
  speedScore: number;
  speedBand: BenchmarkSpeedBand;
  passRate: number;
  firstPassRate: number;
  scopeSafeRate: number;
  rootCauseRate: number;
  avgRetries: number;
  medianTotalSeconds: number;
  p90TotalSeconds: number;
  totalOutputTokens: number;
  qualityScore: number;
  weather: string;
  recommendation: string;
  taskSummaries: BenchmarkTaskSummary[];
}

export interface BenchmarkComparisonMetric {
  key: string;
  label: string;
  codex: number;
  claude: number;
  unit: "score" | "percent" | "seconds" | "count";
  higherIsBetter: boolean;
  winner: BenchmarkAgentId | "tie";
}

export interface BenchmarkComparisonTaskRow {
  taskId: string;
  title: string;
  shortTitle: string;
  kind: BenchmarkTaskKind;
  difficulty: "low" | "medium" | "high";
  codex?: { passed: boolean; iqScore: number; speedScore: number; totalSeconds: number };
  claude?: { passed: boolean; iqScore: number; speedScore: number; totalSeconds: number };
  iqWinner: BenchmarkAgentId | "tie";
  speedWinner: BenchmarkAgentId | "tie";
}

export interface BenchmarkComparison {
  date: string;
  hasData: boolean;
  metrics: BenchmarkComparisonMetric[];
  taskRows: BenchmarkComparisonTaskRow[];
  headline: string;
}

export const AGENT_LABELS: Record<BenchmarkAgentId, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

const KIND_TITLES: Record<BenchmarkTaskKind, string> = {
  "typescript-fix": "Bug 修复",
  "code-reading": "代码阅读",
  "ui-typecheck": "类型/逻辑",
  "ambiguity-control": "范围控制",
  "long-context": "长上下文",
  refactor: "重构",
  algorithm: "算法",
};

export function getBenchmarkPayload(): BenchmarkPayload {
  return BENCHMARK_DATA as unknown as BenchmarkPayload;
}

export function hasRealBenchmarkData(payload = getBenchmarkPayload()): boolean {
  return payload.runs.some((run) => run.taskResults.length > 0);
}

// ---- scoring (same formulas as codex-benchmark for continuity) ----

export function scoreTaskIQ(result: BenchmarkTaskResult, weights: BenchmarkIQWeights): number {
  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0) || 1;
  const retryEfficiency =
    result.retries <= 0 ? 1 : result.retries === 1 ? 0.82 : result.retries === 2 ? 0.58 : 0.25;
  const weighted =
    weights.tests * b(result.passed) +
    weights.firstPass * b(result.firstPass) +
    weights.scopeControl * b(result.scopeSafe) +
    weights.instructionFollowing * b(result.followedInstructions) +
    weights.rootCause * b(result.rootCauseLocated) +
    weights.pathEfficiency * retryEfficiency;
  return round1((weighted / totalWeight) * 100);
}

export function scoreTaskSpeed(result: BenchmarkTaskResult, t: BenchmarkSpeedTargets): number {
  const score =
    0.22 * lower(result.firstActionSeconds, t.targetFirstActionSeconds, t.maxFirstActionSeconds) +
    0.38 * lower(result.totalSeconds, t.targetDurationSeconds, t.maxDurationSeconds) +
    0.18 * lower(result.commandWaitSeconds, t.targetCommandWaitSeconds, t.maxCommandWaitSeconds) +
    0.12 * lower(result.retries, 0, 4) +
    0.1 * higher(result.outputTokensPerSecond, t.targetOutputTokensPerSecond, t.floorOutputTokensPerSecond);
  return round1(score);
}

// ---- per-agent summary ----

export function summarizeAgent(
  agent: BenchmarkAgentId,
  payload = getBenchmarkPayload(),
): BenchmarkAgentSummary | null {
  const runs = payload.runs.filter((r) => r.agent === agent && r.taskResults.length);
  if (!runs.length) return null;
  const quality = payload.quality ?? {};

  const taskSummaries: BenchmarkTaskSummary[] = payload.tasks.map((meta) => {
    const results = runs
      .map((run) => run.taskResults.find((r) => r.taskId === meta.id))
      .filter((r): r is BenchmarkTaskResult => Boolean(r));
    const passRate = mean(results.map((r) => (r.passed ? 1 : 0)));
    const iqScore = median(results.map((r) => scoreTaskIQ(r, meta.weights)));
    const speedScore = median(results.map((r) => scoreTaskSpeed(r, meta.speedTargets)));
    const totalSeconds = Math.round(median(results.map((r) => r.totalSeconds)));
    const firstActionSeconds = Math.round(median(results.map((r) => r.firstActionSeconds)));
    const failureReason = [...results].reverse().find((r) => r.failureReason)?.failureReason;
    const last = results[results.length - 1];
    return {
      taskId: meta.id,
      title: meta.title,
      shortTitle: meta.shortTitle,
      kind: meta.kind,
      difficulty: meta.difficulty,
      status: statusOf(passRate),
      passRate,
      iqScore,
      speedScore,
      totalSeconds,
      firstActionSeconds,
      changedFiles: last?.changedFiles ?? 0,
      scopeSafe: passRate > 0 ? results.every((r) => r.scopeSafe) : (last?.scopeSafe ?? false),
      rootCauseLocated: results.some((r) => r.rootCauseLocated),
      outputTokens: sum(results.map((r) => r.outputTokens ?? 0)),
      qualityScore: quality[meta.id] ? quality[meta.id][agent] : undefined,
      failureReason,
    };
  });

  const allResults = runs.flatMap((r) => r.taskResults);
  const iqScore = round1(mean(taskSummaries.map((t) => t.iqScore)));
  const speedScore = round1(mean(taskSummaries.map((t) => t.speedScore)));
  const passRate = mean(allResults.map((r) => (r.passed ? 1 : 0)));
  const firstPassRate = mean(allResults.map((r) => (r.firstPass ? 1 : 0)));
  const scopeSafeRate = mean(allResults.map((r) => (r.scopeSafe ? 1 : 0)));
  const rootCauseRate = mean(allResults.map((r) => (r.rootCauseLocated ? 1 : 0)));

  return {
    agent,
    agentLabel: AGENT_LABELS[agent],
    modelLabel: runs[0].modelLabel,
    date: payload.date,
    sampleRuns: runs.length,
    taskCount: payload.tasks.length,
    iqScore,
    speedScore,
    speedBand: bandOf(speedScore),
    passRate,
    firstPassRate,
    scopeSafeRate,
    rootCauseRate,
    avgRetries: mean(allResults.map((r) => r.retries)),
    medianTotalSeconds: Math.round(median(allResults.map((r) => r.totalSeconds))),
    p90TotalSeconds: percentile(allResults.map((r) => r.totalSeconds), 0.9),
    totalOutputTokens: sum(allResults.map((r) => r.outputTokens ?? 0)),
    qualityScore: round1(mean(taskSummaries.map((t) => t.qualityScore).filter((v): v is number => typeof v === "number"))),
    weather: weatherOf(AGENT_LABELS[agent], iqScore, speedScore, firstPassRate, passRate),
    recommendation: recommendationOf(iqScore, speedScore, passRate, taskSummaries),
    taskSummaries,
  };
}

// ---- comparison ----

export function buildComparison(payload = getBenchmarkPayload()): BenchmarkComparison {
  const codex = summarizeAgent("codex", payload);
  const claude = summarizeAgent("claude-code", payload);
  if (!codex || !claude) {
    return { date: payload.date, hasData: false, metrics: [], taskRows: [], headline: "尚无两端可对比的数据。" };
  }

  const metrics: BenchmarkComparisonMetric[] = [
    metric("iq", "IQ 综合分", codex.iqScore, claude.iqScore, "score", true),
    metric("quality", "代码质量", codex.qualityScore, claude.qualityScore, "score", true),
    metric("speed", "速度分", codex.speedScore, claude.speedScore, "score", true),
    metric("pass", "通过率", codex.passRate * 100, claude.passRate * 100, "percent", true),
    metric("scope", "范围控制", codex.scopeSafeRate * 100, claude.scopeSafeRate * 100, "percent", true),
    metric("p90", "P90 耗时", codex.p90TotalSeconds, claude.p90TotalSeconds, "seconds", false),
  ];
  const fid = uiFidelity(payload);
  if (fid) metrics.push(metric("fidelity", "UI 还原度", fid.codex, fid.claude, "score", true));

  const claudeTaskById = new Map(claude.taskSummaries.map((t) => [t.taskId, t]));
  const taskRows: BenchmarkComparisonTaskRow[] = codex.taskSummaries.map((c) => {
    const cl = claudeTaskById.get(c.taskId);
    return {
      taskId: c.taskId,
      title: c.title,
      shortTitle: c.shortTitle,
      kind: c.kind,
      difficulty: c.difficulty,
      codex: { passed: c.passRate >= 0.5, iqScore: c.iqScore, speedScore: c.speedScore, totalSeconds: c.totalSeconds },
      claude: cl
        ? { passed: cl.passRate >= 0.5, iqScore: cl.iqScore, speedScore: cl.speedScore, totalSeconds: cl.totalSeconds }
        : undefined,
      iqWinner: cl ? winner(c.iqScore, cl.iqScore, true) : "codex",
      speedWinner: cl ? winner(c.speedScore, cl.speedScore, true) : "codex",
    };
  });

  const iqWin = metrics[0].winner;
  const speedWin = metrics[1].winner;
  let headline: string;
  if (iqWin === speedWin && iqWin !== "tie") {
    headline = `今天 ${AGENT_LABELS[iqWin]} 在智力和速度上都更占优。`;
  } else if (iqWin === "tie" && speedWin === "tie") {
    headline = "今天两端整体打平，看具体任务类型选择。";
  } else {
    const iqName = iqWin === "tie" ? "两端持平" : `${AGENT_LABELS[iqWin]} 更聪明`;
    const spName = speedWin === "tie" ? "速度相当" : `${AGENT_LABELS[speedWin]} 更快`;
    headline = `今天 ${iqName}，但 ${spName}。`;
  }

  return { date: payload.date, hasData: true, metrics, taskRows, headline };
}

export function kindTitle(kind: BenchmarkTaskKind): string {
  return KIND_TITLES[kind] ?? kind;
}

function uiFidelity(payload: BenchmarkPayload): { codex: number; claude: number } | null {
  const ui = payload.ui;
  if (!ui || !ui.byAgent.codex.length || !ui.byAgent["claude-code"].length) return null;
  return {
    codex: round1(mean(ui.byAgent.codex.map((r) => r.fidelity))),
    claude: round1(mean(ui.byAgent["claude-code"].map((r) => r.fidelity))),
  };
}

export function buildUiShowcase(payload = getBenchmarkPayload()): BenchmarkUiShowcaseRow[] {
  const ui = payload.ui;
  if (!ui) return [];
  const codexById = new Map(ui.byAgent.codex.map((r) => [r.taskId, r]));
  const claudeById = new Map(ui.byAgent["claude-code"].map((r) => [r.taskId, r]));
  return ui.tasks.map((t) => {
    const c = codexById.get(t.id);
    const cl = claudeById.get(t.id);
    const cf = c?.fidelity ?? 0;
    const lf = cl?.fidelity ?? 0;
    return {
      taskId: t.id,
      title: t.title,
      prompt: t.prompt,
      target: c?.target ?? cl?.target ?? "",
      codex: c,
      claude: cl,
      fidelityWinner: Math.abs(cf - lf) <= 1 ? "tie" : cf > lf ? "codex" : "claude-code",
    };
  });
}

export function hasUiData(payload = getBenchmarkPayload()): boolean {
  return Boolean(payload.ui && payload.ui.tasks.length);
}

// ---- helpers ----

function metric(
  key: string,
  label: string,
  codex: number,
  claude: number,
  unit: BenchmarkComparisonMetric["unit"],
  higherIsBetter: boolean,
): BenchmarkComparisonMetric {
  return { key, label, codex: round1(codex), claude: round1(claude), unit, higherIsBetter, winner: winner(codex, claude, higherIsBetter) };
}

function winner(a: number, b: number, higherIsBetter: boolean): BenchmarkAgentId | "tie" {
  const diff = a - b;
  const eps = Math.max(0.5, Math.abs(a + b) * 0.01);
  if (Math.abs(diff) <= eps) return "tie";
  const codexBetter = higherIsBetter ? diff > 0 : diff < 0;
  return codexBetter ? "codex" : "claude-code";
}

function statusOf(passRate: number): BenchmarkTaskStatus {
  if (passRate >= 0.99) return "passed";
  if (passRate >= 0.5) return "unstable";
  return "failed";
}

function bandOf(speedScore: number): BenchmarkSpeedBand {
  if (speedScore >= 78) return "Fast";
  if (speedScore >= 58) return "Normal";
  return "Slow";
}

function weatherOf(label: string, iq: number, speed: number, firstPass: number, pass: number): string {
  if (iq >= 82 && speed < 62) return `今日 ${label}：聪明但慢`;
  if (speed >= 78 && iq < 78) return `今日 ${label}：速度快，容易漏细节`;
  if (pass < 0.82 || firstPass < 0.55) return `今日 ${label}：适合小修，不适合大改`;
  if (iq >= 82 && speed >= 78) return `今日 ${label}：聪明且顺手`;
  return `今日 ${label}：表现正常，注意验收`;
}

function recommendationOf(iq: number, speed: number, pass: number, tasks: BenchmarkTaskSummary[]): string {
  const weakest = [...tasks].sort((l, r) => l.iqScore - r.iqScore)[0];
  if (iq >= 82 && speed < 62) return "复杂任务可交给它，但要拆阶段并允许更长执行时间。";
  if (speed >= 78 && pass < 0.7) return "适合快速小修；涉及范围控制时先要求列假设和验收。";
  if (weakest && weakest.passRate < 0.5) return `今天在「${weakest.shortTitle}」类任务上不稳，先人工复核。`;
  return "常规修复可直接派活；交付前保持范围 diff 与验收。";
}

function b(v: boolean) {
  return v ? 1 : 0;
}
function lower(v: number, target: number, max: number) {
  if (v <= target) return 100;
  if (v >= max) return 0;
  return 100 - ((v - target) / (max - target)) * 100;
}
function higher(v: number, target: number, floor: number) {
  if (v >= target) return 100;
  if (v <= floor) return 0;
  return ((v - floor) / (target - floor)) * 100;
}
function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function sum(values: number[]) {
  return values.reduce((s, v) => s + v, 0);
}
function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((l, r) => l - r);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const s = [...values].sort((l, r) => l - r);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * fraction) - 1));
  return s[i];
}
function round1(v: number) {
  return Math.round(v * 10) / 10;
}
