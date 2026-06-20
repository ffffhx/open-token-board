#!/usr/bin/env node
// UI-restore eval: agent rebuilds a UI from a text spec; we render its HTML with
// agent-browser, screenshot it, and have dual visual judges (claude + codex, both
// vision-capable) score fidelity 0-100 vs the reference target screenshot.
//
// Usage: node run-ui.mjs [--task all|<id>] [--in latest.json] [--no-generated]
import { readdirSync, readFileSync, writeFileSync, cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  CLAUDE_CMD, CODEX_MODEL, CODEX_EFFORT, CLAUDE_MODEL,
  runStreaming, sh, readJson,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TASKS_DIR = join(ROOT, "packages/token-board-core/benchmark/tasks");
const PUBLIC_DIR = join(ROOT, "apps/web/public/bench");
const JUDGE_EFFORT = process.env.EVAL_VISUAL_JUDGE_EFFORT || "medium";
const AB = "agent-browser";
const CDP = ["--cdp", "9223"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadUiTasks(filter) {
  const want = filter && filter !== "all" ? new Set(filter.split(",")) : null;
  return readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => !want || want.has(id))
    .map((id) => ({ id, dir: join(TASKS_DIR, id) }))
    .filter((t) => existsSync(join(t.dir, "meta.json")) && readJson(join(t.dir, "meta.json")).kind === "ui-restore");
}

async function render(htmlPath, outPng) {
  await sh(AB, [...CDP, "open", `file://${htmlPath}`]);
  await sleep(900); // let fonts/layout settle
  await sh(AB, [...CDP, "screenshot", outPng]);
  return existsSync(outPng);
}

async function runAgentUI(agent, workdir, prompt, timeoutMs) {
  const tel = { outputTokens: 0, lastMessage: "" };
  const lastFile = join(workdir, ".last.txt");
  const onCodex = (line) => {
    let o; try { o = JSON.parse(line); } catch { return; }
    if (o.type === "turn.completed" && o.usage) tel.outputTokens += o.usage.output_tokens || 0;
  };
  const onClaude = (line) => {
    let o; try { o = JSON.parse(line); } catch { return; }
    if (o.type === "result") { tel.outputTokens = (o.usage || {}).output_tokens || 0; tel.lastMessage = o.result || ""; }
  };
  const t0 = Date.now();
  let res;
  if (agent === "codex") {
    res = await runStreaming("codex", [
      "exec", "--skip-git-repo-check", "--ignore-user-config", "-m", CODEX_MODEL,
      "-c", `model_reasoning_effort="${CODEX_EFFORT}"`, "--dangerously-bypass-approvals-and-sandbox",
      "-C", workdir, "--json", "-o", lastFile, prompt,
    ], { cwd: workdir }, onCodex, timeoutMs);
  } else {
    res = await runStreaming(CLAUDE_CMD, [
      "-p", prompt, "--model", CLAUDE_MODEL, "--output-format", "stream-json", "--verbose",
      "--permission-mode", "bypassPermissions",
    ], { cwd: workdir }, onClaude, timeoutMs);
  }
  return { totalSeconds: Math.round((Date.now() - t0) / 1000), outputTokens: tel.outputTokens, timedOut: res.timedOut };
}

function spawnCap(cmd, args, opts = {}) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => res({ code, out, err }));
    c.on("error", (e) => res({ code: -1, out, err: e.message }));
  });
}

function extractJson(text) {
  if (!text) return null;
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = f ? f[1] : text;
  const s = body.indexOf("{"), e = body.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(body.slice(s, e + 1)); } catch { return null; }
}

const VISUAL_PROMPT = (specTitle) =>
  `你是 UI 还原度评审。第一张图是设计稿目标，第二张图是某 agent 用 HTML/CSS 还原的结果。题目：「${specTitle}」。` +
  `请只评判**视觉还原度**（布局、尺寸、间距、颜色、圆角、阴影、字体层级、对齐是否贴近目标），打一个 0-100 的 fidelity 分（100=像素级一致，0=完全不像），并给一句话理由。` +
  `只输出 JSON：{"fidelity": <0-100 数字>, "notes": "一句话"}`;

async function judgeVisualCodex(targetPng, shotPng, title) {
  const dir = mkdtempSync(join(tmpdir(), "vjcx-"));
  const schema = join(dir, "s.json"), last = join(dir, "l.txt");
  writeFileSync(schema, JSON.stringify({ type: "object", properties: { fidelity: { type: "number" }, notes: { type: "string" } }, required: ["fidelity", "notes"], additionalProperties: false }));
  const r = await spawnCap("codex", [
    "exec", "--skip-git-repo-check", "--ignore-user-config", "-m", CODEX_MODEL,
    "-c", `model_reasoning_effort="${JUDGE_EFFORT}"`, "--sandbox", "read-only", "-C", dir,
    "-i", targetPng, "-i", shotPng, "--output-schema", schema, "-o", last, VISUAL_PROMPT(title),
  ], { cwd: dir });
  let parsed = null;
  try { parsed = extractJson(readFileSync(last, "utf8")); } catch {}
  rmSync(dir, { recursive: true, force: true });
  return parsed;
}

