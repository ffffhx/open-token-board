#!/usr/bin/env node
// Validate tasks: verify must PASS on solution/ and FAIL on workspace/.
// Also checks meta.json required fields. Usage: node validate.mjs [taskId,...]
import { readdirSync, cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TASKS_DIR = join(ROOT, "packages/token-board-core/benchmark/tasks");

const REQUIRED = ["id", "title", "shortTitle", "kind", "difficulty", "prompt", "allowedFiles", "verify", "timeoutSeconds", "weights", "speedTargets"];

function runVerify(srcDir, verifyDir, cmd) {
  const dir = mkdtempSync(join(tmpdir(), "val-"));
  cpSync(srcDir, dir, { recursive: true });
  cpSync(verifyDir, join(dir, "verify"), { recursive: true });
  const [c, ...a] = cmd.split(" ");
  const r = spawnSync(c, a, { cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, err: (r.stderr || "").split("\n")[0] };
}

const filter = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const ids = readdirSync(TASKS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => !filter || filter.has(id))
  .sort();

let ok = 0;
let bad = 0;
for (const id of ids) {
  const dir = join(TASKS_DIR, id);
  const problems = [];
  let meta;
  try {
    meta = JSON.parse(spawnSync("cat", [join(dir, "meta.json")], { encoding: "utf8" }).stdout);
  } catch (e) {
    console.log(`✗ ${id}: meta.json invalid (${e.message})`);
    bad++;
    continue;
  }
  for (const f of REQUIRED) if (meta[f] == null) problems.push(`missing meta.${f}`);
  if (meta.id !== id) problems.push(`meta.id (${meta.id}) != dir name`);
  for (const sub of ["workspace", "verify", "solution"])
    if (!existsSync(join(dir, sub))) problems.push(`missing ${sub}/`);

  if (!problems.length && meta.verify?.cmd) {
    const sol = runVerify(join(dir, "solution"), join(dir, "verify"), meta.verify.cmd);
    if (sol.code !== 0) problems.push(`verify FAILS on solution (${sol.err})`);
    const ws = runVerify(join(dir, "workspace"), join(dir, "verify"), meta.verify.cmd);
    if (ws.code === 0) problems.push(`verify PASSES on workspace (should fail before fix)`);
  }

  if (problems.length) {
    console.log(`✗ ${id}:\n   - ${problems.join("\n   - ")}`);
    bad++;
  } else {
    console.log(`✓ ${id}  [${meta.kind}/${meta.difficulty}]`);
    ok++;
  }
}
console.log(`\n${ok} ok, ${bad} bad, ${ids.length} total`);
process.exit(bad ? 1 : 0);
