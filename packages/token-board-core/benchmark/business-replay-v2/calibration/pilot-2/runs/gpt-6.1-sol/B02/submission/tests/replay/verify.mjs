import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { root, database, seed, service, measure, cleanEnv, freePort, delay, json, businessDigest } from '../../replay/run.mjs';
import { fixture, NOW, RANGES, METRICS } from '../../replay/fixture.mjs';

const require = createRequire(path.join(root, 'apps/token-board-api/package.json'));
const referenceDir = path.join(root, 'tests/replay/reference');
// Executable reference copies are generated from the originals saved before any edits.
// Only import locations change; statistics, SQL and HTTP implementation are untouched.
const storage = fs.readFileSync(path.join(referenceDir, 'storage.original.txt'), 'utf8')
  .replace(/from "\.\/([^\"]+)"/g, 'from "../../../packages/token-board-core/src/$1.ts"');
fs.writeFileSync(path.join(referenceDir, 'storage.ts'), storage);
const baselineServer = fs.readFileSync(path.join(referenceDir, 'server.original.txt'), 'utf8')
  .replace(/from "(@open-token-board\/core[^\"]*)"/g, (_, name) => name.endsWith('/storage')
    ? 'from "./storage.ts"' : `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
  .replace('from "./daily-report"', 'from "../../../apps/token-board-api/src/daily-report.ts"')
  .replace('from "sanitize-html"', `from ${JSON.stringify(pathToFileURL(require.resolve('sanitize-html')).href)}`);
fs.writeFileSync(path.join(referenceDir, 'server.ts'), baselineServer);

async function referenceService(url, schema, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = { ...cleanEnv(), TOKEN_BOARD_PORT: String(port), TOKEN_BOARD_HOST: '127.0.0.1',
    TOKEN_BOARD_DATABASE_URL: url, TOKEN_BOARD_POSTGRES_SCHEMA: schema,
    TOKEN_BOARD_DATA_FILE: path.join(dir, 'usage.json'), TOKEN_BOARD_USERS_FILE: path.join(dir, 'users.json'),
    TOKEN_BOARD_LEADERBOARD_SNAPSHOT_FILE: path.join(dir, 'snapshots.json'),
    TOKEN_BOARD_AGENT_SPEED_DATA_FILE: path.join(dir, 'speed.json'), SNAPSHOT_SHARE_DATA_FILE: path.join(dir, 'shares.json'),
    TOKEN_BOARD_AUTH_SECRET: 'synthetic-replay-only-auth-secret', TOKEN_BOARD_DAILY_REPORT_ENABLED: 'false',
    TOKEN_BOARD_WEEKLY_REPORT_ENABLED: 'false', TOKEN_BOARD_LEADERBOARD_SNAPSHOT_REFRESH_MS: '86400000',
    B02_NOW: NOW, B02_REPLAY_CONTROL: '1', TZ: 'Asia/Shanghai',
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'replay/clock.mjs')).href}` };
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/replay/reference/server.ts'], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '', sequence = 0;
  const pending = new Map();
  child.stdout.on('data', x => { log += x; }); child.stderr.on('data', x => { log += x; });
  child.on('message', m => {
    const op = pending.get(m.id); if (!op) return;
    pending.delete(m.id); clearTimeout(op.timer);
    m.error ? op.reject(Error(m.error)) : op.resolve(m.result);
  });
  child.on('exit', () => {
    for (const op of pending.values()) { clearTimeout(op.timer); op.reject(Error('Reference service exited: ' + log.slice(-2000))); }
    pending.clear();
  });
  const command = operation => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Reference timed out')); }, 120000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, operation });
  });
  const close = async () => {
    fs.writeFileSync(path.join(dir, 'service.log'), log);
    child.kill(); await Promise.race([new Promise(r => child.once('exit', r)), delay(3000)]);
  };
  try {
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw Error(log.slice(-2000));
      try { if ((await fetch(base + '/api/usage/health', { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
      if (i > 120) throw Error('Reference readiness timeout'); await delay(100);
    }
    await command('refresh');
  } catch (error) { await close(); throw error; }
  return { child, base, command, close, dir };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json'), 'utf8'));
const runDir = fs.mkdtempSync(path.join(runtime.runs, 'verify-'));
const db = await database(runtime, path.join(runDir, 'db'));
let baseline, candidate;
const output = { now: NOW, runDir, scenarios: [], pairs: [] };
const artifact = path.join(root, 'artifacts/verification.json');

async function compare(label) {
  const before = await baseline.command('state'), after = await candidate.command('state');
  assert.equal(before.entries.length, 54); assert.equal(after.entries.length, 54);
  assert.deepEqual(after.entries, before.entries, label);
  // Assert the actual HTTP API delivers every complete summary and records count too.
  for (const entry of after.entries) {
    const response = await fetch(`${candidate.base}/api/usage/leaderboard?range=${entry.range}&metric=${entry.metric}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'snapshot');
    assert.deepEqual(body.summary, entry.summary);
    const statsResponse = await fetch(`${candidate.base}/api/usage/stats?range=${entry.range}&metric=${entry.metric}`);
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.equal(stats.records, entry.records); assert.deepEqual(stats.summary, entry.summary);
  }
  output.scenarios.push({ label, entries: 54, sha256: businessDigest(after.entries), httpSummaries: 54 });
  json(artifact, output);
  console.log('PASS', label);
  return after;
}

try {
  const events = fixture();
  await seed(root, db.url, 'verify', events);
  baseline = await referenceService(db.url, 'verify', path.join(runDir, 'baseline'));
  candidate = await service(root, db.url, 'verify', path.join(runDir, 'candidate'));
  await compare('synthetic fixture: boundaries, missing lines, ties, multiple users');
  await measure(baseline); await measure(candidate); // warm both paths once
  for (let round = 0; round < 7; round++) {
    let a, b;
    if (round % 2) { b = await measure(candidate); a = await measure(baseline); }
    else { a = await measure(baseline); b = await measure(candidate); }
    output.pairs.push({ round: round + 1, order: round % 2 ? 'candidate,baseline' : 'baseline,candidate', baseline: a, candidate: b });
    json(artifact, output);
    console.log('PAIR', round + 1, a.durationMs, b.durationMs);
  }
  const a = output.pairs.map(p => p.baseline.durationMs), b = output.pairs.map(p => p.candidate.durationMs);
  const differences = a.map((value, i) => value - b[i]), differenceMedian = median(differences);
  const mad = median(differences.map(d => Math.abs(d - differenceMedian)));
  const aReads = output.pairs.flatMap(p => p.baseline.reads), bReads = output.pairs.flatMap(p => p.candidate.reads);
  assert(aReads.every(r => r.status === 200)); assert(bReads.every(r => r.status === 200));
  const todayDigest = businessDigest((await candidate.command('state')).entries.find(e => e.range === 'today' && e.metric === 'tokens').summary);
  assert(bReads.every(r => r.summarySha256 === todayDigest && r.source === 'snapshot'));
  const p95a = percentile(aReads.map(r => r.ms), .95), p95b = percentile(bReads.map(r => r.ms), .95);
  output.performance = { baselineMedian: median(a), candidateMedian: median(b), improvement: 1 - median(b) / median(a),
    improvedPairs: differences.filter(d => d > 0).length, differenceMedian, mad, baselineP95: p95a, candidateP95: p95b,
    baselineReads: aReads.length, candidateReads: bReads.length };
  assert(output.performance.improvement >= .15); assert(output.performance.improvedPairs >= 6);
  assert(differenceMedian > 3 * mad); assert(p95b <= Math.max(100, p95a * 1.3));
  console.log('PERFORMANCE', JSON.stringify(output.performance));

  // All 54 results must be recomputed when old data is corrected, not just recent ranges.
  await db.admin.query(`UPDATE verify.usage_events SET total_tokens = total_tokens + 731, cost_usd = cost_usd + 0.123456789,
    lines_written = 17, messages = messages + 2 WHERE id = $1`, [events.find(e => e.timestamp.startsWith('2026-06')).id]);
  await baseline.command('refresh'); await candidate.command('refresh');
  await compare('historical correction, fractional cost and lines');

  const pending = [candidate.command('refresh'), candidate.command('refresh'), candidate.command('refresh')];
  const response = await fetch(candidate.base + '/api/usage/leaderboard?range=90D&metric=cost');
  assert.equal(response.status, 200); assert((await response.json()).summary.users.length > 0);
  await Promise.all(pending); await compare('three overlapping refresh requests');

  const good = await candidate.command('state');
  const persisted = fs.readFileSync(path.join(candidate.dir, 'snapshots.json'), 'utf8');
  await db.admin.query('ALTER TABLE verify.usage_events RENAME TO usage_events_unavailable');
  await assert.rejects(candidate.command('refresh'), /usage_events/);
  const failed = await candidate.command('state');
  assert(failed.lastError); assert.deepEqual(failed.entries, good.entries); assert.equal(failed.refreshing, false);
  assert.equal(fs.readFileSync(path.join(candidate.dir, 'snapshots.json'), 'utf8'), persisted);
  const duringFailure = await fetch(candidate.base + '/api/usage/leaderboard?range=lastmonth&metric=users');
  assert.equal(duringFailure.status, 200); assert((await duringFailure.json()).summary.users);
  output.scenarios.push({ label: 'database query failure preserves cache and disk, HTTP 200, reports error', passed: true });
  await db.admin.query('ALTER TABLE verify.usage_events_unavailable RENAME TO usage_events');
  await candidate.command('refresh'); assert.equal((await candidate.command('state')).lastError, '');
  await compare('query recovery clears error and recomputes');

  const candidateDir = candidate.dir;
  await candidate.close(); candidate = undefined;
  candidate = await service(root, db.url, 'verify', candidateDir);
  await compare('restart from persisted complete snapshots');

  // Fresh, tiny edge case: exact decimal costs, identical display names and values,
  // optional fields, anonymous sessions, midnight/month/week and previous-period edges.
  await db.admin.query('TRUNCATE verify.usage_events');
  const base = events[0];
  const tiny = [
    ['a', 'same', '2026-09-13T16:00:00.000Z', 0.1, null],
    ['b', 'same', '2026-09-13T16:00:00.000Z', 0.1, 0],
    ['c', 'earlier', '2026-09-13T15:59:59.999Z', 0.2, null],
    ['d', 'same', '2026-08-31T16:00:00.000Z', 0.3, 12],
    ['e', 'old', '2026-08-31T15:59:59.999Z', 0.4, null],
    ['f', 'old', '2026-09-06T15:59:59.999Z', 0.5, 2],
    ['g', 'old', '2026-09-06T16:00:00.000Z', 0.6, null],
  ].map(([id, displayName, timestamp, costUsd, linesWritten]) => ({ ...base, id: 'tiny-' + id, userId: id,
    displayName, timestamp, costUsd, linesWritten, sessionId: undefined, totalTokens: 300, inputTokens: 200,
    outputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0 }));
  await seed(root, db.url, 'verify', tiny);
  await baseline.command('refresh'); await candidate.command('refresh');
  await compare('tiny data: identical display-name ties, Shanghai edges, optional sessions, decimal costs');

  await db.admin.query('TRUNCATE verify.usage_events');
  await baseline.command('refresh'); await candidate.command('refresh');
  const empty = await compare('empty data');
  assert(empty.entries.every(e => e.records === 0 && e.summary.users.length === 0));
  output.passed = true;
} finally {
  json(artifact, output);
  await candidate?.close(); await baseline?.close(); await db.close();
}
