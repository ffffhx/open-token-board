export type CodexBenchmarkTaskId = "S1" | "S2" | "S3" | "S4" | "S5";

export type CodexBenchmarkTaskKind =
  | "typescript-fix"
  | "code-reading"
  | "ui-typecheck"
  | "ambiguity-control"
  | "long-context";

export type CodexBenchmarkTaskStatus = "passed" | "unstable" | "failed";

export type CodexBenchmarkSpeedBand = "Fast" | "Normal" | "Slow";

export interface CodexBenchmarkIQWeights {
  tests: number;
  firstPass: number;
  scopeControl: number;
  instructionFollowing: number;
  rootCause: number;
  pathEfficiency: number;
}

export interface CodexBenchmarkSpeedTargets {
  targetFirstActionSeconds: number;
  maxFirstActionSeconds: number;
  targetDurationSeconds: number;
  maxDurationSeconds: number;
  targetCommandWaitSeconds: number;
  maxCommandWaitSeconds: number;
  targetOutputTokensPerSecond: number;
  floorOutputTokensPerSecond: number;
}

export interface CodexBenchmarkTask {
  id: CodexBenchmarkTaskId;
  title: string;
  shortTitle: string;
  kind: CodexBenchmarkTaskKind;
  difficulty: "low" | "medium" | "high";
  goal: string;
  prompt: string;
  setup: string[];
  verification: string[];
  expectedSignals: string[];
  guardrails: string[];
  iqWeights: CodexBenchmarkIQWeights;
  speedTargets: CodexBenchmarkSpeedTargets;
}

export interface CodexBenchmarkTaskResult {
  taskId: CodexBenchmarkTaskId;
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
  failureReason?: string;
}

export interface CodexBenchmarkRun {
  id: string;
  startedAt: string;
  modelLabel: string;
  mode: "default" | "fast";
  taskResults: CodexBenchmarkTaskResult[];
}

export interface CodexBenchmarkTaskScore {
  taskId: CodexBenchmarkTaskId;
  iqScore: number;
  speedScore: number;
  status: CodexBenchmarkTaskStatus;
  firstPass: boolean;
  retries: number;
  totalSeconds: number;
  failureReason?: string;
}

export interface CodexBenchmarkRunSummary {
  runId: string;
  startedAt: string;
  iqScore: number;
  speedScore: number;
  passRate: number;
  firstPassRate: number;
  avgRetries: number;
  totalSeconds: number;
  taskScores: CodexBenchmarkTaskScore[];
}

export interface CodexBenchmarkDailyTaskSummary {
  taskId: CodexBenchmarkTaskId;
  title: string;
  status: CodexBenchmarkTaskStatus;
  passRate: number;
  firstPassRate: number;
  medianIQ: number;
  medianSpeed: number;
  p90Seconds: number;
  avgRetries: number;
  failureReason?: string;
}

export interface CodexBenchmarkDailySnapshot {
  date: string;
  iqScore: number;
  speedScore: number;
  speedBand: CodexBenchmarkSpeedBand;
  sampleRuns: number;
  firstPassRate: number;
  testPassRate: number;
  avgRetries: number;
  p90TotalSeconds: number;
  weather: string;
  recommendation: string;
  taskSummaries: CodexBenchmarkDailyTaskSummary[];
}

const DEFAULT_IQ_WEIGHTS: CodexBenchmarkIQWeights = {
  tests: 30,
  firstPass: 20,
  scopeControl: 20,
  instructionFollowing: 15,
  rootCause: 10,
  pathEfficiency: 5,
};

export const CODEX_BENCHMARK_REPEAT_COUNT = 4;

