import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {root, database, service, businessDigest, json} from '../../replay/run.mjs';
import {fixture, NOW, RANGES, METRICS} from '../../replay/fixture.mjs';
import {createTokenUsageStore as originalStore} from './baseline-storage.ts';
import {createTokenUsageStore} from '../../packages/token-board-core/src/token-board-storage.ts';

// This reference is the supplied storage source, captured before editing. Only
// its relative import paths changed. Compare entire results, without rounding,
// sorting output arrays, dropping fields, or ignoring undefined/null values.
const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json')));
const dir = fs.mkdtempSync(path.join(runtime.runs, 'selftest-'));
const db = await database(runtime, path.join(dir, 'db'));
let app, candidate, original;
const report = {checks: [], profiles: []};
let queries = 0, queryMs = 0;
const nativeQuery = pg.Pool.prototype.query;
pg.Pool.prototype.query = async function (...args) {
  const start = performance.now(); queries++;
  try { return await nativeQuery.apply(this, args); }
  finally { queryMs += performance.now() - start; }
};
const options = {databaseUrl: db.url, postgresSchema: 'replay', dataFile: 'unused'};
async function compare(label) {
  console.log('Comparing:', label);
  const beforeQueries = queries, beforeQueryMs = queryMs;
  const start = performance.now(), expected = [];
  for (const range of RANGES) for (const metric of METRICS) {
    expected.push(await original.getLeaderboardSummary({range, metric, now: new Date(NOW)}));
  }
  const baseline = {ms: performance.now()-start, queries: queries-beforeQueries, queryMs: queryMs-beforeQueryMs};
  const nextQueries = queries, nextQueryMs = queryMs, nextStart = performance.now();
  const actual = [];
  for (const range of RANGES) {
    const summaries = await candidate.getLeaderboardSummaries({range, now: new Date(NOW)});
    for (const metric of METRICS) actual.push(summaries[metric]);
  }
  assert.deepEqual(actual, expected, label);
  report.profiles.push({label, baseline, candidate: {ms: performance.now()-nextStart, queries: queries-nextQueries, queryMs: queryMs-nextQueryMs}});
  report.checks.push(`${label}: all 54 complete results exactly equal`);
  return actual;
}
async function state() { return await app.command('state'); }
async function httpMatches(entries) {
  for (const entry of entries) {
    const res = await fetch(`${app.base}/api/usage/leaderboard?range=${entry.range}&metric=${entry.metric}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'snapshot');
    assert.equal(businessDigest(body.summary), businessDigest(entry.summary));
    assert.deepEqual(body.users, entry.summary.users.slice(0, 50));
  }
}
try {
  candidate = await createTokenUsageStore(options);
  original = await originalStore(options);
  await compare('empty');
  const missing = fixture({days: 2, users: 3, perDay: 1}).map((event, i) => {
    const {linesWritten, ...rest} = event;
    return {...rest, costUsd: i % 2 ? 0.1 : 1 / 3, totalTokens: 100, displayName: 'Tied name'};
  });
  await candidate.insertEvents(missing);
  await compare('all lines absent, equal values/names, non-binary-exact costs');
  await db.admin.query('TRUNCATE replay.usage_events');
  await candidate.insertEvents(fixture());
  await compare('synthetic: multiuser, null lines, ties, Shanghai boundaries');
  app = await service(root, db.url, 'replay', path.join(dir, 'api'));
  const initial = await state();
  assert.equal(initial.entries.length, 54);
  const captured = JSON.parse(fs.readFileSync(path.join(root, 'tests/replay/baseline-measurement.json')));
  assert.deepEqual(initial.entries, captured.entries);
  await httpMatches(initial.entries);
  report.checks.push('HTTP: all 54 complete snapshots match original captured results');

  await db.admin.query('ALTER TABLE replay.usage_events RENAME TO unavailable_events');
  try {
    await assert.rejects(app.command('refresh'));
    const failed = await state();
    assert.ok(failed.lastError);
    assert.deepEqual(failed.entries, initial.entries);
    await httpMatches(initial.entries);
  } finally {
    await db.admin.query('ALTER TABLE replay.unavailable_events RENAME TO usage_events');
  }
  await app.command('refresh');
  assert.equal((await state()).lastError, '');
  report.checks.push('query failure rejects; all old HTTP snapshots remain valid; recovery clears error');

  // Update an old event, rather than append, to catch persistent event caches.
  await db.admin.query("UPDATE replay.usage_events SET total_tokens = total_tokens + 123456, cost_usd = cost_usd + 0.1234567 WHERE id = 'synthetic-90214-45-0-0'");
  const corrected = await compare('historical correction');
  await Promise.all([app.command('refresh'), app.command('refresh'), app.command('refresh')]);
  const updated = await state();
  assert.notEqual(businessDigest(updated.entries), businessDigest(initial.entries));
  assert.equal(businessDigest(updated.entries.map(({records, summary}) => ({records, summary}))), businessDigest(corrected));
  await httpMatches(updated.entries);
  report.checks.push('historical correction and three overlapping refreshes: all 54 results exact');
  console.log('Historical correction and overlapping refreshes passed');

  const snapshotFile = path.join(dir, 'api/snapshots.json');
  fs.renameSync(snapshotFile, snapshotFile+'.saved');
  fs.mkdirSync(snapshotFile);
  await db.admin.query("UPDATE replay.usage_events SET total_tokens = total_tokens + 987 WHERE id = 'synthetic-90214-0-0-0'");
  try {
    await assert.rejects(app.command('refresh'));
    assert.deepEqual((await state()).entries, updated.entries);
    await httpMatches(updated.entries);
  } finally {
    fs.rmdirSync(snapshotFile);
    fs.renameSync(snapshotFile+'.saved', snapshotFile);
  }
  await app.command('refresh');
  assert.equal((await state()).lastError, '');
  const persisted = await state();
  assert.notEqual(businessDigest(persisted.entries), businessDigest(updated.entries));
  const afterPersistenceRecovery = await compare('persistence recovery after new DB data');
  assert.equal(businessDigest(persisted.entries.map(({records, summary}) => ({records, summary}))), businessDigest(afterPersistenceRecovery));
  report.checks.push('snapshot persistence failure rejects, preserves old published cache despite new DB data, then recovers');

  await app.close(); app = undefined;
  app = await service(root, db.url, 'replay', path.join(dir, 'api'));
  assert.deepEqual((await state()).entries, persisted.entries);
  await httpMatches(persisted.entries);
  report.checks.push('restart with persisted cache and fresh DB refresh: all 54 results exact');
  console.log(JSON.stringify(report, null, 2));
  json(path.join(root, 'tests/replay/verification.json'), report);
} finally {
  await app?.close();
  await original?.close?.();
  await candidate?.close?.();
  await db.close();
  pg.Pool.prototype.query = nativeQuery;
}
