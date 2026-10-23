import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createTokenUsageStore, DeviceRevisionConflict, type TokenUsageStore } from "../../packages/token-board-core/src/token-board-storage";
import { normalizeTokenUsageEvent } from "../../packages/token-board-core/src/token-leaderboard";
import { startTokenBoardHarness } from "../support/harness";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const event = (id: string, userId = "user") => normalizeTokenUsageEvent({ id, userId, displayName: userId, source: "codex", model: "gpt-5", timestamp: new Date().toISOString(), inputTokens: 10, outputTokens: 5, totalTokens: 15 });

async function verify(store: TokenUsageStore) {
  await store.insertEvents([event("legacy"), event("other", "other-user")]);
  await store.insertEvents([event("a"), event("shared")], a);
  await store.insertEvents([event("b"), event("shared"), event("legacy")], b);
  assert.equal(await store.countEvents(), 5, "shared events stay globally deduplicated");
  assert.deepEqual((await store.listEvents()).find((e) => e.id === "shared")!.collectionDevices, [a, b]);
  assert.equal((await store.listEvents()).find((e) => e.id === "legacy")!.collectionDevices, undefined, "never guess legacy ownership");
  const revision = await store.getDeviceRevision("user", a);
  const replaced = await store.replaceEventsForDevice("user", a, [event("new-a")], revision);
  assert.equal(replaced.deleted, 1);
  assert.deepEqual((await store.listEvents()).map((e) => e.id).sort(), ["b", "legacy", "new-a", "other", "shared"]);
  assert.deepEqual((await store.listEvents()).find((e) => e.id === "shared")!.collectionDevices, [b]);
  await assert.rejects(store.replaceEventsForDevice("user", a, [event("stale")], revision), DeviceRevisionConflict);
  const beforeUpload = await store.getDeviceRevision("user", a);
  await store.insertEvents([event("arrived-during-scan")], a);
  await assert.rejects(store.replaceEventsForDevice("user", a, [event("stale")], beforeUpload), DeviceRevisionConflict);
  assert.ok((await store.listEvents()).some((e) => e.id === "arrived-during-scan"));
  await assert.rejects(store.replaceEventsForDevice("user", a, [event("wrong", "other-user")], await store.getDeviceRevision("user", a)), /user mismatch/);
  const accountRevision = await store.getDeviceRevision("user", "__account__");
  await store.insertEvents([event("arrived-on-b")], b);
  await assert.rejects(store.replaceEventsForUser("user", [event("account")], accountRevision), DeviceRevisionConflict);
  await store.replaceEventsForUser("user", [event("account")], await store.getDeviceRevision("user", "__account__"));
  assert.deepEqual((await store.listEvents()).map((e) => e.id).sort(), ["account", "other"]);
}

test("file storage preserves device ownership and rejects stale replacement manifests", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "otb-devices-"));
  try {
    const options = { dataFile: path.join(dir, "events.json") };
    const store = await createTokenUsageStore(options);
    await verify(store);
    const reopened = await createTokenUsageStore(options);
    assert.equal(await reopened.getDeviceRevision("user", a), await store.getDeviceRevision("user", a), "revision survives restart");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PostgreSQL device replacement is isolated and transactional", { skip: !process.env.TOKEN_BOARD_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL!;
  const schema = `devices_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createTokenUsageStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  try {
    await verify(store);
    const current = await store.getDeviceRevision("user", a);
    const outcomes = await Promise.allSettled([
      store.replaceEventsForDevice("user", a, [event("race-1")], current),
      store.replaceEventsForDevice("user", a, [event("race-2")], current),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1, "only one concurrent replacement commits");
  } finally { await store.close?.(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});

test("API refuses ambiguous replacement and ignores forged provenance", async () => {
  const harness = await startTokenBoardHarness();
  try {
    const headers = { Authorization: `Bearer ${harness.agentToken}`, "Content-Type": "application/json" };
    const replacement = await fetch(`${harness.apiUrl}/api/usage/replace`, { method: "POST", headers, body: JSON.stringify({ replace: { phase: "start", replaceId: "old-agent-id" } }) });
    assert.equal(replacement.status, 409);
    const upstreamEventId = `upstream:${"a".repeat(32)}`;
    const forged = { ...event("forged"), upstreamEventId, collectionDevices: [b] };
    const ingest = await fetch(`${harness.apiUrl}/api/usage/ingest`, { method: "POST", headers, body: JSON.stringify({ deviceId: a, events: [forged] }) });
    assert.equal(ingest.status, 200, await ingest.text());
    const store = await createTokenUsageStore({ dataFile: harness.dataFile });
    const uploaded = (await store.listEvents()).find((e) => e.upstreamEventId === upstreamEventId);
    assert.ok(uploaded);
    assert.deepEqual(uploaded.collectionDevices, [a]);
  } finally { await harness.close(); }
});
