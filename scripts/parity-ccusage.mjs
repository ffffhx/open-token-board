// Reconcile token-board's local collector with independent market tools and an
// optional Kaboo export over one explicit Asia/Shanghai calendar window.
//
// Examples:
//   pnpm reconcile:usage -- --days 7
//   pnpm reconcile:usage -- --since 2026-07-01 --until 2026-07-07
//   pnpm reconcile:usage -- --since 2026-07-11 --until 2026-07-11 --kaboo ./kaboo.json
//
// Kaboo JSON/CSV may contain rows with source/client/agent, date/day/period and
// totalTokens/total_tokens/tokens. A single { "totalTokens": 123 } is also valid.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(__dirname, "../packages/token-board-core/src");
const TZ = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const args = parseArgs(process.argv.slice(2));
const until = validDay(args.until) || shanghaiDay(new Date());
const days = positiveInt(args.days, 7);
const since = validDay(args.since) || shiftDay(until, -(days - 1));
if (since > until) throw new Error(`--since must be <= --until (${since} > ${until})`);

const providerErrors = {};
const ours = await runOurs(since, until);
const ccusage = args["skip-ccusage"] ? new Map() : safely("ccusage", () => runCcusage(since, until));
const tokscale = args["skip-tokscale"] ? new Map() : safely("tokscale", () => runTokscale(since, until));
const kaboo = args.kaboo ? safely("kaboo", () => readKaboo(args.kaboo, since, until)) : new Map();
const sources = ["codex", "claude"];
const rows = sources.map((source) => buildRow(source, ours, ccusage, tokscale, kaboo));
rows.push(buildRow("all", ours, ccusage, tokscale, kaboo));

