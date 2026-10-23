import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createTokenUsageStore } from "../../packages/token-board-core/src/token-board-storage";
import { buildTokenLeaderboard, createCustomTokenLeaderboardWindow, type TokenBoardMetric } from "../../packages/token-board-core/src/token-leaderboard";
import { createTokenBoardTestFixture } from "../support/fixtures";

test("custom-date SQL matches event calculations across time boundaries and metrics", { skip: !process.env.TOKEN_BOARD_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL!;
  const schema = `custom_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  const fixture = createTokenBoardTestFixture(new Date("2026-09-14T12:00:00Z"));
  try {
    await store.insertEvents(fixture.events);
    const stored = await store.listEvents();
    for (const [from, to] of [["2026-09-14", "2026-09-14"], ["2026-09-01", "2026-09-07"], ["2026-01-01", "2026-01-02"]]) {
      const window = createCustomTokenLeaderboardWindow(from, to);
      for (const metric of ["tokens", "cost", "sessions", "messages", "users", "lines"] as TokenBoardMetric[]) {
        const options = { range: "7D" as const, metric, window, now: fixture.now };
        const expected = buildTokenLeaderboard(stored, options);
        const actual = (await store.getLeaderboardSummary!(options)).summary;
        const project = (summary: typeof expected) => ({ range: summary.range, startAt: summary.startAt, endAt: summary.endAt, totalTokens: summary.totalTokens, totalCostUsd: summary.totalCostUsd, totalSessions: summary.totalSessions, totalMessages: summary.totalMessages, totalLinesWritten: summary.totalLinesWritten, daily: summary.daily, users: summary.users.map((u) => ({ userId: u.userId, rank: u.rank, previousRank: u.previousRank, tokens: u.tokens, daily: u.daily })) });
        assert.ok(isDeepStrictEqual(project(actual), project(expected)), `${from}/${to}/${metric}: totals, ranks and daily boundaries match`);
      }
    }
    assert.ok((await store.listUserProfileEvents()).length < stored.length, "profile directory returns representative rows instead of the event history");
  } finally { await store.close?.(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});