async function judgeVisualClaude(targetPng, shotPng, title) {
  const dir = mkdtempSync(join(tmpdir(), "vjcl-"));
  const prompt = `${VISUAL_PROMPT(title)}\n\n目标设计稿图片路径：${targetPng}\n还原结果图片路径：${shotPng}\n请用 Read 工具查看这两张图片后再评分。`;
  const r = await spawnCap(CLAUDE_CMD, [
    "-p", prompt, "--model", CLAUDE_MODEL, "--output-format", "json", "--permission-mode", "bypassPermissions",
  ], { cwd: dir });
  let parsed = null;
  try { parsed = extractJson(JSON.parse(r.out).result || ""); } catch { parsed = extractJson(r.out); }
  rmSync(dir, { recursive: true, force: true });
  return parsed;
}

async function main() {
  const args = { task: "all", in: join(ROOT, "packages/token-board-core/benchmark/results/latest.json"), noGenerated: false, runs: 1 };
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k === "--task") args.task = process.argv[++i];
    else if (k === "--in") args.in = process.argv[++i];
    else if (k === "--no-generated") args.noGenerated = true;
  }
  const uiTasks = loadUiTasks(args.task);
  if (!uiTasks.length) { console.error("[ui] no ui-restore tasks"); return; }
  console.error(`[ui] ${uiTasks.length} ui tasks × 2 agents`);

  const payload = existsSync(args.in) ? readJson(args.in) : { tasks: [], runs: [] };
  const uiSection = { tasks: [], byAgent: { codex: [], "claude-code": [] } };
  const agents = ["codex", "claude"];

  for (const t of uiTasks) {
    const meta = readJson(join(t.dir, "meta.json"));
    const pubDir = join(PUBLIC_DIR, t.id);
    mkdirSync(pubDir, { recursive: true });
    // render target
    const targetPng = join(pubDir, "target.png");
    await render(join(t.dir, "target", "index.html"), targetPng);
    uiSection.tasks.push({ id: t.id, title: meta.title, shortTitle: meta.shortTitle, difficulty: meta.difficulty, prompt: meta.prompt });
    console.error(`[ui] ${t.id}: target rendered`);

    for (const agent of agents) {
      const agentId = agent === "claude" ? "claude-code" : "codex";
      const workdir = mkdtempSync(join(tmpdir(), "ui-"));
      cpSync(join(t.dir, "workspace"), workdir, { recursive: true });
      const run = await runAgentUI(agent, workdir, meta.prompt, (meta.timeoutSeconds || 360) * 1000);
      const shotPng = join(pubDir, `${agentId}.png`);
      const htmlOut = join(workdir, "index.html");
      const rendered = existsSync(htmlOut) ? await render(htmlOut, shotPng) : false;
      // visual judges
      let fidelity = 0, byJudge = {}, notes = "";
      if (rendered) {
        const [cx, cl] = await Promise.all([
          judgeVisualCodex(targetPng, shotPng, meta.title),
          judgeVisualClaude(targetPng, shotPng, meta.title),
        ]);
        const fs = [];
        if (cx && typeof cx.fidelity === "number") { byJudge.codex = Math.round(cx.fidelity); fs.push(cx.fidelity); notes = cx.notes || notes; }
        if (cl && typeof cl.fidelity === "number") { byJudge.claude = Math.round(cl.fidelity); fs.push(cl.fidelity); notes = cl.notes || notes; }
        fidelity = fs.length ? Math.round((fs.reduce((s, v) => s + v, 0) / fs.length) * 10) / 10 : 0;
      }
      rmSync(workdir, { recursive: true, force: true });
      uiSection.byAgent[agentId].push({
        taskId: t.id, totalSeconds: run.totalSeconds, outputTokens: run.outputTokens,
        rendered, fidelity, fidelityByJudge: byJudge, notes,
        shot: `/bench/${t.id}/${agentId}.png`, target: `/bench/${t.id}/target.png`,
      });
      console.error(`[ui] ${t.id}/${agentId}: fidelity=${fidelity} (codex=${byJudge.codex ?? "-"} claude=${byJudge.claude ?? "-"}) ${run.totalSeconds}s`);
    }
  }

  payload.ui = uiSection;
  payload.uiGeneratedAt = new Date().toISOString();
  writeFileSync(args.in, JSON.stringify(payload, null, 2));
  if (!args.noGenerated) {
    const genPath = join(ROOT, "packages/token-board-core/src/benchmark-data.generated.ts");
    writeFileSync(genPath, "// AUTO-GENERATED by tools/eval-runner. Do not edit by hand.\nexport const BENCHMARK_DATA = " + JSON.stringify(payload, null, 2) + " as const;\n");
    console.error(`[ui] wrote ${genPath}`);
  }
  console.error(`[ui] done; screenshots in ${PUBLIC_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