export const CODEX_BENCHMARK_TASKS: CodexBenchmarkTask[] = [
  {
    id: "S1",
    title: "小型 TypeScript bug 修复",
    shortTitle: "TS bug fix",
    kind: "typescript-fix",
    difficulty: "low",
    goal: "验证 Codex 能否定位一个小型纯函数缺陷，用最小补丁修复并让单测通过。",
    prompt:
      "修复 compactRangeLabel 在非连续数字区间上的合并错误。只允许改动 range-label.ts，跑对应单测，并说明根因。",
    setup: [
      "提供一个含 compactRangeLabel(numbers: number[]) 的小型 TypeScript fixture。",
      "预置失败用例：输入 [1, 2, 3, 5, 7, 8] 应输出 \"1-3,5,7-8\"。",
      "隐藏用例覆盖重复数字、乱序输入、负数、单元素数组。",
    ],
    verification: [
      "公开单测全部通过。",
      "隐藏单测全部通过。",
      "diff 只触及 range-label.ts，未重写测试或放宽断言。",
    ],
    expectedSignals: [
      "能指出原实现把 gap 为 2 的数字也并入连续区间。",
      "能保持函数签名和已有排序/去重约定。",
      "提交前至少运行一次目标测试。",
    ],
    guardrails: [
      "不得删除或跳过测试。",
      "不得改 package 配置。",
      "不得引入新依赖。",
    ],
    iqWeights: DEFAULT_IQ_WEIGHTS,
    speedTargets: {
      targetFirstActionSeconds: 20,
      maxFirstActionSeconds: 90,
      targetDurationSeconds: 180,
      maxDurationSeconds: 720,
      targetCommandWaitSeconds: 25,
      maxCommandWaitSeconds: 120,
      targetOutputTokensPerSecond: 55,
      floorOutputTokensPerSecond: 12,
    },
  },
  {
    id: "S2",
    title: "阅读仓库代码后回答状态变化",
    shortTitle: "Code reading",
    kind: "code-reading",
    difficulty: "medium",
    goal: "验证 Codex 是否能从真实仓库里追踪 UI 控件到后端接口和本地状态，而不是凭概念回答。",
    prompt:
      "阅读 open-token-board 代码，回答“GitHub 登录按钮实际改变了哪些状态、不会改变哪些 token 数据”。请给出文件路径和代码链路。",
    setup: [
      "使用当前仓库作为 fixture。",
      "要求回答必须引用页面组件、auth 接口和个人用量请求之间的边界。",
      "不要求改代码。",
    ],
    verification: [
      "回答包含登录跳转、会话态、/api/auth/me、/api/usage/me 的关系。",
      "明确说明登录不会直接修改 token 采集记录或排行榜数据。",
      "至少引用 2 个真实文件路径，且无臆造接口。",
    ],
    expectedSignals: [
      "能区分 GitHub 账号态和 token agent 上报数据。",
      "能说清个人面板只是读取 gated profile。",
      "不会把登录按钮误解释为同步按钮。",
    ],
    guardrails: [
      "不得改代码。",
      "不得把 display name 当作身份唯一依据。",
      "不得用泛泛 OAuth 解释替代仓库代码路径。",
    ],
    iqWeights: {
      tests: 20,
      firstPass: 15,
      scopeControl: 20,
      instructionFollowing: 20,
      rootCause: 20,
      pathEfficiency: 5,
    },
    speedTargets: {
      targetFirstActionSeconds: 25,
      maxFirstActionSeconds: 120,
      targetDurationSeconds: 360,
      maxDurationSeconds: 1_200,
      targetCommandWaitSeconds: 35,
      maxCommandWaitSeconds: 150,
      targetOutputTokensPerSecond: 50,
      floorOutputTokensPerSecond: 10,
    },
  },
  {
    id: "S3",
    title: "UI/类型错误修复并 typecheck",
    shortTitle: "UI typecheck",
    kind: "ui-typecheck",
    difficulty: "medium",
    goal: "验证 Codex 能否修复一个 Web UI 类型错误，同时保持界面文案和布局不跑偏。",
    prompt:
      "修复 CodexHealthSummaryCard 的 tone 类型错误。不要改变视觉层级，不要重命名公开 props，修完后运行 web typecheck。",
    setup: [
      "在一个 React 组件里注入非法 tone=\"purple\"。",
      "组件周边有 union type、map 渲染和响应式布局。",
      "预期修复是收敛到现有 tone 类型或补齐合法 tone 分支。",
    ],
    verification: [
      "pnpm --filter @open-token-board/web typecheck 通过。",
      "组件 API 没有无关重命名。",
      "没有把 TypeScript strictness 降级。",
    ],
    expectedSignals: [
      "能优先修类型根因而不是 any 规避。",
      "能保持按钮、卡片和表格尺寸稳定。",
      "能说明 typecheck 是最终验收命令。",
    ],
    guardrails: [
      "不得改 tsconfig 关闭 strict。",
      "不得用 any 或 ts-ignore 作为修复。",
      "不得做大范围 UI 重构。",
    ],
    iqWeights: DEFAULT_IQ_WEIGHTS,
    speedTargets: {
      targetFirstActionSeconds: 20,
      maxFirstActionSeconds: 90,
      targetDurationSeconds: 300,
      maxDurationSeconds: 960,
      targetCommandWaitSeconds: 45,
      maxCommandWaitSeconds: 180,
      targetOutputTokensPerSecond: 48,
      floorOutputTokensPerSecond: 10,
    },
  },
  {
    id: "S4",
    title: "含歧义需求的改动范围控制",
    shortTitle: "Ambiguity",
    kind: "ambiguity-control",
    difficulty: "high",
    goal: "验证 Codex 是否会在需求不清晰时乱改，或能把假设收窄到最小可验证范围。",
    prompt:
      "“把默认范围改成昨天那种更顺手的。”请处理这个需求。你可以查看历史代码和上下文，但不要扩大到后端默认值、API 行为或样式重做。",
    setup: [
      "当前仓库同时存在前端默认 range、后端 parseRange 默认和文案常量。",
      "需求没有明确是 1D、7D 还是最近一次用户选择。",
      "允许先提出一个最小假设，也允许只给出澄清问题。",
    ],
    verification: [
      "没有同时改前端、后端和文案三处默认。",
      "若直接改代码，diff 只覆盖能被上下文证明的最小位置。",
      "最终说明包含假设、风险和验证命令。",
    ],
    expectedSignals: [
      "能识别“昨天那种”缺少可执行目标。",
      "不会把局部默认状态误扩成产品策略变更。",
      "会保留无关本地改动。",
    ],
    guardrails: [
      "不得重置用户改动。",
      "不得凭空声称知道“昨天”是哪种。",
      "不得改动后端默认值，除非需求明确指向 API。",
    ],
    iqWeights: {
      tests: 15,
      firstPass: 15,
      scopeControl: 30,
      instructionFollowing: 20,
      rootCause: 10,
      pathEfficiency: 10,
    },
    speedTargets: {
      targetFirstActionSeconds: 30,
      maxFirstActionSeconds: 150,
      targetDurationSeconds: 420,
      maxDurationSeconds: 1_200,
      targetCommandWaitSeconds: 35,
      maxCommandWaitSeconds: 150,
      targetOutputTokensPerSecond: 45,
      floorOutputTokensPerSecond: 8,
    },
  },
  {
    id: "S5",
    title: "长上下文约束保持",
    shortTitle: "Long context",
    kind: "long-context",
    difficulty: "high",
    goal: "验证 Codex 在长约束列表下是否会遗漏边界、误改旧逻辑或忘记最终验收。",
    prompt:
      "阅读一份长上下文约束文档，把 Fast mode 成本说明补入 Codex 评测页面。必须保留 12 条约束、5 个任务编号和原有评分公式。",
    setup: [
      "提供 2,500-4,000 字约束文档，包含必须保留、禁止改动和最终交付格式。",
      "页面里已有任务定义、趋势图和天气文案。",
      "要求只新增成本说明，不改变 S1-S5 的语义。",
    ],
    verification: [
      "12 条约束逐项满足。",
      "S1-S5 编号、标题和评分公式未被重写。",
      "最终页面 typecheck 通过，且说明 Fast mode 更快但成本更高。",
    ],
    expectedSignals: [
      "会先提取约束清单再动手。",
      "不会把成本说明混进 IQ Score。",
      "最终回复能列出验证结果和残余风险。",
    ],
    guardrails: [
      "不得删除现有趋势和明细表。",
      "不得把示例数据说成真实线上测量。",
      "不得省略验收命令。",
    ],
    iqWeights: {
      tests: 20,
      firstPass: 15,
      scopeControl: 25,
      instructionFollowing: 25,
      rootCause: 10,
      pathEfficiency: 5,
    },
    speedTargets: {
      targetFirstActionSeconds: 45,
      maxFirstActionSeconds: 180,
      targetDurationSeconds: 780,
      maxDurationSeconds: 1_800,
      targetCommandWaitSeconds: 60,
      maxCommandWaitSeconds: 240,
      targetOutputTokensPerSecond: 42,
      floorOutputTokensPerSecond: 8,
    },
  },
];

