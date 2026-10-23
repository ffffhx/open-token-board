import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, database, seed, service, json } from '../../replay/run.mjs';
import { fixture } from '../../replay/fixture.mjs';

const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json'), 'utf8'));
const runDir = fs.mkdtempSync(path.join(runtime.runs, 'lifecycle-'));
const db = await database(runtime, path.join(runDir, 'db'));
let app;
const results = [];
try {
  await seed(root, db.url, 'lifecycle', fixture({ days: 40, users: 4, perDay: 1 }));
  app = await service(root, db.url, 'lifecycle', path.join(runDir, 'api'));
  const good = await app.command('state');
  assert.equal(good.entries.length, 54);
  const file = path.join(app.dir, 'snapshots.json'), previous = file + '.previous';
  const disk = fs.readFileSync(file, 'utf8');
  fs.renameSync(file, previous); fs.mkdirSync(file);
  try {
    await assert.rejects(app.command('refresh'));
    const failed = await app.command('state');
    assert(failed.lastError); assert.equal(failed.refreshing, false);
    assert.deepEqual(failed.entries, good.entries);
    assert.equal(fs.readFileSync(previous, 'utf8'), disk);
    for (const entry of good.entries) {
      const response = await fetch(`${app.base}/api/usage/stats?range=${entry.range}&metric=${entry.metric}`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).summary, entry.summary);
    }
    results.push('persistence failure rejects refresh, retains all 54 cache entries and previous valid file');
  } finally { fs.rmdirSync(file); fs.renameSync(previous, file); }
  await app.command('refresh'); assert.equal((await app.command('state')).lastError, '');
  results.push('persistence recovery succeeds and clears error');
  const dir = app.dir; await app.close(); app = undefined;
  app = await service(root, db.url, 'lifecycle', dir);
  assert.deepEqual((await app.command('state')).entries, good.entries);
  results.push('restart retains exact complete result');
  console.log(JSON.stringify(results));
} finally {
  json(path.join(root, 'artifacts/lifecycle.json'), { runDir, results, passed: results.length === 3 });
  await app?.close(); await db.close();
}