const report = {
  timezone: TZ,
  since,
  until,
  collectedAt: new Date().toISOString(),
  activeWindow: until === shanghaiDay(new Date()),
  rows,
  providerErrors,
  notes: [
    "All dates are inclusive Asia/Shanghai calendar dates.",
    "A window containing today can move while scanners run; use a completed historical window for exact parity.",
    "A delta is evidence of a definition/root/snapshot difference, not proof that either tool is wrong.",
    "token-board includes Claude subagent/workflow transcripts because they are billed spend.",
    "Kaboo is compared only when an exported JSON/CSV file is supplied with --kaboo.",
  ],
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (args.strict) {
  const tolerance = Number.isFinite(Number(args.tolerance)) ? Math.max(0, Number(args.tolerance)) : 0.02;
  const mismatches = rows
    .filter((row) => row.source !== "all")
    .flatMap((row) => [row.ccusage, row.tokscale].filter((cell) => cell.total !== null && Math.abs(cell.deltaRatio) > tolerance));
  process.exitCode = mismatches.length || Object.keys(providerErrors).length ? 1 : 0;
}

function safely(name, fn) {
  try {
    return fn();
  } catch (error) {
    providerErrors[name] = error instanceof Error ? error.message : String(error);
    return new Map();
  }
}

async function runOurs(startDay, endDay) {
  const { collectLocalTokenUsageViaAscWithReport } = await import(`${coreSrc}/asc-collector.ts`);
  const startMs = dayStartMs(startDay);
  const endMs = dayStartMs(shiftDay(endDay, 1));
  const sinceHours = Math.max(1, Math.ceil((Date.now() - startMs) / 3_600_000) + 2);
  const result = await collectLocalTokenUsageViaAscWithReport({
    userId: "local",
    displayName: "Local",
    team: "Local",
    includeDefaultSources: true,
    sinceHours,
  });
  if (!result.complete) {
    throw new Error(`local collection incomplete: ${result.parseFailures.length} file(s) could not be parsed`);
  }
  const totals = new Map();
  for (const event of result.events) {
    const timestamp = new Date(event.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp >= endMs) continue;
    add(totals, normalizeSource(event.source), event.totalTokens);
  }
  return totals;
}

function runCcusage(startDay, endDay) {
  const totals = new Map();
  for (const source of ["codex", "claude"]) {
    const parsed = runDlxJson("ccusage@latest", [
      source,
      "daily",
      "--json",
      "--no-cost",
      "--timezone",
      TZ,
      "--since",
      startDay,
      "--until",
      endDay,
    ]);
    add(totals, source, number(parsed?.totals?.totalTokens));
  }
  return totals;
}

function runTokscale(startDay, endDay) {
  const parsed = runDlxJson("tokscale@latest", [
    "--json",
    "--no-spinner",
    "--group-by",
    "client,model",
    "--since",
    startDay,
    "--until",
    endDay,
  ]);
  const totals = new Map();
  for (const entry of parsed?.entries ?? []) {
    const source = normalizeSource(entry.client);
    if (source !== "codex" && source !== "claude") continue;
    add(
      totals,
      source,
      number(entry.input) + number(entry.output) + number(entry.cacheRead) + number(entry.cacheWrite)
    );
  }
  return totals;
}

function runDlxJson(packageName, toolArgs) {
  const pnpm = process.env.TOKEN_BOARD_PNPM || "pnpm";
  const output = execFileSync(pnpm, ["dlx", packageName, ...toolArgs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error(`${packageName} returned no JSON`);
  return JSON.parse(output.slice(jsonStart));
}

function readKaboo(filePath, startDay, endDay) {
  const text = readFileSync(resolve(filePath), "utf8");
  const value = filePath.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.rows)
      ? value.rows
      : Array.isArray(value?.entries)
        ? value.entries
        : Array.isArray(value?.data)
          ? value.data
          : [value];
  const totals = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const day = String(row.date ?? row.day ?? row.period ?? "").slice(0, 10);
    if (day && validDay(day) && (day < startDay || day > endDay)) continue;
    const source = normalizeSource(row.source ?? row.client ?? row.agent ?? row.tool ?? "all");
    const explicit = firstNumber(row.totalTokens, row.total_tokens, row.tokens, row.tokenUsage, row.usage);
    const total =
      explicit ??
      number(row.inputTokens ?? row.input) +
        number(row.outputTokens ?? row.output) +
        number(row.cacheReadTokens ?? row.cacheRead) +
        number(row.cacheCreationTokens ?? row.cacheWrite);
    add(totals, source, total);
  }
  return totals;
}

function buildRow(source, oursMap, ccusageMap, tokscaleMap, kabooMap) {
  const oursTotal = totalFor(oursMap, source);
  return {
    source,
    ours: oursTotal,
    ccusage: comparison(totalForNullable(ccusageMap, source), oursTotal),
    tokscale: comparison(totalForNullable(tokscaleMap, source), oursTotal),
    kaboo: comparison(totalForNullable(kabooMap, source), oursTotal),
  };
}

function comparison(total, oursTotal) {
  if (total === null) return { total: null, delta: null, deltaRatio: null };
  const delta = total - oursTotal;
  return { total, delta, deltaRatio: oursTotal ? delta / oursTotal : total ? 1 : 0 };
}

function printReport(reportValue) {
  console.log(`\nusage reconciliation  ${reportValue.since}..${reportValue.until}  (${reportValue.timezone})`);
  console.log("source       token-board          ccusage         tokscale            kaboo");
  for (const row of reportValue.rows) {
    console.log(
      `${row.source.padEnd(9)} ${fmt(row.ours).padStart(15)} ${fmtCell(row.ccusage).padStart(16)} ${fmtCell(row.tokscale).padStart(16)} ${fmtCell(row.kaboo).padStart(16)}`
    );
  }
  if (reportValue.activeWindow) console.log("\nnote: this window includes today, so active session files can change between scans.");
  for (const [provider, message] of Object.entries(reportValue.providerErrors)) {
    console.log(`warning: ${provider} unavailable: ${message}`);
  }
  console.log("note: deltas are shown against token-board; they do not identify which system is wrong.\n");
}

function fmtCell(cell) {
  if (cell.total === null) return "-";
  const pct = cell.deltaRatio === null ? "" : `${cell.deltaRatio >= 0 ? "+" : ""}${(cell.deltaRatio * 100).toFixed(1)}%`;
  return `${fmt(cell.total)} ${pct}`;
}

function totalFor(map, source) {
  if (source === "all") return [...map.values()].reduce((sum, value) => sum + value, 0);
  return map.get(source) ?? 0;
}

function totalForNullable(map, source) {
  if (!map.size) return null;
  if (source === "all") {
    if (map.has("all")) return map.get("all");
    return [...map.entries()].filter(([key]) => key !== "all").reduce((sum, [, value]) => sum + value, 0);
  }
  return map.has(source) ? map.get(source) : null;
}

function add(map, key, rawValue) {
  const value = number(rawValue);
  map.set(key, (map.get(key) ?? 0) + value);
}

function normalizeSource(value) {
  const source = String(value ?? "").trim().toLowerCase();
  if (source.includes("codex")) return "codex";
  if (source.includes("claude")) return "claude";
  return source || "all";
}

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = csvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, csvLine(line)[index]])));
}

function csvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function dayStartMs(day) {
  return new Date(`${day}T00:00:00+08:00`).getTime();
}

function shiftDay(day, delta) {
  return new Date(dayStartMs(day) + delta * DAY_MS + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function shanghaiDay(date) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function fmt(value) {
  return Math.round(value).toLocaleString("en-US");
}