export function scoreCodexBenchmarkTaskIQ(
  result: CodexBenchmarkTaskResult,
  task = getCodexBenchmarkTask(result.taskId)
) {
  const weights = task.iqWeights;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const retryEfficiency = result.retries <= 0 ? 1 : result.retries === 1 ? 0.82 : result.retries === 2 ? 0.58 : 0.25;
  const weightedScore =
    weights.tests * boolScore(result.passed) +
    weights.firstPass * boolScore(result.firstPass) +
    weights.scopeControl * boolScore(result.scopeSafe) +
    weights.instructionFollowing * boolScore(result.followedInstructions) +
    weights.rootCause * boolScore(result.rootCauseLocated) +
    weights.pathEfficiency * retryEfficiency;

  return roundScore((weightedScore / totalWeight) * 100);
}

export function scoreCodexBenchmarkTaskSpeed(
  result: CodexBenchmarkTaskResult,
  task = getCodexBenchmarkTask(result.taskId)
) {
  const targets = task.speedTargets;
  const score =
    0.22 * scoreLowerIsBetter(result.firstActionSeconds, targets.targetFirstActionSeconds, targets.maxFirstActionSeconds) +
    0.38 * scoreLowerIsBetter(result.totalSeconds, targets.targetDurationSeconds, targets.maxDurationSeconds) +
    0.18 * scoreLowerIsBetter(result.commandWaitSeconds, targets.targetCommandWaitSeconds, targets.maxCommandWaitSeconds) +
    0.12 * scoreLowerIsBetter(result.retries, 0, 4) +
    0.1 * scoreHigherIsBetter(result.outputTokensPerSecond, targets.targetOutputTokensPerSecond, targets.floorOutputTokensPerSecond);

  return roundScore(score);
}

