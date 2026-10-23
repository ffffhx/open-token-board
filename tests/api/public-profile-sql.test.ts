import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createTokenUsageStore } from "../../packages/token-board-core/src/token-board-storage";
import { startTokenBoardHarness } from "../support/harness";

test("PostgreSQL public profile aggregates match the original event-based API", { skip: !process.env.TOKEN_BOARD_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL!;
  const schema = `profile_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  const harness = await startTokenBoardHarness();
  try {
    await store.insertEvents(harness.fixture.events);
    const response = await fetch(`${harness.apiUrl}/api/usage/user?login=${harness.fixture.primaryLogin}&now=${encodeURIComponent(harness.fixture.now.toISOString())}`);
    assert.equal(response.status, 200);
    const expected = await response.json();
    const actual = await store.getPublicProfileAggregate!(harness.identities.alice.userId, undefined, harness.fixture.now, 365, 8);
    assert.ok(actual);
    assert.ok(isDeepStrictEqual(actual.totals, expected.profile.totals), "all profile totals match");
    assert.equal(actual.displayName, expected.user.displayName);
    assert.equal(actual.team, expected.user.team);
    assert.equal(actual.joinedAt, expected.profile.joinedAt);
    assert.equal(actual.lastReportedAt, expected.profile.lastReportedAt);
    assert.ok(isDeepStrictEqual(actual.models, expected.profile.models), "model ranking, sessions and shares match");
    assert.ok(isDeepStrictEqual(actual.tools, expected.profile.tools), "tool ranking, sessions and shares match");
    assert.ok(isDeepStrictEqual(actual.daily, expected.profile.daily365.filter((point: { tokens: number }) => point.tokens > 0).map((point: { date: string; tokens: number }) => ({ date: point.date, tokens: point.tokens }))), "Shanghai daily boundaries match");
    assert.equal(await store.getPublicProfileAggregate!(harness.identities.alice.userId, ["name-not-present"], harness.fixture.now, 365, 8), null, "name-scoped profiles do not include unrelated history");
    assert.equal(await store.getPublicProfileAggregate!("nonexistent", undefined, harness.fixture.now, 365, 8), null);
  } finally { await harness.close(); await store.close?.(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});
