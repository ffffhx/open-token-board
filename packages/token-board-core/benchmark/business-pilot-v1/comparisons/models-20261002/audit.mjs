// Verify archived records and submissions without invoking any model.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = async rel => JSON.parse(await readFile(path.join(root, rel), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const check = (id, passed) => checks.push({ id, passed: Boolean(passed) });
const results = await read('results.json');
const protocol = await read('protocol.json');
check('complete-24-selected-runs', results.status === 'completed' && results.runs.length === 24);
check('eight-exact-models', results.models.length === 8 && new Set(results.models.map(m => m.model)).size === 8);
check('uniform-medium-policy', protocol.policy.reasoningEffort === 'medium' && protocol.policy.forkTurns === 'none');
check('frozen-suite-consistency', results.suiteHash === protocol.suiteHash && results.harnessSha256 === protocol.harnessSha256);
check('unique-selected-model-cases', new Set(results.runs.map(r => `${r.model}/${r.caseId}`)).size === 24);
const supplementalHash = hash(await readFile(path.join(root, 'check-b04-env.mjs')));
const controls = await read('supplemental-validation.json');
check('supplemental-baseline-and-reference', controls.valid && controls.scriptSha256 === supplementalHash && controls.controls.length === 2 && controls.controls.every(c => c.expectedPassed === c.result.passed));

async function archived(run, selected) {
  const id = `${run.model}/${run.caseId}/${selected ? 'selected' : 'excluded'}`;
  const record = await read(run.result);
  if (selected) check(`${id}/record-consistency`, JSON.stringify(record) === JSON.stringify(Object.fromEntries(Object.entries(run).filter(([k]) => k !== 'result'))));
  check(`${id}/single-context`, record.execution.turnCount === 1);
  check(`${id}/model`, JSON.stringify(record.execution.observedModels) === JSON.stringify([run.model]));
  check(`${id}/effort`, JSON.stringify(record.execution.observedReasoningEfforts) === JSON.stringify([selected ? 'medium' : 'low']));
  check(`${id}/suite`, record.suiteHash === results.suiteHash);
  check(`${id}/raw-counts`, record.checksPassed === record.checks.filter(c => c.passed).length && record.checksTotal === record.checks.length);
  check(`${id}/time`, record.execution.taskWallMs === Date.parse(record.execution.taskCompletedAt) - Date.parse(record.execution.taskStartedAt));
  if (selected) {
    check(`${id}/review-finished`, ['accepted', 'failed'].includes(record.status) && record.semanticReview.status === record.status);
    check(`${id}/scope`, record.scope.passed && record.scope.forbidden.length === 0);
    if (record.status === 'accepted' && !record.machineAccepted) {
      const corrections = record.machineCheckAdjudication?.correctedChecks ?? [];
      check(`${id}/explicit-adjudication`, corrections.length > 0 && record.checks.filter(c => !c.passed).every(c => corrections.includes(c.id)));
      const allowed = run.caseId === 'B09' ? ['source-link', 'project-source-numbers'] : run.caseId === 'B04' && record.supplementalEnvironmentCheck?.passed ? ['catalog-explicit-directory-and-validation'] : [];
      check(`${id}/adjudication-policy`, corrections.every(c => allowed.includes(c)));
    }
    if (run.caseId === 'B04') check(`${id}/supplemental-evidence`, record.supplementalEnvironmentCheck?.scriptSha256 === supplementalHash);
  }
  const archive = path.join(root, path.dirname(run.result), 'submission');
  for (const item of record.submittedChanges) {
    if (item.deleted) continue;
    const bytes = await readFile(path.join(archive, item.path));
    check(`${id}/sha256/${item.path}`, hash(bytes) === item.sha256);
  }
  const expected = record.submittedChanges.filter(c => !c.deleted).map(c => c.path.replaceAll('\\', '/')).sort();
  const files = (await readdir(archive, { recursive: true, withFileTypes: true })).filter(x => x.isFile()).map(x => path.relative(archive, path.join(x.parentPath, x.name)).replaceAll('\\', '/')).sort();
  check(`${id}/archive-file-set`, JSON.stringify(files) === JSON.stringify(expected));
}

for (const run of results.runs) await archived(run, true);
check('two-preserved-default-low-runs', results.excludedDefaultEffortRuns.length === 2);
for (const run of results.excludedDefaultEffortRuns) await archived(run, false);
for (const model of results.models) {
  const runs = results.runs.filter(r => r.model === model.model);
  check(`${model.model}/three-cases`, JSON.stringify(runs.map(r => r.caseId).sort()) === JSON.stringify(['B04', 'B09', 'B11']));
  check(`${model.model}/accepted-count`, model.accepted === runs.filter(r => r.status === 'accepted').length);
  check(`${model.model}/wall-time-sum`, model.wallMsSum === runs.reduce((sum, r) => sum + r.execution.taskWallMs, 0));
  for (const [key, value] of Object.entries(model.totalTokenUsage)) check(`${model.model}/tokens/${key}`, value === runs.reduce((sum, r) => sum + r.execution.tokenUsage[key], 0));
}
const report = { passed: checks.every(c => c.passed), checkedAt: new Date().toISOString(), checksPassed: checks.filter(c => c.passed).length, checksTotal: checks.length, checks, limitations: 'Archive integrity and recorded configuration only; does not establish OS isolation, provider backend identity, or human review.' };
await writeFile(path.join(root, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checksPassed: report.checksPassed, checksTotal: report.checksTotal, failures: checks.filter(c => !c.passed) }));
process.exitCode = report.passed ? 0 : 1;