export function summarizeCodexBenchmarkRun(run: CodexBenchmarkRun): CodexBenchmarkRunSummary {
  const taskScores = run.taskResults.map((result) => {
    const iqScore = scoreCodexBenchmarkTaskIQ(result);
    const speedScore = scoreCodexBenchmarkTaskSpeed(result);

    return {
      taskId: result.taskId,
      iqScore,
      speedScore,
      status: getTaskStatus(result.passed ? 1 : 0),
      firstPass: result.firstPass,
      retries: result.retries,
      totalSeconds: result.totalSeconds,
      failureReason: result.failureReason,
    };
  });

  const totalTasks = Math.max(1, taskScores.length);
  const passCount = run.taskResults.filter((result) => result.passed).length;
  const firstPassCount = run.taskResults.filter((result) => result.firstPass).length;
  const retryCount = run.taskResults.reduce((sum, result) => sum + result.retries, 0);
  const totalSeconds = run.taskResults.reduce((sum, result) => sum + result.totalSeconds, 0);

  return {
    runId: run.id,
    startedAt: run.startedAt,
    iqScore: roundScore(mean(taskScores.map((item) => item.iqScore))),
    speedScore: roundScore(mean(taskScores.map((item) => item.speedScore))),
    passRate: passCount / totalTasks,
    firstPassRate: firstPassCount / totalTasks,
    avgRetries: retryCount / totalTasks,
    totalSeconds,
    taskScores,
  };
}

