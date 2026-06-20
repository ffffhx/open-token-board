#!/usr/bin/env node
// Dual-blind code-quality judging.
//
// For each coding task, take each agent's captured solution (diff). Anonymize as
// Solution A / B (randomized order). Have BOTH CLIs (codex + claude) score each
// solution on readability / simplicity / robustness / idiomaticity. Average the
// two judges' scores, de-anonymize, and write quality scores back into the payload.
//
// Usage: node judge.mjs --in <payload.json> [--out <payload.json>] [--no-generated]
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { CLAUDE_CMD, CODEX_MODEL, CLAUDE_MODEL } from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const JUDGE_EFFORT = process.env.EVAL_JUDGE_EFFORT || "high";
const CODE_KINDS = new Set(["typescript-fix", "refactor", "algorithm", "ui-typecheck", "ambiguity-control"]);

function parseArgs(argv) {
  const a = { in: "", out: "", noGenerated: false, onlyNew: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--in") (a.in = argv[++i]);
    else if (k === "--out") (a.out = argv[++i]);
    else if (k === "--no-generated") a.noGenerated = true;
    else if (k === "--only-new") a.onlyNew = true;
  }
  if (!a.in) a.in = join(ROOT, "packages/token-board-core/benchmark/results/latest.json");
  if (!a.out) a.out = a.in;
  return a;
}

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => res({ code, out, err }));
    child.on("error", (e) => res({ code: -1, out, err: e.message }));
  });
}

function extractJson(text) {
  if (!text) return null;
  // strip code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    A: { type: "object", properties: scoreProps(), required: ["readability", "simplicity", "robustness", "idiomatic", "overall"], additionalProperties: false },
    B: { type: "object", properties: scoreProps(), required: ["readability", "simplicity", "robustness", "idiomatic", "overall"], additionalProperties: false },
    winner: { type: "string", enum: ["A", "B", "tie"] },
    reason: { type: "string" },
  },
  required: ["A", "B", "winner", "reason"],
  additionalProperties: false,
};
function scoreProps() {
  return {
    readability: { type: "number" },
    simplicity: { type: "number" },
    robustness: { type: "number" },
    idiomatic: { type: "number" },
    overall: { type: "number" },
  };
}

function buildPrompt(task, solA, solB) {
  return `你是一名严格、公正的资深代码评审。下面是同一道编程题的两份匿名解法（Solution A / Solution B），都已通过隐藏功能测试。请只评判**代码质量**（不是功能对错），从四个维度各打 0-100 分：
- readability 可读性（命名、结构、注释是否恰当）
- simplicity 简洁性（是否最小必要复杂度，无冗余/过度设计）
- robustness 鲁棒性（边界、错误处理、不偷工减料）
- idiomatic 地道性（是否符合现代 JS/Node 习惯写法）
再给每份一个 overall（0-100 综合），并选出 winner（A/B/tie）和一句话理由。

【题目要求】
${task.title}
${task.prompt}

【Solution A】
${solA || "(空)"}

【Solution B】
${solB || "(空)"}

只输出一个 JSON：{"A":{"readability":..,"simplicity":..,"robustness":..,"idiomatic":..,"overall":..},"B":{...},"winner":"A|B|tie","reason":".."}`;
}

async function judgeWithCodex(prompt) {
  const dir = mkdtempSync(join(tmpdir(), "judge-cx-"));
  const schemaFile = join(dir, "schema.json");
  const lastFile = join(dir, "last.txt");
  writeFileSync(schemaFile, JSON.stringify(SCORE_SCHEMA));
  const r = await run(
    "codex",
    [
      "exec", "--skip-git-repo-check", "--ignore-user-config",
      "-m", CODEX_MODEL, "-c", `model_reasoning_effort="${JUDGE_EFFORT}"`,
      "--sandbox", "read-only", "-C", dir,
      "--output-schema", schemaFile, "-o", lastFile, prompt,
    ],
    { cwd: dir },
  );
  let parsed = null;
  try { parsed = extractJson(readFileSync(lastFile, "utf8")); } catch {}
  rmSync(dir, { recursive: true, force: true });
  return parsed;
}

async function judgeWithClaude(prompt) {
  const dir = mkdtempSync(join(tmpdir(), "judge-cl-"));
  const r = await run(
    CLAUDE_CMD,
    ["-p", prompt, "--model", CLAUDE_MODEL, "--output-format", "json", "--permission-mode", "bypassPermissions"],
    { cwd: dir },
  );
  let parsed = null;
  try {
    const outer = JSON.parse(r.out);
    parsed = extractJson(outer.result || "");
  } catch {
    parsed = extractJson(r.out);
  }
  rmSync(dir, { recursive: true, force: true });
  return parsed;
}

