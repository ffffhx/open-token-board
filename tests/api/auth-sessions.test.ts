import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createAuthSessionStore, authSessionId, type AuthSessionStore } from "../../apps/token-board-api/src/auth-session-store";
import { createAgentSessionToken, createWebSessionToken } from "../../packages/token-board-core/src/token-board-auth";
import { TEST_AUTH_SECRET } from "../support/fixtures";
import { startTokenBoardHarness } from "../support/harness";

const identity = { userId: "test-user", displayName: "Test" };
async function verify(store: AuthSessionStore) {
  const first = createAgentSessionToken(identity, TEST_AUTH_SECRET, 3600);
  const second = createAgentSessionToken(identity, TEST_AUTH_SECRET, 3600);
  assert.notEqual(first, second, "two devices logged in during the same second get distinct credentials");
  await store.register(identity.userId, first, "agent", "Computer A");
  assert.equal(await store.authorize(identity.userId, second, "agent"), true, "existing credentials migrate without re-login");
  await store.revoke(identity.userId, authSessionId(first));
  assert.equal(await store.authorize(identity.userId, first, "agent"), false);
  assert.equal(await store.authorize(identity.userId, second, "agent"), true);
  await store.revokeAll(identity.userId);
  assert.equal(await store.authorize(identity.userId, second, "agent"), false);
  const unregisteredOld = createAgentSessionToken(identity, TEST_AUTH_SECRET, 3600);
  assert.equal(await store.authorize(identity.userId, unregisteredOld, "agent"), false, "legacy registration cannot bypass revocation cutoff");
  await store.setDisabled(identity.userId, true);
  await assert.rejects(store.register(identity.userId, first, "agent", "Blocked"), /disabled/);
  await store.setDisabled(identity.userId, false);
  assert.equal(await store.authorize(identity.userId, second, "agent"), false, "enabling an account does not resurrect old sessions");
  const outcomes = await Promise.all([store.consumeOAuthState("test-state", Date.now() + 60000), store.consumeOAuthState("test-state", Date.now() + 60000)]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(await store.consumeOAuthState("expired", Date.now() - 1), false);
}

test("file auth state persists revocation and one-use OAuth state", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "otb-auth-"));
  const options = { dataFile: path.join(dir, "auth.json") };
  const store = await createAuthSessionStore(options);
  try {
    await verify(store);
    await store.setDisabled(identity.userId, true);
    const reopened = await createAuthSessionStore(options);
    assert.equal(await reopened.isDisabled(identity.userId), true);
    await reopened.close();
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("PostgreSQL auth revocations and OAuth consumption are shared across instances", { skip: !process.env.TOKEN_BOARD_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TOKEN_BOARD_TEST_DATABASE_URL!;
  const schema = `auth_test_${process.pid}_${Date.now()}`;
  const require = createRequire(new URL("../../packages/token-board-core/package.json", import.meta.url));
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: databaseUrl });
  const store = await createAuthSessionStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  const other = await createAuthSessionStore({ dataFile: "unused", databaseUrl, postgresSchema: schema });
  try {
    await verify(store);
    await store.setDisabled(identity.userId, true);
    assert.equal(await other.isDisabled(identity.userId), true);
    const results = await Promise.all([store.consumeOAuthState("cross-instance", Date.now() + 60000), other.consumeOAuthState("cross-instance", Date.now() + 60000)]);
    assert.deepEqual(results.sort(), [false, true]);
  } finally { await store.close(); await other.close(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});

test("API binds OAuth to its browser and revokes only the selected credential", async () => {
  const harness = await startTokenBoardHarness({ githubClientId: "test-client" });
  try {
    const start = await fetch(`${harness.apiUrl}/api/auth/github/start`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    assert.match(start.headers.get("set-cookie")!, /token_board_oauth=.*HttpOnly; SameSite=Lax/);
    for (const cookie of [undefined, "token_board_oauth=wrong"]) {
      const callback = await fetch(`${harness.apiUrl}/api/auth/github/callback?code=unused&state=${encodeURIComponent(state)}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
      assert.equal(callback.status, 400, "rejects before any GitHub token exchange");
    }
    const token2 = createWebSessionToken(harness.identities.alice, TEST_AUTH_SECRET, 3600);
    const cookie2 = `token_board_session=${token2}`;
    await fetch(`${harness.apiUrl}/api/auth/me`, { headers: { Cookie: cookie2 } });
    const headers = { Cookie: harness.sessionCookie, "Content-Type": "application/json" };
    const sessions = await (await fetch(`${harness.apiUrl}/api/auth/sessions`, { headers })).json();
    assert.ok(sessions.sessions.some((s: { id: string }) => s.id === authSessionId(token2)));
    const denied = await fetch(`${harness.apiUrl}/api/auth/sessions/${authSessionId(token2)}`, { method: "DELETE", headers: { ...headers, Origin: "https://evil.example" } });
    assert.equal(denied.status, 403);
    const deleted = await fetch(`${harness.apiUrl}/api/auth/sessions/${authSessionId(token2)}`, { method: "DELETE", headers });
    assert.equal(deleted.status, 200);
    assert.equal((await (await fetch(`${harness.apiUrl}/api/auth/me`, { headers: { Cookie: cookie2 } })).json()).authenticated, false);
    assert.equal((await (await fetch(`${harness.apiUrl}/api/auth/me`, { headers })).json()).authenticated, true);
    const agentLogout = await fetch(`${harness.apiUrl}/api/auth/agent/session`, { method: "DELETE", headers: { Authorization: `Bearer ${harness.agentToken}` } });
    assert.equal(agentLogout.status, 200);
    const ingest = await fetch(`${harness.apiUrl}/api/usage/ingest`, { method: "POST", headers: { Authorization: `Bearer ${harness.agentToken}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(ingest.status, 401);
    await fetch(`${harness.apiUrl}/api/auth/logout`, { headers, redirect: "manual" });
    assert.equal((await (await fetch(`${harness.apiUrl}/api/auth/me`, { headers })).json()).authenticated, false, "copied browser cookie cannot be reused after logout");
  } finally { await harness.close(); }
});
