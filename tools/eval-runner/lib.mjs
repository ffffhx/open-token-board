// Shared helpers for the real eval runner.
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CLAUDE_CMD =
  process.env.EVAL_CLAUDE_CMD ||
  "/Users/bytedance/Documents/Codex/2026-06-10/aws-aws-cc-ip-aws/outputs/claude-clash.sh";
// Flagship + highest-reasoning defaults.
export const CODEX_MODEL = process.env.EVAL_CODEX_MODEL || "gpt-5.5";
export const CODEX_EFFORT = process.env.EVAL_CODEX_EFFORT || "xhigh";
export const CLAUDE_MODEL = process.env.EVAL_CLAUDE_MODEL || "opus";

export function now() {
  return Date.now();
}

// Spawn a child, stream stdout line-by-line to onLine(line, wallMs), enforce timeout.
// Returns { code, timedOut, stderr, durationMs }.
export function runStreaming(cmd, args, opts, onLine, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let buf = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) onLine(line, Date.now() - started);
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf, Date.now() - started);
      resolve({ code, timedOut, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += `\nspawn error: ${err.message}`;
      resolve({ code: -1, timedOut, stderr, durationMs: Date.now() - started });
    });
  });
}

export function sh(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: -1, out, err: e.message }));
  });
}

export function makeWorkdir(taskDir) {
  const dir = mkdtempSync(join(tmpdir(), "eval-"));
  cpSync(join(taskDir, "workspace"), dir, { recursive: true });
  return dir;
}

export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

export function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

export function fileExists(p) {
  return existsSync(p);
}
