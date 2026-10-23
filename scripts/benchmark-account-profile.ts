import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { normalizeTokenUsageEvent } from "../packages/token-board-core/src/token-leaderboard";
import { readPostgresAccountProfile } from "../packages/token-board-core/src/token-board-storage";

// Run in a disposable, resource-limited service container. All DB access is read-only.
async function main() {
const require = createRequire(new URL("../packages/token-board-core/package.json", import.meta.url));
const { Pool } = require("pg");
const databaseUrl = process.env.TOKEN_BOARD_DATABASE_URL!;
const postgresSchema = process.env.TOKEN_BOARD_POSTGRES_SCHEMA || "token_board";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(postgresSchema)) throw new Error("Invalid schema");
const table = `"${postgresSchema}".usage_events`;
const mode = process.env.TOKEN_BOARD_ACCOUNT_BENCHMARK_MODE || "optimized";
const snapshots = JSON.parse(await readFile("/benchmark/snapshots.json", "utf8"));
const summary = snapshots.entries.find((entry: any) => entry.range === "1D" && entry.metric === "tokens").summary;
const userId = summary.users[0].userId;
const now = new Date(summary.endAt);
const pool = new Pool({ connectionString: databaseUrl, max: 1, options: "-c default_transaction_read_only=on", statement_timeout: 30000 });
try {
  const start = performance.now();
  let transferred = 0;
  let profile;
  if (mode === "baseline") {
    const rows = await pool.query(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY reported_at DESC, created_at DESC`, [userId]);
    transferred = rows.rows.length;
    const events = rows.rows.map((r: any) => normalizeTokenUsageEvent({
      id: r.id, upstreamEventId: r.upstream_event_id, userId: r.user_id, displayName: r.display_name, team: r.team, source: r.source,
      model: r.model, project: r.project, tool: r.tool, timestamp: new Date(r.reported_at).toISOString(),
      inputTokens: Number(r.input_tokens), cacheCreationInputTokens: Number(r.cache_creation_input_tokens), cachedInputTokens: Number(r.cached_input_tokens),
      outputTokens: Number(r.output_tokens), reasoningOutputTokens: Number(r.reasoning_output_tokens), costUsd: r.cost_usd === null ? undefined : Number(r.cost_usd),
      messages: Number(r.messages), sessionId: r.session_id, sessionTitle: r.session_title,
      errorCount: r.error_count == null ? undefined : Number(r.error_count), interruptedCount: r.interrupted_count == null ? undefined : Number(r.interrupted_count),
      toolCallCount: r.tool_call_count == null ? undefined : Number(r.tool_call_count), linesWritten: r.lines_written == null ? undefined : Number(r.lines_written),
    }));
    // Mount the pre-fix module next to the core sources so its relative imports resolve normally.
    const original = await import("../packages/token-board-core/src/token-leaderboard-baseline.ts");
    profile = original.buildTokenAccountUsageProfile(events, { userId, range: "1D", now });
  } else {
    profile = await readPostgresAccountProfile({ databaseUrl, postgresSchema, userId, range: "1D", now, summary });
    transferred = profile.records;
  }
  const durationMs = Math.round(performance.now() - start);
  const comparable = { records: profile.records, daily: profile.daily, models: profile.models, tools: profile.tools, projects: profile.projects,
    sessions: profile.sessions, heatmap: profile.heatmap, topHour: profile.topHour, topWeekday: profile.topWeekday,
    tokens: profile.user?.tokens, input: profile.user?.inputTokens, output: profile.user?.outputTokens, cost: profile.user?.costUsd };
  console.log(JSON.stringify({ mode, durationMs, transferred, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), records: profile.records,
    tokens: profile.user?.tokens, sessions: profile.sessions.length, digest: createHash("sha256").update(JSON.stringify(comparable)).digest("hex") }));
} finally { await pool.end(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
