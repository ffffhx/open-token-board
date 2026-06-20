#!/usr/bin/env node
// Real eval runner: invokes Codex / Claude Code headless on sandboxed tasks,
// measures timing + usage, runs hidden verify, grades into CodexBenchmarkTaskResult shape.
//
// Usage:
//   node run.mjs --agent codex|claude|both --task all|<id>[,<id>] \
//        --runs 1 --concurrency 3 --out <file.json> [--date YYYY-MM-DD]
import { readdirSync, writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CMD,
  CODEX_MODEL,
  CODEX_EFFORT,
  CLAUDE_MODEL,
  runStreaming,
  sh,
  makeWorkdir,
  cleanup,
  readJson,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TASKS_DIR = join(ROOT, "packages/token-board-core/benchmark/tasks");

function parseArgs(argv) {
  const a = {
    agent: "both",
    task: "all",
    runs: 1,
    concurrency: 3,
    out: "",
    date: "",
    noGenerated: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--agent") (a.agent = v), i++;
    else if (k === "--task") (a.task = v), i++;
    else if (k === "--runs") (a.runs = Number(v)), i++;
    else if (k === "--concurrency") (a.concurrency = Number(v)), i++;
    else if (k === "--out") (a.out = v), i++;
    else if (k === "--date") (a.date = v), i++;
    else if (k === "--no-generated") a.noGenerated = true;
  }
  return a;
}

function loadTasks(filter) {
  const ids = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const want = filter === "all" ? null : new Set(filter.split(","));
  return ids
    .filter((id) => !want || want.has(id))
    .map((id) => {
      const dir = join(TASKS_DIR, id);
      return { dir, meta: readJson(join(dir, "meta.json")) };
    });
}

// ---- agent adapters: run the agent in workdir, return measured telemetry ----

async function runCodex(workdir, prompt, timeoutMs) {
  const lastFile = join(workdir, ".codex-last.txt");
  const tel = {
    firstActionMs: null,
    toolTurns: 0,
    erroredTools: 0,
    commandWaitMs: 0,
    outputTokens: 0,
    inputTokens: 0,
    lastMessage: "",
    agentError: null,
  };
  const cmdStart = new Map();
  const onLine = (line, wallMs) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const item = o.item || {};
    const isAction =
      item.type === "command_execution" || item.type === "file_change";
    if (isAction && tel.firstActionMs === null) tel.firstActionMs = wallMs;
    if (o.type === "item.started" && isAction) {
      tel.toolTurns++;
      cmdStart.set(item.id, wallMs);
    }
    if (o.type === "item.completed" && item.type === "command_execution") {
      const s = cmdStart.get(item.id);
      if (s != null) tel.commandWaitMs += Math.max(0, wallMs - s);
      if (typeof item.exit_code === "number" && item.exit_code !== 0)
        tel.erroredTools++;
    }
    if (o.type === "turn.completed" && o.usage) {
      tel.outputTokens += o.usage.output_tokens || 0;
      tel.inputTokens += o.usage.input_tokens || 0;
    }
    if (o.type === "error") tel.agentError = String(o.message || "error").slice(0, 200);
  };
  const res = await runStreaming(
    "codex",
    [
      "exec",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "-m",
      CODEX_MODEL,
      "-c",
      `model_reasoning_effort="${CODEX_EFFORT}"`,
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      workdir,
      "--json",
      "-o",
      lastFile,
      prompt,
    ],
    { cwd: workdir },
    onLine,
    timeoutMs,
  );
  try {
    tel.lastMessage = readFileSync(lastFile, "utf8");
  } catch {}
  return { tel, res };
}

async function runClaude(workdir, prompt, timeoutMs) {
  const tel = {
    firstActionMs: null,
    toolTurns: 0,
    erroredTools: 0,
    commandWaitMs: 0,
    outputTokens: 0,
    inputTokens: 0,
    lastMessage: "",
    agentError: null,
  };
  let durationApiMs = 0;
  let durationMs = 0;
  const onLine = (line, wallMs) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type === "assistant" && o.message?.content) {
      const tools = o.message.content.filter((c) => c.type === "tool_use");
      if (tools.length) {
        if (tel.firstActionMs === null) tel.firstActionMs = wallMs;
        tel.toolTurns += tools.length;
      }
    }
    if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c.type === "tool_result" && c.is_error) tel.erroredTools++;
      }
    }
    if (o.type === "result") {
      tel.lastMessage = o.result || "";
      durationApiMs = o.duration_api_ms || 0;
      durationMs = o.duration_ms || 0;
      const u = o.usage || {};
      tel.outputTokens = u.output_tokens || 0;
      tel.inputTokens = u.input_tokens || 0;
      if (o.is_error) tel.agentError = (o.subtype || "error").slice(0, 200);
    }
  };
  const res = await runStreaming(
    CLAUDE_CMD,
    [
      "-p",
      prompt,
      "--model",
      CLAUDE_MODEL,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
    ],
    { cwd: workdir },
    onLine,
    timeoutMs,
  );
  // claude: local (tool/command) time ≈ total - api time
  tel.commandWaitMs = Math.max(0, (durationMs || res.durationMs) - durationApiMs);
  return { tel, res };
}

