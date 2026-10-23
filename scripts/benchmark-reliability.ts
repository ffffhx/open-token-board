import { performance } from "node:perf_hooks";
import { createTokenUsageStore } from "../packages/token-board-core/src/token-board-storage";
import { buildTokenLeaderboard, createCustomTokenLeaderboardWindow } from "../packages/token-board-core/src/token-leaderboard";

// Run against an isolated restored database, once per image, with identical limits.
async function main() {
if (!process.env.TOKEN_BOARD_BENCHMARK_DATABASE_URL?.includes("reliability_perf_")) throw new Error("Use the isolated reliability benchmark database");
const mode = process.env.TOKEN_BOARD_BENCHMARK_MODE || "optimized";
const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl: process.env.TOKEN_BOARD_BENCHMARK_DATABASE_URL });
try {
  const options = { range: "7D" as const, metric: "tokens" as const, now: new Date("2026-09-14T15:00:00Z"), window: createCustomTokenLeaderboardWindow("2026-09-01", "2026-09-07") };
  const start = performance.now();
  const summary = mode === "baseline"
    ? buildTokenLeaderboard(await store.listEvents(), options)
    : (await store.getLeaderboardSummary!(options)).summary;
  const customMs = performance.now() - start;
  const profileStart = performance.now();
  const profiles = mode === "baseline" ? await store.listEvents() : await store.listUserProfileEvents();
  console.log(JSON.stringify({ mode, customMs: Math.round(customMs), profileDirectoryMs: Math.round(performance.now() - profileStart), profileRowsTransferred: profiles.length, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), totals: { tokens: summary.totalTokens, input: summary.users.reduce((n, u) => n + u.inputTokens, 0), output: summary.users.reduce((n, u) => n + u.outputTokens, 0), sessions: summary.totalSessions, users: summary.activeUsers, daily: summary.daily } }));
} finally { await store.close?.(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