export function buildCodexBenchmarkDailySnapshots(now = new Date()): CodexBenchmarkDailySnapshot[] {
  const runs = buildCodexBenchmarkDemoRuns(now);
  const runsByDate = new Map<string, CodexBenchmarkRun[]>();

  for (const run of runs) {
    const date = run.startedAt.slice(0, 10);
    const list = runsByDate.get(date) ?? [];
    list.push(run);
    runsByDate.set(date, list);
  }

  return Array.from(runsByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayRuns]) => summarizeCodexBenchmarkDay(date, dayRuns));
}

export function getCodexBenchmarkTask(taskId: CodexBenchmarkTaskId) {
  const task = CODEX_BENCHMARK_TASKS.find((item) => item.id === taskId);

  if (!task) {
    throw new Error(`Unknown Codex benchmark task: ${taskId}`);
  }

  return task;
}

function summarizeCodexBenchmarkDay(date: string, runs: CodexBenchmarkRun[]): CodexBenchmarkDailySnapshot {
  const runSummaries = runs.map((run) => summarizeCodexBenchmarkRun(run));
  const taskSummaries = CODEX_BENCHMARK_TASKS.map((task) => summarizeDailyTask(task, runs));
  const iqScore = roundScore(median(runSummaries.map((summary) => summary.iqScore)));
  const speedScore = roundScore(median(runSummaries.map((summary) => summary.speedScore)));
  const firstPassRate = mean(runSummaries.map((summary) => summary.firstPassRate));
  const testPassRate = mean(runSummaries.map((summary) => summary.passRate));
  const avgRetries = mean(runSummaries.map((summary) => summary.avgRetries));
  const p90TotalSeconds = percentile(runSummaries.map((summary) => summary.totalSeconds), 0.9);
  const weather = buildCodexWeather(iqScore, speedScore, firstPassRate, testPassRate);

  return {
    date,
    iqScore,
    speedScore,
    speedBand: getSpeedBand(speedScore),
    sampleRuns: runs.length,
    firstPassRate,
    testPassRate,
    avgRetries,
    p90TotalSeconds,
    weather,
    recommendation: buildCodexRecommendation(iqScore, speedScore, firstPassRate, taskSummaries),
    taskSummaries,
  };
}

function summarizeDailyTask(task: CodexBenchmarkTask, runs: CodexBenchmarkRun[]): CodexBenchmarkDailyTaskSummary {
  const results = runs
    .map((run) => run.taskResults.find((result) => result.taskId === task.id))
    .filter((result): result is CodexBenchmarkTaskResult => Boolean(result));
  const passRate = mean(results.map((result) => (result.passed ? 1 : 0)));
  const firstPassRate = mean(results.map((result) => (result.firstPass ? 1 : 0)));
  const medianIQ = median(results.map((result) => scoreCodexBenchmarkTaskIQ(result, task)));
  const medianSpeed = median(results.map((result) => scoreCodexBenchmarkTaskSpeed(result, task)));
  const p90Seconds = percentile(results.map((result) => result.totalSeconds), 0.9);
  const avgRetries = mean(results.map((result) => result.retries));
  const failureReason = [...results].reverse().find((result) => result.failureReason)?.failureReason;

  return {
    taskId: task.id,
    title: task.title,
    status: getTaskStatus(passRate),
    passRate,
    firstPassRate,
    medianIQ,
    medianSpeed,
    p90Seconds,
    avgRetries,
    failureReason,
  };
}

