// Parity harness: OLD collectLocalTokenUsage vs ASC adapter (collectLocalTokenUsageViaAsc).
//
// Runs both collectors over the REAL ~/.codex + ~/.claude logs with an identical
// config, then compares per-engine totals and per-session (uuid-normalized) token
// + cost. sanitizeIngestEvents is intentionally NOT run on either side — we want
// the raw collector output so any difference is attributable to the parser/pricing,
// not the shared redaction/dedup chain.
//
// Run with tsx (it transpiles the imported .ts collectors):
//   pnpm --filter @open-token-board/api exec tsx ../../scripts/parity-asc.mjs
// or from repo root:
//   node_modules/.../tsx scripts/parity-asc.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(__dirname, "../packages/token-board-core/src");

const { collectLocalTokenUsage } = await import(`${coreSrc}/token-usage-collector.ts`);
const { collectLocalTokenUsageViaAsc } = await import(`${coreSrc}/asc-collector.ts`);

// Wide window + high file budget so both collectors scan the same full history.
const CONFIG = {
  userId: "local",
  displayName: "Local",
  team: "Friends",
  includeDefaultSources: true,
  sinceHours: 24 * 365 * 6,
  maxFiles: 20000,
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function normKey(ev) {
  const raw = String(ev.sessionId || "");
  const m = raw.match(UUID_RE);
  return (m ? m[0] : raw.replace(/\.jsonl$/i, "")).toLowerCase();
}

function engineOf(ev) {
  const s = String(ev.source || "");
  if (s.includes("claude")) return "claude";
  if (s.includes("codex")) return "codex";
  return s || "other";
}

function blankTotals() {
  return { input: 0, cached: 0, output: 0, reasoning: 0, total: 0, cost: 0, records: 0, sessions: new Set() };
}

function accumulate(events) {
  const byEngine = { codex: blankTotals(), claude: blankTotals(), other: blankTotals() };
  const bySession = new Map(); // normKey -> { engine, total, cost, records }
  for (const ev of events) {
    const eng = engineOf(ev);
    const t = byEngine[eng] || (byEngine[eng] = blankTotals());
    t.input += ev.inputTokens || 0;
    t.cached += ev.cachedInputTokens || 0;
    t.output += ev.outputTokens || 0;
    t.reasoning += ev.reasoningOutputTokens || 0;
    t.total += ev.totalTokens || 0;
    t.cost += ev.costUsd || 0;
    t.records += 1;
    const key = normKey(ev);
    t.sessions.add(key);
    const sKey = `${eng}:${key}`;
    const s = bySession.get(sKey) || { engine: eng, total: 0, cost: 0, records: 0 };
    s.total += ev.totalTokens || 0;
    s.cost += ev.costUsd || 0;
    s.records += 1;
    bySession.set(sKey, s);
  }
  return { byEngine, bySession };
}

function fmt(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function ratio(oldV, newV) {
  if (!newV) return oldV ? "∞" : "1.00";
  return (oldV / newV).toFixed(3);
}

console.log("== Parity: OLD collectLocalTokenUsage vs ASC adapter ==\n");
console.log("config:", JSON.stringify(CONFIG), "\n");

const tOld0 = Date.now();
const oldEvents = await collectLocalTokenUsage(CONFIG);
const tOld = Date.now() - tOld0;

const tNew0 = Date.now();
const newEvents = await collectLocalTokenUsageViaAsc(CONFIG);
const tNew = Date.now() - tNew0;

console.log(`OLD: ${oldEvents.length} events in ${tOld}ms`);
console.log(`ASC: ${newEvents.length} events in ${tNew}ms\n`);

const oldAgg = accumulate(oldEvents);
const newAgg = accumulate(newEvents);

console.log("== Per-engine totals (OLD -> ASC, ratio OLD/ASC) ==");
for (const eng of ["codex", "claude", "other"]) {
  const o = oldAgg.byEngine[eng] || blankTotals();
  const n = newAgg.byEngine[eng] || blankTotals();
  if (!o.records && !n.records) continue;
  console.log(`\n[${eng}]`);
  for (const field of ["total", "input", "cached", "output", "reasoning", "cost"]) {
    console.log(
      `  ${field.padEnd(10)} OLD ${fmt(o[field]).padStart(16)} | ASC ${fmt(n[field]).padStart(16)} | ratio ${ratio(o[field], n[field])}`
    );
  }
  console.log(`  records    OLD ${String(o.records).padStart(16)} | ASC ${String(n.records).padStart(16)}`);
  console.log(`  sessions   OLD ${String(o.sessions.size).padStart(16)} | ASC ${String(n.sessions.size).padStart(16)}`);
}

// Per-session join: how many sessions matched, biggest token deltas.
const allKeys = new Set([...oldAgg.bySession.keys(), ...newAgg.bySession.keys()]);
let matched = 0;
let onlyOld = 0;
let onlyNew = 0;
const deltas = [];
for (const k of allKeys) {
  const o = oldAgg.bySession.get(k);
  const n = newAgg.bySession.get(k);
  if (o && n) {
    matched += 1;
    deltas.push({ k, eng: o.engine, oldT: o.total, newT: n.total, oldC: o.cost, newC: n.cost });
  } else if (o) {
    onlyOld += 1;
  } else {
    onlyNew += 1;
  }
}

console.log("\n== Per-session join (uuid-normalized) ==");
console.log(`  matched: ${matched} | only-OLD: ${onlyOld} | only-ASC: ${onlyNew}`);

// Largest absolute token deltas among matched sessions.
deltas.sort((a, b) => Math.abs(b.oldT - b.newT) - Math.abs(a.oldT - a.newT));
console.log("\n== Top 15 matched sessions by |token delta| ==");
for (const d of deltas.slice(0, 15)) {
  console.log(
    `  [${d.eng}] ${d.k}  tok OLD ${fmt(d.oldT).padStart(14)} -> ASC ${fmt(d.newT).padStart(14)} (r=${ratio(d.oldT, d.newT)})  cost ${fmt(d.oldC)} -> ${fmt(d.newC)}`
  );
}

// Intent classification.
console.log("\n== Intent check ==");
function intent(eng) {
  const o = oldAgg.byEngine[eng] || blankTotals();
  const n = newAgg.byEngine[eng] || blankTotals();
  if (!o.records && !n.records) return;
  const r = o.total && n.total ? o.total / n.total : null;
  if (eng === "codex") {
    const ok = r != null && r > 0.9 && r < 1.1;
    console.log(`  codex token ratio OLD/ASC = ${r?.toFixed(3)} -> ${ok ? "OK (~1x, near-equal as expected)" : "REVIEW (expected ~1x)"}`);
  } else if (eng === "claude") {
    const ok = r != null && r > 1.5 && r < 3.0;
    console.log(`  claude token ratio OLD/ASC = ${r?.toFixed(3)} -> ${ok ? "OK (in expected ~2.2x dedup-correction band 1.5-3.0x)" : "REVIEW (expected ~2.2x down)"}`);
  }
}
intent("codex");
intent("claude");
if (oldAgg.byEngine.other?.records || newAgg.byEngine.other?.records) {
  console.log(`  NOTE: 'other'/custom source present — ASC does not cover custom usage; OLD-only by design.`);
}
console.log("\n== done ==");
