import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createTokenUsageStore, readPostgresLeaderboardBatch } from "../../packages/token-board-core/src/token-board-storage";
import type { TokenBoardMetric, TokenBoardRange } from "../../packages/token-board-core/src/token-leaderboard";
import { createTokenBoardTestFixture } from "../support/fixtures";
import { runLeaderboardSnapshotJob } from "../../apps/token-board-api/src/leaderboard-snapshot-job";

const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL;
const ranges: TokenBoardRange[] = ["today", "1D", "7D", "30D", "90D", "week", "month", "lastweek", "lastmonth"];
const metrics: TokenBoardMetric[] = ["tokens", "cost", "sessions", "messages", "users", "lines"];

test("Postgres batch preserves every range/metric, refreshes corrected data, and isolates worker failures", {
  skip: !databaseUrl && "Set TOKEN_BOARD_TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async () => {
  const schema = `snapshot_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  const baseline = process.env.TOKEN_BOARD_BASELINE_STORAGE
    ? await import(process.env.TOKEN_BOARD_BASELINE_STORAGE)
    : { createTokenUsageStore };
  const oracle = await baseline.createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  const fixture = createTokenBoardTestFixture(new Date("2026-09-14T12:00:00Z"));
  // Exercise a tied current rank, missing quality signals, and previous-only users.
  fixture.events.push({ ...fixture.events[0], id: "tie", userId: "github:tie", displayName: "Tie", linesWritten: null });
  const options = { databaseUrl: databaseUrl!, postgresSchema: schema, ranges, metrics, now: fixture.now };
  try {
    await store.insertEvents(fixture.events);
    const batch = await readPostgresLeaderboardBatch(options);
    console.info(`Built ${batch.length} batch entries`);
    assert.equal(batch.length, 54);
    for (const entry of batch) {
      const expected = await oracle.getLeaderboardSummary!({ range: entry.range, metric: entry.metric, now: fixture.now });
      assert.ok(isDeepStrictEqual({ records: entry.records, summary: entry.summary }, expected), `${entry.range}/${entry.metric} matches the legacy result`);
    }
    console.info("All 54 legacy comparisons passed");
    const corrected = { ...fixture.events[0], inputTokens: fixture.events[0].inputTokens + 1000, totalTokens: fixture.events[0].totalTokens + 1000 };
    await store.insertEvents([corrected]);
    const next = await readPostgresLeaderboardBatch(options);
    assert.equal(next[0].summary.totalTokens, batch[0].summary.totalTokens + 1000);
    assert.deepEqual(next[0].summary, (await oracle.getLeaderboardSummary!({ range: "today", metric: "tokens", now: fixture.now })).summary);
    const worker = await runLeaderboardSnapshotJob({ ...options, now: fixture.now.toISOString() });
    assert.ok(isDeepStrictEqual(worker, JSON.parse(JSON.stringify(next))), "Worker preserves JSON response semantics");
    await assert.rejects(runLeaderboardSnapshotJob({ ...options, now: fixture.now.toISOString() }, 1), /exceeded/);
    await assert.rejects(runLeaderboardSnapshotJob({ ...options, postgresSchema: "missing_snapshot_schema", now: fixture.now.toISOString() }), /does not exist/);
    assert.ok(isDeepStrictEqual(await runLeaderboardSnapshotJob({ ...options, now: fixture.now.toISOString() }), JSON.parse(JSON.stringify(next))), "Worker recovers after timeout and query failure");
  } finally {
    await store.close?.();
    await oracle.close?.();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
