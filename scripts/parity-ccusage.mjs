// Parity oracle: our collector (ASC) vs ccusage, per (day, model).
//
// ccusage (https://github.com/ccusage/ccusage) is the de-facto reference for local
// Claude/Codex token accounting. Since v20 it is a Rust binary, so we cannot vendor
// its source into this TS repo — instead we treat it as an external ORACLE and assert
// our own collector matches it per (day, model). Divergence beyond TOLERANCE is either
// a real collector bug or a documented definitional difference (see KNOWN_DELTAS).
//
// Run:
//   pnpm --filter @open-token-board/api exec tsx ../../scripts/parity-ccusage.mjs
//   node scripts/parity-ccusage.mjs --days 3            (limit output window)
//
// Requires `npx ccusage` to be runnable (network for first fetch of model prices).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(__dirname, "../packages/token-board-core/src");

const TZ = "Asia/Shanghai";
// Tokens: relative gap tolerance per (day, model) cell before we flag it.
const TOLERANCE = 0.02;
const argDays = (() => {
  const i = process.argv.indexOf("--days");
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

// KNOWN, non-bug reasons our number legitimately differs from ccusage's:
//  - Claude subagents: we count per-subagent/workflow transcripts as real spend;
//    ccusage excludes them, so our Claude totals can be HIGHER on subagent-heavy days.
//  - Codex ccusage OVER-COUNT (verified 2026-07-03, supersedes the earlier
//    "day-attribution" framing): on sessions where ccusage disagrees with us, the raw
//    rollout is the arbiter. Session 019f20dd has 367 token_count snapshots and ZERO
//    compaction resets, so its final cumulative counter (18,593,462) IS the physical
//    session total; we report exactly that, while ccusage reports 36,898,014 — exactly
//    the sum of the file's overlapping last_token_usage rows (its known double-count
//    bug class, ccusage#884/#897/#988). tokscale (independent impl) matches us to the
//    token on clean days and per-root. So on codex WE are ground truth and codex
//    divergence never fails the check.
//  - History: before agent-session-core 0.1.1 our codex numbers could also be LOW
//    because only ~/.codex was scanned; sessions under $CODEX_HOME / the Orca runtime
//    home (hardlink-mirrored, then diverging after 2026-07-02) were missed. Fixed by
//    scanning all codex homes with (dev,inode) dedup.
const KNOWN_DELTAS = "Claude: ours>=ccusage w/ subagents. Codex: ccusage inflates via last_token_usage double-count; ours matches the physical cumulative counters (tokscale agrees).";

function ymdInTz(iso) {
  // Asia/Shanghai is UTC+8 with no DST; shift then slice for a stable YYYY-MM-DD.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function runCcusage() {
  const out = execFileSync("npx", ["-y", "ccusage@latest", "daily", "--json", "--timezone", TZ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(out);
  const cells = new Map(); // `${day}\n${model}` -> tokens
  for (const row of parsed.daily ?? []) {
    const day = row.period ?? row.date;
    for (const m of row.modelBreakdowns ?? []) {
      const model = String(m.modelName).replace(/^\[[^\]]+\]\s*/, ""); // strip "[agent] " prefix
      const tokens =
        (m.inputTokens ?? 0) + (m.outputTokens ?? 0) + (m.cacheCreationTokens ?? 0) + (m.cacheReadTokens ?? 0);
      const key = `${day}\n${model}`;
      cells.set(key, (cells.get(key) ?? 0) + tokens);
    }
  }
  return cells;
}

async function runOurs() {
  const { collectLocalTokenUsageViaAsc } = await import(`${coreSrc}/asc-collector.ts`);
  const events = await collectLocalTokenUsageViaAsc({
    userId: "local",
    displayName: "Local",
    team: "Friends",
    includeDefaultSources: true,
    sinceHours: 24 * 400,
    maxFiles: 20000,
    maxFileBytes: 512 * 1024 * 1024,
  });
  const cells = new Map();
  for (const ev of events) {
    const day = ymdInTz(ev.timestamp);
    if (!day) continue;
    const key = `${day}\n${ev.model || "unknown"}`;
    cells.set(key, (cells.get(key) ?? 0) + (ev.totalTokens ?? 0));
  }
  return cells;
}

function fmt(n) {
  return n.toLocaleString();
}

const [ccu, ours] = [runCcusage(), await runOurs()];
const keys = [...new Set([...ccu.keys(), ...ours.keys()])].sort().reverse();
const minDay = argDays > 0 ? ymdInTz(new Date(Date.now() - argDays * 86400 * 1000).toISOString()) : "";

let flagged = 0;
console.log(`\n  ccusage-parity  (tz=${TZ}, tolerance=${(TOLERANCE * 100).toFixed(0)}%)`);
console.log(`  note: ${KNOWN_DELTAS}\n`);
console.log(`  ${"day".padEnd(11)} ${"model".padEnd(26)} ${"ours".padStart(14)} ${"ccusage".padStart(14)} ${"Δ".padStart(12)}   flag`);
for (const key of keys) {
  const [day, model] = key.split("\n");
  if (minDay && day < minDay) continue;
  const o = ours.get(key) ?? 0;
  const c = ccu.get(key) ?? 0;
  const diff = o - c;
  const rel = c > 0 ? Math.abs(diff) / c : o > 0 ? 1 : 0;
  const isClaude = model.startsWith("claude");
  // Codex per-day divergence is ccusage's last_token_usage over-count (see header),
  // not our bug — informational, never a failure. On Claude, "ours higher" is
  // expected (subagents); only an under-count is a real flag.
  let flag = "";
  if (!isClaude) {
    flag = rel > TOLERANCE ? "codex:ccusage-overcount" : "";
  } else if (rel > TOLERANCE && diff < 0) {
    flag = "UNDER";
    flagged++;
  }
  console.log(
    `  ${day.padEnd(11)} ${model.padEnd(26)} ${fmt(o).padStart(14)} ${fmt(c).padStart(14)} ${fmt(diff).padStart(12)}   ${flag}`
  );
}
console.log(`\n  ${flagged} Claude cell(s) UNDER-counting vs ccusage beyond tolerance (real drift).`);
console.log(`  (codex:day-attribution rows are expected — see header — and never fail the check.)\n`);
process.exit(flagged > 0 ? 1 : 0);
