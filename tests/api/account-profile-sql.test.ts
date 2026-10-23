import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createTokenUsageStore, readPostgresAccountProfile } from "../../packages/token-board-core/src/token-board-storage";
import { buildTokenAccountUsageProfile, buildTokenLeaderboard, type TokenBoardRange } from "../../packages/token-board-core/src/token-leaderboard";
import { evaluateTokenGoals, type TokenGoal } from "../../packages/token-board-core/src/token-goals";
import { runAccountProfileJob } from "../../apps/token-board-api/src/account-profile-job";
import { createTokenBoardTestFixture } from "../support/fixtures";
import { startTokenBoardHarness } from "../support/harness";

test("account SQL/worker preserves all ranges, lifetime achievements, empty users and daily goals", { skip: !process.env.TOKEN_BOARD_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL!;
  const postgresSchema = `account_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema });
  const fixture = createTokenBoardTestFixture(new Date("2026-09-15T01:00:00Z"));
  const userId = fixture.identities.alice.userId;
  const goals: TokenGoal[] = (["daily_tokens", "weekly_cost_cap", "daily_streak"] as const).map((type, i) => ({ id: type, type, target: [1000, 100, 3][i], createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" }));
  const config = { updatedAt: fixture.now.toISOString(), goals };
  try {
    await store.insertEvents(fixture.events);
    await store.upsertUserConfig(userId, config);
    // Exercise the existing cost-estimation fallback for legacy rows.
    await admin.query(`UPDATE "${postgresSchema}".usage_events SET cost_usd = NULL WHERE id = $1`, [fixture.events[0].id]);
    const events = await store.listEvents();
    for (const range of ["today", "1D", "7D", "30D", "90D", "week", "month", "lastweek", "lastmonth"] as TokenBoardRange[]) {
      const summary = buildTokenLeaderboard(events, { range, metric: "tokens", now: fixture.now });
      const actual = await readPostgresAccountProfile({ databaseUrl, postgresSchema, userId, range, summary, now: fixture.now });
      const expected = buildTokenAccountUsageProfile(events, { userId, range, now: fixture.now });
      expected.config = config;
      expected.goals = evaluateTokenGoals(actual.goals.map((evaluation) => evaluation.goal), events.filter((event) => event.userId === userId), { now: fixture.now });
      assert.deepEqual(actual, expected, `exact account result for ${range}`);
    }
    const range = "1D";
    const now = new Date("2027-01-01T00:00:00Z");
    const summary = buildTokenLeaderboard(events, { range, metric: "tokens", now });
    const inactive = await readPostgresAccountProfile({ databaseUrl, postgresSchema, userId, range, summary, now });
    assert.equal(inactive.user, null);
    assert.deepEqual(inactive.personalBests, buildTokenAccountUsageProfile(events, { userId, range, now }).personalBests);
    const empty = await runAccountProfileJob({ databaseUrl, postgresSchema, userId: "missing", range, summary, now: now.toISOString() });
    assert.equal(empty.records, 0);
    assert.equal(empty.user, null);
    assert.deepEqual(empty.goals, []);
    await assert.rejects(runAccountProfileJob({ databaseUrl, postgresSchema, userId, range, summary, now: now.toISOString() }, 1), /timed out/);
    const harness = await startTokenBoardHarness({ databaseUrl, postgresSchema });
    try {
      assert.equal((await fetch(`${harness.apiUrl}/api/usage/me`)).status, 401);
      const response = await fetch(`${harness.apiUrl}/api/usage/me?range=1D&now=${fixture.now.toISOString()}&userId=missing`, { headers: { cookie: harness.sessionCookie } });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.user.userId, userId, "the authenticated identity controls the account query");
      assert.equal(payload.profile.records, buildTokenAccountUsageProfile(events, { userId, range: "1D", now: fixture.now }).records);
      assert.ok(payload.profile.user.tokens > 0);
    } finally { await harness.close(); }
  } finally { await store.close?.(); await admin.query(`DROP SCHEMA "${postgresSchema}" CASCADE`); await admin.end(); }
});