function buildCodexBenchmarkDemoRuns(now: Date): CodexBenchmarkRun[] {
  const dayProfiles = [
    { iqPenalty: 13, speedScale: 1.58, failureTaskId: "S4" as CodexBenchmarkTaskId, slowTaskId: "S5" as CodexBenchmarkTaskId },
    { iqPenalty: 7, speedScale: 1.34 },
    { iqPenalty: 18, speedScale: 1.22, failureTaskId: "S5" as CodexBenchmarkTaskId },
    { iqPenalty: 5, speedScale: 1.42 },
    { iqPenalty: 8, speedScale: 1.12 },
    { iqPenalty: 3, speedScale: 1.68, slowTaskId: "S2" as CodexBenchmarkTaskId },
    { iqPenalty: 6, speedScale: 1.28, failureTaskId: "S4" as CodexBenchmarkTaskId },
  ];
  // Build timestamps in UTC so day grouping (which keys off the UTC date in the ISO
  // string) stays consistent with the run ids regardless of the host timezone.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 0, 0));
  const runs: CodexBenchmarkRun[] = [];

  dayProfiles.forEach((profile, dayIndex) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (dayProfiles.length - 1 - dayIndex));

    for (let repeatIndex = 0; repeatIndex < CODEX_BENCHMARK_REPEAT_COUNT; repeatIndex += 1) {
      const startedAt = new Date(day);
      startedAt.setUTCHours(10 + repeatIndex * 3, 12 + dayIndex, 0, 0);
      runs.push({
        id: `${formatDateKey(day)}-run-${repeatIndex + 1}`,
        startedAt: startedAt.toISOString(),
        modelLabel: "gpt-5.5 / Codex",
        mode: repeatIndex === 2 && dayIndex % 2 === 0 ? "fast" : "default",
        taskResults: CODEX_BENCHMARK_TASKS.map((task, taskIndex) =>
          buildDemoTaskResult(task, {
            dayIndex,
            repeatIndex,
            taskIndex,
            iqPenalty: profile.iqPenalty,
            speedScale: profile.speedScale,
            failureTaskId: profile.failureTaskId,
            slowTaskId: profile.slowTaskId,
          })
        ),
      });
    }
  });

  return runs;
}

function buildDemoTaskResult(
  task: CodexBenchmarkTask,
  profile: {
    dayIndex: number;
    repeatIndex: number;
    taskIndex: number;
    iqPenalty: number;
    speedScale: number;
    failureTaskId?: CodexBenchmarkTaskId;
    slowTaskId?: CodexBenchmarkTaskId;
  }
): CodexBenchmarkTaskResult {
  const difficultyPenalty = task.difficulty === "high" ? 8 : task.difficulty === "medium" ? 4 : 1;
  const qualitySignal = 94 - profile.iqPenalty - difficultyPenalty + profile.repeatIndex * 3 - (profile.taskIndex % 2) * 2;
  const failed = profile.failureTaskId === task.id && profile.repeatIndex < 2;
  const passed = !failed && qualitySignal >= 62;
  const firstPass = passed && qualitySignal >= 82;
  const retries = firstPass ? 0 : passed ? 1 + ((profile.dayIndex + profile.repeatIndex + profile.taskIndex) % 2) : 3;
  const scale =
    profile.speedScale +
    (profile.slowTaskId === task.id ? 0.24 : 0) +
    (profile.repeatIndex === 0 ? 0.08 : 0) -
    (profile.repeatIndex === 2 ? 0.1 : 0);
  const totalSeconds = Math.round(task.speedTargets.targetDurationSeconds * scale + retries * 42 + (passed ? 0 : 90));
  const firstActionSeconds = Math.round(task.speedTargets.targetFirstActionSeconds * scale + (firstPass ? 0 : 8));
  const commandWaitSeconds = Math.round(task.speedTargets.targetCommandWaitSeconds * scale + retries * 9);
  const outputTokensPerSecond = Math.max(
    6,
    Math.round(task.speedTargets.targetOutputTokensPerSecond / Math.max(0.9, scale) + (profile.repeatIndex === 2 ? 8 : 0))
  );

  return {
    taskId: task.id,
    passed,
    firstPass,
    scopeSafe: passed && !(task.id === "S4" && qualitySignal < 78),
    followedInstructions: passed && qualitySignal >= 68,
    rootCauseLocated: passed && qualitySignal >= 72,
    retries,
    toolTurns: 3 + retries * 2 + (task.difficulty === "high" ? 2 : 0),
    changedFiles: task.kind === "code-reading" ? 0 : failed ? 4 : task.id === "S5" ? 2 : 1,
    firstActionSeconds,
    totalSeconds,
    commandWaitSeconds,
    outputTokensPerSecond,
    failureReason: failed ? getDemoFailureReason(task.id) : undefined,
  };
}