// ---- grading ----

async function gradeTask(taskDir, meta, workdir, lastMessage) {
  // copy hidden verify into workdir
  cpSync(join(taskDir, "verify"), join(workdir, "verify"), { recursive: true });
  const [verifyCmd, ...verifyArgs] = meta.verify.cmd.split(" ");
  const verifyRes = await sh(verifyCmd, verifyArgs, workdir);
  const passed = verifyRes.code === 0;

  // scope: which tracked files changed vs baseline commit
  const diff = await sh("git", ["--no-pager", "diff", "--name-only", "HEAD"], workdir);
  const untracked = await sh(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    workdir,
  );
  const changed = [
    ...diff.out.split("\n"),
    ...untracked.out.split("\n"),
  ]
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("verify/") && s !== ".codex-last.txt");

  const allowed = meta.allowedFiles || [];
  const scopeSafe = changed.every((f) => matchesAllowed(f, allowed));

  // capture the agent's solution (unified diff for edits + content of new files)
  const diffRes = await sh("git", ["--no-pager", "diff", "HEAD", "--", ...allowed], workdir);
  let solutionText = diffRes.out;
  for (const f of changed) {
    if (untracked.out.split("\n").map((s) => s.trim()).includes(f)) {
      const content = await sh("cat", [f], workdir);
      solutionText += `\n--- NEW FILE ${f} ---\n${content.out}`;
    }
  }
  solutionText = solutionText.slice(0, 12000);

  let rootCauseLocated = passed;
  if (meta.verify.rootCauseRegex) {
    const re = new RegExp(meta.verify.rootCauseRegex, "i");
    rootCauseLocated = passed && re.test(lastMessage || "");
  }

  const failLine = !passed
    ? (verifyRes.err || verifyRes.out || "verify failed").split("\n")[0].slice(0, 160)
    : undefined;

  return { passed, scopeSafe, changedFiles: changed.length, rootCauseLocated, failLine, solutionText };
}

