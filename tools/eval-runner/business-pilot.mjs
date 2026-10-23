#!/usr/bin/env node
// Local task packaging and external grading. Does not invoke models or publish anything.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pack = join(repo, 'packages/token-board-core/benchmark/business-pilot-v1');
const caseRoot = join(pack, 'cases');
const ids = ['B04', 'B09', 'B11'];
const argv = process.argv.slice(2);
const action = argv.shift();
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const harnessHash = () => hash(readFileSync(fileURLToPath(import.meta.url)));
const emit = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

function flag(name) {
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1];
}

function files(root, prefix = '') {
  const result = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const path = join(root, rel);
    const info = lstatSync(path);
    assert.ok(!info.isSymbolicLink(), `Symlink not allowed: ${rel}`);
    if (info.isDirectory()) Object.assign(result, files(root, rel));
    else if (info.isFile()) result[rel] = hash(readFileSync(path));
  }
  return result;
}

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function task(id) {
  assert.ok(ids.includes(id), 'Choose B04, B09 or B11');
  const dir = join(caseRoot, id);
  const meta = read(join(dir, 'task.json'));
  assert.equal(meta.id, id);
  return { dir, meta };
}

function matches(path, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`).test(path);
}

function checkScope(id, workspace, baseline = null) {
  const { dir, meta } = task(id);
  assert.ok(Array.isArray(meta.allowedChanges) && meta.allowedChanges.length, `${id}: allowedChanges required`);
  const before = baseline ?? files(join(dir, 'workspace'));
  const after = files(workspace);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]);
  const forbidden = changed.filter(name => !meta.allowedChanges.some(pattern => matches(name, pattern)));
  return { passed: forbidden.length === 0, changed, forbidden };
}

function verify(id, workspace) {
  const { dir } = task(id);
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(dir, 'verify.mjs'), resolve(workspace)], {
    cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
  });
  let evaluation;
  try { evaluation = JSON.parse(result.stdout.trim()); }
  catch { evaluation = { passed: false, infrastructureError: 'Verifier did not produce a JSON object', output: result.stdout }; }
  const valid = typeof evaluation.passed === 'boolean' && Array.isArray(evaluation.checks) && evaluation.checks.length > 0 && evaluation.checks.every(check => typeof check.id === 'string' && typeof check.passed === 'boolean') && evaluation.passed === evaluation.checks.every(check => check.passed);
  const infrastructureError = result.error?.message || result.signal || (result.status === 2 ? 'Verifier reported an infrastructure error' : null) || (!valid ? 'Invalid verifier result schema' : null);
  return { caseId: id, exitCode: result.status, infrastructureError, durationMs: Date.now() - started, passed: !infrastructureError && result.status === 0 && evaluation.passed === true, evaluation, stderr: result.stderr || '' };
}

function checkManifest() {
  const manifest = read(join(pack, 'manifest.json'));
  const actual = files(caseRoot);
  assert.deepEqual(actual, manifest.files, 'Frozen task files changed; review and freeze a new version');
  assert.equal(harnessHash(), manifest.harnessSha256, 'Harness changed; review and freeze a new version');
  return manifest;
}

if (action === 'freeze') {
  const metadata = ids.map(id => {
    const { dir, meta } = task(id);
    assert.ok(meta.provenance && Array.isArray(meta.allowedChanges) && Array.isArray(meta.expectedBaselineFailures) && meta.expectedBaselineFailures.length > 0, `${id}: incomplete task metadata`);
    for (const name of ['workspace', 'reference', 'prompt.txt', 'verify.mjs']) assert.ok(existsSync(join(dir, name)), `${id}: missing ${name}`);
    return { id, title: meta.title, provenance: meta.provenance };
  });
  const content = files(caseRoot);
  const manifest = { schemaVersion: 1, id: 'business-pilot-v1', frozenAt: new Date().toISOString(), nodeVersion: process.version, purpose: 'Workflow pilot; historical excerpts and explicitly labelled reconstructions', cases: metadata, contentSha256: hash(JSON.stringify(content)), harnessSha256: harnessHash(), files: content };
  save(join(pack, 'manifest.json'), manifest);
  emit({ frozen: true, cases: ids, files: Object.keys(content).length, contentSha256: manifest.contentSha256 });
} else if (action === 'check') {
  const manifest = checkManifest();
  emit({ valid: true, contentSha256: manifest.contentSha256, files: Object.keys(manifest.files).length });
} else if (action === 'validate') {
  checkManifest();
  const results = [];
  for (const id of ids) {
    const { dir, meta } = task(id);
    const baseline = verify(id, join(dir, 'workspace'));
    const reference = verify(id, join(dir, 'reference'));
    const referenceScope = checkScope(id, join(dir, 'reference'));
    const controlRoot = join(dir, 'negative-controls');
    const controls = existsSync(controlRoot) ? readdirSync(controlRoot).filter(name => lstatSync(join(controlRoot, name)).isDirectory()).map(name => {
      const result = verify(id, join(controlRoot, name));
      const expectedFailures = meta.controlExpectedFailures?.[name] ?? [];
      const failedChecks = result.evaluation.checks?.filter(check => !check.passed).map(check => check.id) ?? [];
      return { name, ...result, expectedFailures, expectedFailuresObserved: expectedFailures.length > 0 && expectedFailures.every(id => failedChecks.includes(id)) };
    }) : [];
    const positiveControls = ['positive-controls', 'positive-alternatives'].flatMap(folder => {
      const positiveRoot = join(dir, folder);
      return existsSync(positiveRoot) ? readdirSync(positiveRoot).filter(name => lstatSync(join(positiveRoot, name)).isDirectory()).map(name => ({ name: `${folder}/${name}`, ...verify(id, join(positiveRoot, name)), scope: checkScope(id, join(positiveRoot, name)) })) : [];
    });
    const failedIds = baseline.evaluation.checks?.filter(check => !check.passed).map(check => check.id) ?? [];
    const expectedFailuresObserved = (meta.expectedBaselineFailures ?? []).every(id => failedIds.includes(id));
    const passed = !baseline.infrastructureError && !baseline.passed && expectedFailuresObserved && reference.passed && referenceScope.passed && controls.length > 0 && controls.every(control => !control.infrastructureError && !control.passed && control.expectedFailuresObserved) && positiveControls.every(control => control.passed && control.scope.passed);
    results.push({ caseId: id, passed, expectedFailuresObserved, baseline, reference, referenceScope, controls, positiveControls });
  }
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), kind: 'task-validation-not-model-evaluation', passed: results.every(result => result.passed), results };
  const reportPath = flag('--report') ? resolve(flag('--report')) : join(repo, 'tests/.tmp/business-pilot-20261002/validation.json');
  save(reportPath, report);
  emit({ passed: report.passed, results: results.map(r => ({ caseId: r.caseId, passed: r.passed, baselinePass: r.baseline.passed, referencePass: r.reference.passed, negativeControls: r.controls.length, positiveControls: r.positiveControls.length })), reportPath });
  process.exitCode = report.passed ? 0 : 1;
} else if (action === 'prepare') {
  const id = argv[0];
  const { dir } = task(id);
  const manifest = checkManifest();
  assert.ok(flag('--out'), '--out is required');
  const destination = resolve(flag('--out'));
  assert.ok(!existsSync(destination), 'Export destination must be new; existing work will not be overwritten');
  mkdirSync(destination, { recursive: true });
  cpSync(join(dir, 'workspace'), destination, { recursive: true, errorOnExist: true, force: false });
  assert.ok(!existsSync(join(destination, 'TASK.txt')), 'workspace/TASK.txt is reserved for the task prompt');
  cpSync(join(dir, 'prompt.txt'), join(destination, 'TASK.txt'));
  const exported = files(destination);
  save(`${destination}.receipt.json`, { caseId: id, preparedAt: new Date().toISOString(), suiteHash: manifest.contentSha256, exportedFiles: exported });
  emit({ caseId: id, workspace: destination, files: Object.keys(exported).length, suiteHash: manifest.contentSha256, isolation: 'Input export only; this command does not create an OS sandbox' });
} else if (action === 'grade') {
  const id = argv[0];
  checkManifest();
  assert.ok(flag('--workspace'), '--workspace is required');
  const workspace = resolve(flag('--workspace'));
  const receiptPath = `${workspace}.receipt.json`;
  assert.ok(existsSync(receiptPath), 'Use prepare first; exported baseline receipt required');
  const receipt = read(receiptPath);
  assert.equal(receipt.caseId, id);
  assert.equal(receipt.suiteHash, read(join(pack, 'manifest.json')).contentSha256, 'Trial used a different frozen suite');
  const scope = checkScope(id, workspace, receipt.exportedFiles);
  const result = verify(id, workspace);
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), caseId: id, suiteHash: receipt.suiteHash, kind: 'external-machine-grading', machineAccepted: result.passed && scope.passed, manualReview: 'pending', scope, result };
  const reportPath = flag('--report') ? resolve(flag('--report')) : `${workspace}.grade.json`;
  save(reportPath, report);
  emit({ caseId: id, machineAccepted: report.machineAccepted, manualReview: report.manualReview, scope, checks: result.evaluation.checks, infrastructureError: result.infrastructureError, reportPath });
  process.exitCode = report.machineAccepted ? 0 : 1;
} else {
  emit({ usage: ['node tools/eval-runner/business-pilot.mjs freeze', 'node tools/eval-runner/business-pilot.mjs check', 'node tools/eval-runner/business-pilot.mjs validate [--report path]', 'node tools/eval-runner/business-pilot.mjs prepare B04 --out <new-workspace>', 'node tools/eval-runner/business-pilot.mjs grade B04 --workspace <exported-workspace> [--report path]'] });
  if (action && action !== 'help') process.exitCode = 2;
}
