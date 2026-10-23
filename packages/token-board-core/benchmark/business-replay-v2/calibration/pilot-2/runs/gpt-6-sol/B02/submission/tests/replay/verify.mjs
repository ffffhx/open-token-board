import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { database, root, service } from '../../replay/run.mjs';
import { fixture, METRICS, NOW, RANGES } from '../../replay/fixture.mjs';

const baseline = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/baseline.json'), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/candidate.json'), 'utf8'));
assert.equal(candidate.entries.length, RANGES.length * METRICS.length);
assert.deepStrictEqual(candidate.entries, baseline.entries);
assert(candidate.samples.every(sample => sample.reads.length && sample.reads.every(read =>
  read.status === 200 && read.source === 'snapshot' && read.summarySha256)));

const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(runtime.runs, 'verify-'));
const db = await database(runtime, path.join(dir, 'db'));
const { createTokenUsageStore } = await import(pathToFileURL(path.join(root, 'packages/token-board-core/src/token-board-storage.ts')));
const store = await createTokenUsageStore({ databaseUrl: db.url, postgresSchema: 'replay', dataFile: 'unused' });
const options = RANGES.flatMap(range => METRICS.map(metric => ({ range, metric, now: new Date(NOW) })));
let app;
try {
  async function check(label) {
    const actual = await store.getLeaderboardSummaries(options);
    const expected = [];
    for (const option of options) expected.push(await store.getLeaderboardSummary(option));
    assert.deepStrictEqual(actual, expected, `${label}: batch and individual results differ`);
    console.log(`${label}: ${actual.length} complete results match`);
  }

  await check('empty');
  const events = fixture({ days: 35, users: 4, perDay: 1 });
  await store.insertEvents(events);
  await check('users and Shanghai boundaries');
  const corrected = { ...events[0], totalTokens: events[0].totalTokens + 97,
    costUsd: (events[0].costUsd ?? 0) + 0.03125, linesWritten: 111 };
  await store.insertEvents([corrected]);
  await check('historical correction');

  app = await service(root, db.url, 'replay', path.join(dir, 'api'));
  const before = await app.command('state');
  assert.equal(before.entries.length, 54);
  await Promise.all([app.command('refresh'), app.command('refresh')]);
  await db.admin.query('ALTER TABLE replay.usage_events RENAME TO usage_events_offline');
  try {
    await assert.rejects(app.command('refresh'));
    const failed = await app.command('state');
    assert.deepStrictEqual(failed.entries, before.entries);
    assert(failed.lastError);
  } finally {
    await db.admin.query('ALTER TABLE replay.usage_events_offline RENAME TO usage_events');
  }
  await app.command('refresh');
  const recovered = await app.command('state');
  assert.equal(recovered.lastError, '');
  assert.deepStrictEqual(recovered.entries, before.entries);
  await app.close();
  app = await service(root, db.url, 'replay', path.join(dir, 'api'));
  assert.deepStrictEqual((await app.command('state')).entries, before.entries);
  console.log('overlap, query failure, recovery, restart: passed');
} finally {
  await app?.close();
  await store.close?.();
  await db.close();
}
