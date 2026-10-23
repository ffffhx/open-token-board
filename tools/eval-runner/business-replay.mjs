#!/usr/bin/env node
// Versioned historical-task exports and independent grading. No model calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(import.meta.url);
const repo = resolve(dirname(script), '../..');
const pack = join(repo, 'packages/token-board-core/benchmark/business-replay-v2');
const args = process.argv.slice(2);
const action = args.shift();
const flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8'); };
const emit = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const preparedBaselines = new Map();
const suite = () => read(join(pack, 'suite.json'));
const caseIds = () => suite().cases.map(c => typeof c === 'string' ? c : c.id);
const pattern = (name, glob) => new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$').test(name);
function tree(root, ignored = [], prefix = '') {
  const entries = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (ignored.some(glob => pattern(rel, glob) || pattern(`${rel}/`, glob))) continue;
    const info = lstatSync(join(root, rel));
    assert.ok(!info.isSymbolicLink(), `Unexpected symlink in evaluated tree: ${rel}`);
    if (info.isDirectory()) Object.assign(entries, tree(root, ignored, rel));
    else if (info.isFile()) entries[rel] = sha(readFileSync(join(root, rel)));
  }
  return entries;
}
function task(id) {
  assert.ok(caseIds().includes(id), `Unknown task: ${id}`);
  const dir = join(pack, 'cases', id);
  const meta = read(join(dir, 'task.json'));
  assert.equal(meta.id, id);
  return { dir, meta };
}
function content() {
  return { 'suite.json': sha(readFileSync(join(pack, 'suite.json'))), ...Object.fromEntries(Object.entries(tree(join(pack, 'cases'))).map(([k, v]) => [`cases/${k}`, v])) };
}
function frozen() {
  const manifest = read(join(pack, 'manifest.json'));
  assert.deepEqual(content(), manifest.files, 'Frozen input, reference, or verifier changed; create a new version before running models');
  assert.equal(sha(readFileSync(script)), manifest.harnessSha256, 'Runner changed after freeze');
  return manifest;
}
function scope(id, candidate, before = null) {
  const { dir, meta } = task(id);
  const ignored = meta.generatedPaths ?? [];
  const initial = before ?? tree(join(dir, 'workspace'), ignored);
  const current = tree(candidate, ignored);
  const changed = [...new Set([...Object.keys(initial), ...Object.keys(current)])].filter(name => initial[name] !== current[name]);
  const forbidden = changed.filter(name => !meta.allowedChanges.some(glob => pattern(name, glob)));
  return { passed: forbidden.length === 0, changed, forbidden, ignoredGeneratedPaths: ignored };
}
function materialize(id, variant = 'workspace') {
  const { dir, meta } = task(id);
  const target = mkdtempSync(join(tmpdir(), `otb-replay-${id}-`));
  const mode = variant === 'reference' ? meta.referenceMode ?? 'overlay' : meta.controlMode ?? 'overlay';
  assert.equal(mode, 'overlay', 'This version uses reference and control overlays');
  cpSync(join(dir, 'workspace'), target, { recursive: true });
  provision(id, target);
  preparedBaselines.set(target, tree(target, meta.generatedPaths ?? []));
  if (variant !== 'workspace') cpSync(join(dir, variant), target, { recursive: true });
  return target;
}
function provision(id, workspace) {
  const { dir, meta } = task(id);
  if (!meta.runtime?.prepareScript) return null;
  const result = spawnSync(process.execPath, [join(dir, meta.runtime.prepareScript), workspace], {
    cwd: dir, encoding: 'utf8', windowsHide: true, timeout: meta.runtime.prepareTimeoutMs ?? 300_000,
    maxBuffer: 4 * 1024 * 1024, env: { ...process.env, OTB_REPLAY_REPOSITORY: repo },
  });
  assert.equal(result.status, 0, `${id}: runtime preparation failed: ${result.error?.message || result.stderr || result.stdout}`);
  let receipt; try { receipt = JSON.parse(result.stdout.trim()); } catch { throw Error(`${id}: prepare must output JSON`); }
  return receipt;
}
function verify(id, candidate) {
  const { dir, meta } = task(id);
  const inputBefore = tree(candidate, meta.generatedPaths ?? []);
  const started = Date.now();
  const execution = spawnSync(process.execPath, [join(dir, 'verify.mjs'), resolve(candidate)], {
    cwd: dir, encoding: 'utf8', windowsHide: true, timeout: meta.runtime?.verifyTimeoutMs ?? 300_000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, OTB_REPLAY_REPOSITORY: repo },
  });
  let evaluation;
  try { evaluation = JSON.parse(execution.stdout.trim()); }
  catch { evaluation = { infrastructureError: 'Verifier output is not JSON', checks: [], output: execution.stdout }; }
  const checks = [...(evaluation.checks ?? []), ...(evaluation.precisionChecks ?? []).map(c => ({ ...c, category: 'precision' }))];
  evaluation.checks = checks;
  const valid = checks.length > 0 && checks.every(c => typeof c.id === 'string' && typeof c.passed === 'boolean' && ['business', 'preservation', 'delivery', 'precision'].includes(c.category));
  const inputUnchanged = JSON.stringify(inputBefore) === JSON.stringify(tree(candidate, meta.generatedPaths ?? []));
  const infrastructureError = execution.error?.message || execution.signal || evaluation.infrastructureError || (execution.status === 2 ? 'Verifier infrastructure failure' : null) || (!valid ? 'Invalid or unclassified verifier checks' : null) || (!inputUnchanged ? 'Verifier modified candidate inputs' : null);
  const required = checks.filter(c => c.required !== false && c.category !== 'precision');
  const group = category => ({ passed: checks.filter(c => c.category === category && c.required !== false).every(c => c.passed), passedCount: checks.filter(c => c.category === category && c.passed).length, total: checks.filter(c => c.category === category).length });
  const categories = Object.fromEntries(['business', 'preservation', 'delivery', 'precision'].map(c => [c, group(c)]));
  const businessPassed = !infrastructureError && categories.business.total > 0 && categories.business.passed && categories.preservation.passed;
  return { passed: !infrastructureError && execution.status === 0 && required.length > 0 && required.every(c => c.passed), businessPassed, categories, infrastructureError, inputUnchanged, exitCode: execution.status, durationMs: Date.now() - started, evaluation, stderr: execution.stderr };
}
function validateOne(id) {
  const { dir, meta } = task(id);
  const baselinePath = materialize(id);
  const referencePath = materialize(id, 'reference');
  const baseline = verify(id, baselinePath);
  const reference = verify(id, referencePath);
  const referenceScope = scope(id, referencePath, preparedBaselines.get(referencePath));
  const expected = meta.expectedBaselineFailures ?? [];
  const baselineFailures = baseline.evaluation.checks.filter(c => !c.passed && c.category === 'business').map(c => c.id);
  const baselineReproduced = expected.length > 0 && expected.every(name => baselineFailures.includes(name));
  const controlsRoot = join(dir, 'negative-controls');
  const controls = existsSync(controlsRoot) ? readdirSync(controlsRoot).filter(name => lstatSync(join(controlsRoot, name)).isDirectory()).map(name => {
    const workspace = materialize(id, `negative-controls/${name}`);
    const result = verify(id, workspace);
    const reviewExpectation = meta.controlReviewRequired?.[name] ?? null;
    const expectedFailures = reviewExpectation?.expectedReviewFlags ?? meta.controlExpectedFailures?.[name] ?? [];
    const failures = result.evaluation.checks.filter(c => !c.passed).map(c => c.id);
    const expectedFailuresObserved = expectedFailures.length > 0 && expectedFailures.every(name => failures.includes(name));
    const reviewPacketPresent = reviewExpectation && result.evaluation.manualReviewRequired === true && Boolean(result.evaluation.reviewPacket?.projectBody) && existsSync(join(dir, reviewExpectation.rubric));
    const intendedOutcomeObserved = reviewExpectation ? result.passed && result.businessPassed && reviewPacketPresent && expectedFailuresObserved : !result.businessPassed && expectedFailuresObserved;
    return { name, result, expectedFailures, expectedFailuresObserved, reviewExpectation, intendedOutcomeObserved };
  }) : [];
  const alternatives = ['positive-controls', 'positive-alternatives'].flatMap(folder => {
    const alternativesRoot = join(dir, folder);
    return existsSync(alternativesRoot) ? readdirSync(alternativesRoot).filter(name => lstatSync(join(alternativesRoot, name)).isDirectory()).map(name => { const candidate = materialize(id, `${folder}/${name}`); return { name: `${folder}/${name}`, result: verify(id, candidate), scope: scope(id, candidate, preparedBaselines.get(candidate)) }; }) : [];
  });
  return { caseId: id, passed: !baseline.infrastructureError && !baseline.businessPassed && baselineReproduced && reference.passed && referenceScope.passed && controls.length > 0 && controls.every(c => !c.result.infrastructureError && c.intendedOutcomeObserved) && alternatives.every(a => a.result.passed && a.scope.passed), baselineReproduced, baseline, reference, referenceScope, controls, alternatives };
}