function pickSolution(payload, agent, taskId) {
  const runs = payload.runs.filter((r) => r.agent === agent);
  const sols = runs
    .map((r) => r.taskResults.find((t) => t.taskId === taskId))
    .filter(Boolean);
  const passing = sols.find((s) => s.passed && s.solution && s.solution.length > 20);
  return (passing || sols.find((s) => s.solution) || {}).solution || "";
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = JSON.parse(readFileSync(args.in, "utf8"));
  const existingQuality = payload.quality ?? {};
  let codeTasks = payload.tasks.filter((t) => CODE_KINDS.has(t.kind));
  if (args.onlyNew) codeTasks = codeTasks.filter((t) => !existingQuality[t.id]);
  console.error(`[judge] ${codeTasks.length} code tasks × 2 judges${args.onlyNew ? " (only new)" : ""}`);

  const quality = { ...existingQuality }; // taskId -> { codex, "claude-code", winner, reason }
  let idx = 0;
  for (const task of codeTasks) {
    const codexSol = pickSolution(payload, "codex", task.id);
    const claudeSol = pickSolution(payload, "claude-code", task.id);
    if (!codexSol && !claudeSol) {
      console.error(`[judge] skip ${task.id} (no solutions)`);
      continue;
    }
    // anonymize: even idx => A=codex; odd => A=claude
    const aIsCodex = idx % 2 === 0;
    idx++;
    const solA = aIsCodex ? codexSol : claudeSol;
    const solB = aIsCodex ? claudeSol : codexSol;
    const prompt = buildPrompt(task, solA, solB);

    const [cx, cl] = await Promise.all([judgeWithCodex(prompt), judgeWithClaude(prompt)]);
    if (!(cx && cx.A && cx.B)) console.error(`[judge]   ${task.id}: codex judge returned no valid JSON`);
    if (!(cl && cl.A && cl.B)) console.error(`[judge]   ${task.id}: claude judge returned no valid JSON`);
    const judges = [cx, cl].filter((j) => j && j.A && j.B);
    if (!judges.length) {
      console.error(`[judge] ${task.id}: both judges failed to return JSON`);
      continue;
    }
    const avgA = mean(judges.map((j) => num(j.A.overall)));
    const avgB = mean(judges.map((j) => num(j.B.overall)));
    const dimsA = avgDims(judges.map((j) => j.A));
    const dimsB = avgDims(judges.map((j) => j.B));
    const codexScore = aIsCodex ? avgA : avgB;
    const claudeScore = aIsCodex ? avgB : avgA;
    const codexDims = aIsCodex ? dimsA : dimsB;
    const claudeDims = aIsCodex ? dimsB : dimsA;
    quality[task.id] = {
      codex: round1(codexScore),
      "claude-code": round1(claudeScore),
      codexDims,
      claudeDims,
      judges: judges.length,
      winner: codexScore === claudeScore ? "tie" : codexScore > claudeScore ? "codex" : "claude-code",
    };
    console.error(
      `[judge] ${task.id.padEnd(20)} codex=${round1(codexScore)} claude=${round1(claudeScore)} (judges=${judges.length})`,
    );
  }

  payload.quality = quality;
  payload.judgedAt = new Date().toISOString();
  writeFileSync(args.out, JSON.stringify(payload, null, 2));
  if (!args.noGenerated) {
    const genPath = join(ROOT, "packages/token-board-core/src/benchmark-data.generated.ts");
    writeFileSync(
      genPath,
      "// AUTO-GENERATED by tools/eval-runner. Do not edit by hand.\nexport const BENCHMARK_DATA = " +
        JSON.stringify(payload, null, 2) +
        " as const;\n",
    );
    console.error(`[judge] wrote ${genPath}`);
  }
  console.error(`[judge] wrote ${args.out} (${Object.keys(quality).length} judged)`);
}

function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function round1(v) { return Math.round(v * 10) / 10; }
function avgDims(list) {
  const keys = ["readability", "simplicity", "robustness", "idiomatic"];
  const o = {};
  for (const k of keys) o[k] = round1(mean(list.map((x) => num(x[k]))));
  return o;
}

main().catch((e) => { console.error(e); process.exit(1); });
