import fs from 'node:fs';
import assert from 'node:assert/strict';
import {businessDigest, json, root} from '../../replay/run.mjs';
import path from 'node:path';

const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tests/replay/baseline-measurement.json')));
const candidate = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/measurement.json')));
assert.deepEqual(candidate.entries, baseline.entries);
const quantile = (xs, p) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const expected = businessDigest(baseline.entries.find(e=>e.range==='today' && e.metric==='tokens').summary);
function describe(data) {
  const reads = data.samples.flatMap(s=>s.reads);
  for (const read of reads) {
    assert.equal(read.status, 200);
    assert.equal(read.source, 'snapshot');
    assert.equal(read.summarySha256, expected);
  }
  const durations = data.samples.map(s=>s.durationMs);
  return {durations, medianMs: quantile(durations, .5), readCount: reads.length,
    readP95Ms: quantile(reads.map(r=>r.ms), .95), readMaxMs: Math.max(...reads.map(r=>r.ms)),
    apiCpuMs: data.samples.map(s=>(s.apiCpu.user+s.apiCpu.system)/1000),
    apiMaxRss: data.samples.map(s=>s.apiResourceUsage.maxRSS)};
}
const before = describe(baseline), after = describe(candidate);
const result = {conditions: 'Sequential warmed seven-round runs, not interleaved paired acceptance. Same supplied fixture and frozen clock.',
  events: candidate.events, now: candidate.now, baseline: before, candidate: after,
  medianImprovement: 1-after.medianMs/before.medianMs,
  readP95LimitMs: Math.max(100, before.readP95Ms*1.3), fullSnapshotEquality: true};
assert.ok(result.medianImprovement >= .15);
assert.ok(after.readP95Ms <= result.readP95LimitMs);
json(path.join(root, 'tests/replay/measurement-summary.json'), result);
console.log(JSON.stringify(result, null, 2));
