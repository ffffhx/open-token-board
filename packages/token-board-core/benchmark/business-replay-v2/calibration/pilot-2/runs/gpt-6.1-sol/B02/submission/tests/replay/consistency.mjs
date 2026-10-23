import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, database, seed, service, json, delay, businessDigest } from '../../replay/run.mjs';
import { fixture } from '../../replay/fixture.mjs';

const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json'), 'utf8'));
const runDir = fs.mkdtempSync(path.join(runtime.runs, 'consistency-'));
const db = await database(runtime, path.join(runDir, 'db'));
let app;
const result = { runDir, passed: false };
try {
  const events = fixture();
  await seed(root, db.url, 'consistency', events);
  app = await service(root, db.url, 'consistency', path.join(runDir, 'api'));
  const before = await app.command('state');
  const refresh = app.command('refresh');
  let transaction;
  for (let i = 0; i < 300; i++) {
    const activity = await db.admin.query(`SELECT pid, state, backend_xmin FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND backend_xmin IS NOT NULL
        AND state IN ('active', 'idle in transaction') AND query LIKE '%consistency%usage_events%'`);
    if (activity.rows.length) { transaction = activity.rows[0]; break; }
    await delay(5);
  }
  assert(transaction, 'Observe the active refresh transaction after its MVCC snapshot is acquired');
  await db.admin.query('UPDATE consistency.usage_events SET total_tokens = total_tokens + 700000, cost_usd = cost_usd + 0.123456789 WHERE id = $1', [events[0].id]);
  await refresh;
  const during = await app.command('state');
  assert.deepEqual(during.entries, before.entries, 'All 54 entries remain on the pre-update database view');
  await app.command('refresh');
  const after = await app.command('state');
  assert.notDeepEqual(after.entries, before.entries, 'The next refresh includes the committed correction');
  assert.equal(after.entries.length, 54);
  const today = after.entries.find(e => e.range === 'today' && e.metric === 'tokens');
  const oldToday = before.entries.find(e => e.range === 'today' && e.metric === 'tokens');
  assert.equal(today.summary.totalTokens, oldToday.summary.totalTokens + 700000);
  result.transaction = transaction;
  result.before = businessDigest(before.entries); result.after = businessDigest(after.entries);
  result.passed = true;
  console.log('PASS concurrent historical correction: one consistent view, next refresh includes update');
} finally {
  json(path.join(root, 'artifacts/consistency.json'), result);
  await app?.close(); await db.close();
}