function matchesAllowed(file, allowed) {
  return allowed.some((pat) => {
    const re = new RegExp(
      "^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    );
    return re.test(file);
  });
}

// ---- single (agent, task) run ----

async function runOne(agent, task, runIndex) {
  const { dir: taskDir, meta } = task;
  const timeoutMs = (meta.timeoutSeconds || 300) * 1000;
  const workdir = makeWorkdir(taskDir);
  await sh("git", ["init", "-q"], workdir);
  await sh("git", ["add", "-A"], workdir);
  await sh(
    "git",
    ["-c", "user.email=e@e.co", "-c", "user.name=eval", "commit", "-qm", "base"],
    workdir,
  );

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runner = agent === "codex" ? runCodex : runClaude;
  let tel, res;
  try {
    ({ tel, res } = await runner(workdir, meta.prompt, timeoutMs));
  } catch (e) {
    cleanup(workdir);
    throw e;
  }
  const totalMs = Date.now() - t0;

  const grade = await gradeTask(taskDir, meta, workdir, tel.lastMessage);
  cleanup(workdir);

  const totalSeconds = Math.round(totalMs / 1000);
  const firstActionSeconds =
    tel.firstActionMs != null ? Math.round(tel.firstActionMs / 1000) : totalSeconds;
  const commandWaitSeconds = Math.round(tel.commandWaitMs / 1000);
  const outputTokensPerSecond =
    totalSeconds > 0 ? Math.round((tel.outputTokens / totalSeconds) * 10) / 10 : 0;

  let failureReason;
  if (res.timedOut) failureReason = `超时（>${meta.timeoutSeconds}s）`;
  else if (tel.agentError) failureReason = `agent 错误：${tel.agentError}`;
  else if (!grade.passed) failureReason = grade.failLine;
  else if (!grade.scopeSafe) failureReason = "改动超出允许范围";

  const result = {
    taskId: meta.id,
    title: meta.title,
    kind: meta.kind,
    passed: grade.passed,
    firstPass: grade.passed,
    scopeSafe: grade.scopeSafe,
    followedInstructions: grade.scopeSafe && !res.timedOut,
    rootCauseLocated: grade.rootCauseLocated,
    retries: tel.erroredTools,
    toolTurns: tel.toolTurns,
    changedFiles: grade.changedFiles,
    firstActionSeconds,
    totalSeconds,
    commandWaitSeconds,
    outputTokensPerSecond,
    inputTokens: tel.inputTokens,
    outputTokens: tel.outputTokens,
    failureReason,
    solution: grade.solutionText,
  };
  return { startedAt, result, runIndex };
}

// ---- simple concurrency pool ----

async function pool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const tasks = loadTasks(args.task);
  const agents =
    args.agent === "both" ? ["codex", "claude"] : [args.agent];
  const jobs = [];
  for (const agent of agents)
    for (const task of tasks)
      for (let r = 0; r < args.runs; r++) jobs.push({ agent, task, r });

  console.error(
    `[eval] ${jobs.length} jobs  (${agents.join("+")} × ${tasks.length} tasks × ${args.runs} runs, conc=${args.concurrency})`,
  );

  const runs = []; // per (agent, runIndex) grouped later
  const flat = await pool(jobs, args.concurrency, async (job) => {
    const label = `${job.agent}/${job.task.meta.id}#${job.r + 1}`;
    const tStart = Date.now();
    try {
      const out = await runOne(job.agent, job.task, job.r);
      const r = out.result;
      console.error(
        `[ok] ${label.padEnd(34)} pass=${r.passed ? "Y" : "n"} scope=${r.scopeSafe ? "Y" : "n"} ${r.totalSeconds}s ${Math.round((Date.now() - tStart) / 1000)}s wall`,
      );
      return { agent: job.agent, runIndex: job.r, ...out };
    } catch (e) {
      console.error(`[ERR] ${label}: ${e.message}`);
      return null;
    }
  });

  // group into runs: one run = (agent, runIndex) across all tasks
  const byRun = new Map();
  for (const f of flat.filter(Boolean)) {
    const key = `${f.agent}-run-${f.runIndex + 1}`;
    if (!byRun.has(key))
      byRun.set(key, {
        id: `${args.date || "run"}-${key}`,
        agent: f.agent === "claude" ? "claude-code" : "codex",
        modelLabel:
          f.agent === "claude"
            ? `Claude Code / ${CLAUDE_MODEL === "opus" ? "Opus" : CLAUDE_MODEL}`
            : `Codex / ${CODEX_MODEL} (${CODEX_EFFORT})`,
        startedAt: f.startedAt,
        taskResults: [],
      });
    byRun.get(key).taskResults.push(f.result);
  }

  // catalog of task metadata (only tasks that actually ran)
  const ranTaskIds = new Set();
  for (const r of byRun.values()) for (const t of r.taskResults) ranTaskIds.add(t.taskId);
  const catalog = tasks
    .filter((t) => ranTaskIds.has(t.meta.id))
    .map((t) => {
      const m = t.meta;
      return {
        id: m.id,
        title: m.title,
        shortTitle: m.shortTitle,
        kind: m.kind,
        difficulty: m.difficulty,
        prompt: m.prompt,
        allowedFiles: m.allowedFiles,
        weights: m.weights,
        speedTargets: m.speedTargets,
      };
    });

  const payload = {
    generatedAt: new Date().toISOString(),
    date: args.date || new Date().toISOString().slice(0, 10),
    codexModel: CODEX_MODEL,
    tasks: catalog,
    runs: [...byRun.values()],
  };

  const outPath = args.out || join(ROOT, "packages/token-board-core/benchmark/results/latest.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  // also write a dated archive copy
  const archive = join(ROOT, `packages/token-board-core/benchmark/results/${payload.date}.json`);
  writeFileSync(archive, JSON.stringify(payload, null, 2));

  // emit the generated TS module the web app imports
  if (!args.noGenerated) {
    const genPath = join(ROOT, "packages/token-board-core/src/benchmark-data.generated.ts");
    const ts =
      "// AUTO-GENERATED by tools/eval-runner/run.mjs. Do not edit by hand.\n" +
      "export const BENCHMARK_DATA = " +
      JSON.stringify(payload, null, 2) +
      " as const;\n";
    writeFileSync(genPath, ts);
    console.error(`[eval] wrote ${genPath}`);
  }
  console.error(`[eval] wrote ${outPath}  (${payload.runs.length} runs, ${catalog.length} tasks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
