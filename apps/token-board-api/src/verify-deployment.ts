import assert from "node:assert/strict";

const base = process.env.TOKEN_BOARD_VERIFY_URL || "http://127.0.0.1:8789";
const since = Number(process.env.TOKEN_BOARD_DEPLOY_STARTED_AT || Date.now());
const deadline = Date.now() + 240_000;
let lastError = "Waiting for the first successful snapshot refresh";
while (Date.now() < deadline) {
  try {
    const healthResponse = await fetch(`${base}/api/usage/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as { ok: boolean; leaderboardSnapshots: { entries: number; lastCompletedAt: string; lastError: string | null } };
    assert.equal(health.ok, true);
    assert.equal(health.leaderboardSnapshots.entries, 54);
    assert.equal(health.leaderboardSnapshots.lastError, null);
    assert.ok(Date.parse(health.leaderboardSnapshots.lastCompletedAt) >= since, "must finish a new refresh after deployment");
    const statsResponse = await fetch(`${base}/api/usage/stats?range=today&metric=tokens`, { signal: AbortSignal.timeout(10000) });
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json() as { source: string; summary: { totalTokens: number; users: unknown[] } };
    assert.equal(stats.source, "snapshot");
    assert.ok(Number.isFinite(stats.summary.totalTokens));
    assert.ok(Array.isArray(stats.summary.users));
    console.log("Deployment verified: database health, 54 newly refreshed snapshots and usage stats");
    process.exit(0);
  } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
throw new Error(`Deployment verification failed: ${lastError}`);