try {
  if (action === 'freeze') {
    for (const id of caseIds()) {
      const { dir, meta } = task(id);
      assert.ok(meta.provenance && meta.allowedChanges?.length && meta.expectedBaselineFailures?.length, `${id}: incomplete metadata`);
      for (const name of ['workspace', 'reference', 'prompt.txt', 'verify.mjs']) assert.ok(existsSync(join(dir, name)), `${id}: missing ${name}`);
    }
    const files = content();
    const manifest = { schemaVersion: 2, id: 'business-replay-v2', frozenAt: new Date().toISOString(), nodeVersion: process.version, files, contentSha256: sha(JSON.stringify(files)), harnessSha256: sha(readFileSync(script)) };
    assert.ok(!existsSync(join(pack, 'manifest.json')), 'Existing freeze must not be overwritten; create an explicit revision');
    save(join(pack, 'manifest.json'), manifest);
    emit({ frozen: true, files: Object.keys(files).length, suiteHash: manifest.contentSha256 });
  } else if (action === 'check') {
    const manifest = frozen(); emit({ valid: true, files: Object.keys(manifest.files).length, suiteHash: manifest.contentSha256 });
  } else if (action === 'validate') {
    if (existsSync(join(pack, 'manifest.json'))) frozen();
    const selected = args[0] && !args[0].startsWith('--') ? [args[0]] : caseIds();
    const results = selected.map(validateOne);
    const report = { kind: 'case-validation-not-model-results', at: new Date().toISOString(), passed: results.every(r => r.passed), results };
    const output = flag('--report') ? resolve(flag('--report')) : join(repo, 'tests/.tmp/business-replay-v2/validation.json');
    save(output, report);
    emit({ passed: report.passed, cases: results.map(r => ({ id: r.caseId, passed: r.passed, baselineBusiness: r.baseline.businessPassed, reference: r.reference.passed, controls: r.controls.length, infrastructure: [r.baseline.infrastructureError, r.reference.infrastructureError] })), report: output });
    process.exitCode = report.passed ? 0 : 1;
  } else if (action === 'prepare') {
    const id = args[0]; const { dir, meta } = task(id); const manifest = frozen();
    assert.ok(flag('--out'), '--out is required');
    const target = resolve(flag('--out'));
    assert.ok(!existsSync(target), 'Use a new export directory');
    cpSync(join(dir, 'workspace'), target, { recursive: true, force: false, errorOnExist: true });
    const runtimePreparation = provision(id, target);
    assert.ok(!existsSync(join(target, 'TASK.txt')), 'TASK.txt is reserved');
    cpSync(join(dir, 'prompt.txt'), join(target, 'TASK.txt'));
    const exportedFiles = tree(target, meta.generatedPaths ?? []);
    save(`${target}.receipt.json`, { caseId: id, preparedAt: new Date().toISOString(), suiteHash: manifest.contentSha256, harnessSha256: manifest.harnessSha256, exportedFiles, runtimePreparation });
    emit({ caseId: id, workspace: target, files: Object.keys(exportedFiles).length, suiteHash: manifest.contentSha256, isolation: 'Independent input export; no OS sandbox' });
  } else if (action === 'grade') {
    const id = args[0]; const manifest = frozen(); assert.ok(flag('--workspace'), '--workspace is required');
    const workspace = resolve(flag('--workspace')); const receipt = read(`${workspace}.receipt.json`);
    assert.equal(receipt.caseId, id); assert.equal(receipt.suiteHash, manifest.contentSha256); assert.equal(receipt.harnessSha256, manifest.harnessSha256);
    const changed = scope(id, workspace, receipt.exportedFiles);
    const evaluation = verify(id, workspace);
    const report = { kind: 'independent-machine-grade', caseId: id, at: new Date().toISOString(), suiteHash: manifest.contentSha256, machineAccepted: changed.passed && evaluation.passed, businessAccepted: changed.passed && evaluation.businessPassed, contentReview: 'pending', scope: changed, result: evaluation };
    const output = flag('--report') ? resolve(flag('--report')) : `${workspace}.grade.json`; save(output, report);
    emit({ caseId: id, businessAccepted: report.businessAccepted, machineAccepted: report.machineAccepted, categories: evaluation.categories, scope: changed, failed: evaluation.evaluation.checks.filter(c => !c.passed), infrastructureError: evaluation.infrastructureError, report: output });
    process.exitCode = evaluation.infrastructureError ? 2 : report.machineAccepted ? 0 : 1;
  } else {
    emit({ usage: ['business-replay.mjs validate [B04] [--report file]', 'business-replay.mjs freeze', 'business-replay.mjs check', 'business-replay.mjs prepare B04 --out <new-directory>', 'business-replay.mjs grade B04 --workspace <export> [--report file]'] });
    if (action && action !== 'help') process.exitCode = 2;
  }
} catch (error) { emit({ infrastructureError: error.message, action }); process.exitCode = 2; }