function getDemoFailureReason(taskId: CodexBenchmarkTaskId) {
  const reasons: Record<CodexBenchmarkTaskId, string> = {
    S1: "隐藏用例仍失败",
    S2: "回答缺少真实文件路径",
    S3: "typecheck 未通过",
    S4: "需求歧义下扩大了默认值改动范围",
    S5: "长上下文约束遗漏",
  };

  return reasons[taskId];
}

function getTaskStatus(passRate: number): CodexBenchmarkTaskStatus {
  if (passRate >= 0.99) {
    return "passed";
  }

  if (passRate >= 0.5) {
    return "unstable";
  }

  return "failed";
}

function getSpeedBand(speedScore: number): CodexBenchmarkSpeedBand {
  if (speedScore >= 78) {
    return "Fast";
  }

  if (speedScore >= 58) {
    return "Normal";
  }

  return "Slow";
}

function buildCodexWeather(iqScore: number, speedScore: number, firstPassRate: number, testPassRate: number) {
  if (iqScore >= 82 && speedScore < 62) {
    return "今日 Codex：聪明但慢";
  }

  if (speedScore >= 78 && iqScore < 78) {
    return "今日 Codex：速度快，容易漏细节";
  }

  if (testPassRate < 0.82 || firstPassRate < 0.55) {
    return "今日 Codex：适合小修，不适合大重构";
  }

  if (iqScore >= 82 && speedScore >= 78) {
    return "今日 Codex：聪明且顺手";
  }

  return "今日 Codex：表现正常，注意验收";
}

function buildCodexRecommendation(
  iqScore: number,
  speedScore: number,
  firstPassRate: number,
  taskSummaries: CodexBenchmarkDailyTaskSummary[]
) {
  const weakestTask = [...taskSummaries].sort((left, right) => left.medianIQ - right.medianIQ)[0];

  if (iqScore >= 82 && speedScore < 62) {
    return "复杂任务可以交给它，但先拆阶段并允许更长执行时间。";
  }

  if (speedScore >= 78 && firstPassRate < 0.65) {
    return "适合快速小修；涉及范围控制时要求先列假设和验收清单。";
  }

  if (weakestTask?.taskId === "S4") {
    return "今天歧义需求风险偏高，先让它复述边界再允许改代码。";
  }

  if (weakestTask?.taskId === "S5") {
    return "长上下文任务先抽约束表，再要求最终逐项核对。";
  }

  return "常规修复可以直接派活；交付前保持 typecheck 和范围 diff 审查。";
}

function boolScore(value: boolean) {
  return value ? 1 : 0;
}

function scoreLowerIsBetter(value: number, target: number, max: number) {
  if (value <= target) {
    return 100;
  }

  if (value >= max) {
    return 0;
  }

  return 100 - ((value - target) / (max - target)) * 100;
}

function scoreHigherIsBetter(value: number, target: number, floor: number) {
  if (value >= target) {
    return 100;
  }

  if (value <= floor) {
    return 0;
  }

  return ((value - floor) / (target - floor)) * 100;
}

function mean(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function percentile(values: number[], fraction: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));

  return sorted[index];
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
