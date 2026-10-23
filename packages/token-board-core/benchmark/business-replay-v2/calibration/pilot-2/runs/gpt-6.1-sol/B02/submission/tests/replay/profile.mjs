import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { root, database, seed, json } from '../../replay/run.mjs';
import { fixture, NOW, RANGES, METRICS } from '../../replay/fixture.mjs';
import { createTokenUsageStore as candidate } from '../../packages/token-board-core/src/token-board-storage.ts';

// Attribute CPU-side stages without altering the reference functions or their arguments/results.
let profiledSource = fs.readFileSync(path.join(root, 'tests/replay/reference/storage.original.txt'), 'utf8')
  .replace(/from "\.\/([^\"]+)"/g, 'from "../../../packages/token-board-core/src/$1.ts"');
const functions = ['buildTokenAchievementSummariesByUser', 'buildTokenEfficiencySummary',
  'buildTokenLeaderboardTrends', 'buildTokenTeamLeaderboard', 'buildTokenProjectLeaderboard', 'buildTokenUsageDistribution'];
profiledSource += '\nexport const stageProfile: Record<string, { calls: number; totalMs: number }> = {};\n';
for (const name of functions) {
  profiledSource = profiledSource.replace(`  ${name},`, `  ${name} as original_${name},`);
  profiledSource += `\nfunction ${name}(...args: Parameters<typeof original_${name}>) {
    const started = performance.now();
    try { return original_${name}(...args); }
    finally { const value = stageProfile["${name}"] ??= { calls: 0, totalMs: 0 };
      value.calls++; value.totalMs += performance.now() - started; }
  }\n`;
}
const profilePath = path.join(root, 'tests/replay/reference/profile-storage.ts');
fs.writeFileSync(profilePath, profiledSource);
const { createTokenUsageStore: original, stageProfile } = await import(pathToFileURL(profilePath).href);

// Measure client query completion including transfer/row decoding; not server-only SQL execution.
const originalQuery = pg.Client.prototype.query;
let trace;
pg.Client.prototype.query = function (...args) {
  const text = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
  const sink = trace, started = performance.now();
  const record = () => {
    if (!sink) return;
    let category = 'aggregate';
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) category = 'transaction';
    else if (/SELECT \*/.test(text) && /user_id = ANY/.test(text)) category = 'all-history-events';
    else if (/SELECT \*/.test(text) && !/WITH current_events/.test(text)) category = 'range-events';
    sink.push({ category, ms: performance.now() - started });
  };
  const last = args.length - 1;
  if (typeof args[last] === 'function') {
    const callback = args[last]; args[last] = (...result) => { record(); return callback(...result); };
    return originalQuery.apply(this, args);
  }
  return originalQuery.apply(this, args).finally(record);
};
const runtime = JSON.parse(fs.readFileSync(path.join(root, '.replay-runtime.json'), 'utf8'));
const runDir = fs.mkdtempSync(path.join(runtime.runs, 'profile-'));
const db = await database(runtime, path.join(runDir, 'db'));
let a, b;
try {
  await seed(root, db.url, 'profile', fixture());
  a = await original({ dataFile: 'unused', databaseUrl: db.url, postgresSchema: 'profile' });
  b = await candidate({ dataFile: 'unused', databaseUrl: db.url, postgresSchema: 'profile' });
  const results = [];
  for (const [name, store] of [['baseline', a], ['candidate', b]]) {
    const rows = []; trace = rows;
    const start = performance.now(), cpu = process.cpuUsage();
    if (name === 'baseline') {
      for (const range of RANGES) for (const metric of METRICS) await store.getLeaderboardSummary({ range, metric, now: new Date(NOW) });
    } else await store.getLeaderboardSnapshots(RANGES, METRICS, new Date(NOW));
    const elapsedMs = performance.now() - start, usage = process.cpuUsage(cpu); trace = undefined;
    const categories = {};
    for (const row of rows) {
      categories[row.category] ??= { count: 0, totalMs: 0 };
      categories[row.category].count++; categories[row.category].totalMs += row.ms;
    }
    results.push({ name, elapsedMs, cpuMs: (usage.user + usage.system) / 1000, queries: rows.length, categories,
      stages: name === 'baseline' ? stageProfile : undefined,
      queryCompletionMs: rows.reduce((sum, row) => sum + row.ms, 0) });
  }
  json(path.join(root, 'artifacts/profile.json'), { now: NOW, events: fixture().length, runDir, results });
  console.log(JSON.stringify(results, null, 2));
} finally { trace = undefined; await a?.close(); await b?.close(); await db.close(); }
