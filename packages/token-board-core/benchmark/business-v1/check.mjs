// Validate the authored task pack only. This never invokes a model or a task.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const suite = read("suite.json");
const sources = read("sources.json");
const sourceIds = new Set(sources.map((source) => source.id));
assert.equal(sourceIds.size, sources.length, "duplicate source IDs");
assert.equal(suite.status, "specification-ready");
assert.equal(suite.replayReady, false, "fixtures have not been frozen and validated");
assert.equal(suite.modelRuns, 0, "this pack must not claim unperformed evaluation");
assert.equal(suite.cases.length, 12);
assert.equal(new Set(suite.cases.map((task) => task.id)).size, suite.cases.length);
assert.equal(suite.scoring.dimensions.reduce((sum, item) => sum + item.points, 0), 100);

for (const task of suite.cases) {
  assert.match(task.id, /^B\d{2}$/);
  assert.equal(task.readiness, "source-confirmed-specification");
  for (const key of ["title", "family", "prompt", "historicalOutcome"]) {
    assert.ok(typeof task[key] === "string" && task[key].trim(), `${task.id}: missing ${key}`);
  }
  for (const key of ["sourceRefs", "sourceFacts", "addedEvaluationConditions", "materials", "deliverables", "acceptance", "criticalFailures", "setup"]) {
    assert.ok(Array.isArray(task[key]) && task[key].length, `${task.id}: missing ${key}`);
  }
  assert.ok(task.sourceRefs.every((id) => sourceIds.has(id)), `${task.id}: unknown source`);
  assert.ok(task.acceptance.length >= 5, `${task.id}: incomplete acceptance criteria`);
  for (const criterion of task.acceptance) {
    assert.ok(criterion.requirement && criterion.method && criterion.failure, `${task.id}: incomplete acceptance check`);
  }
  assert.ok(task.materials.every((item) => item.description && item.visibility && item.status), `${task.id}: incomplete material manifest`);
  assert.ok(task.materials.some((item) => item.status !== "ready"), `${task.id}: replay readiness needs re-review`);
  const prompt = readFileSync(join(root, "prompts", `${task.id}.txt`), "utf8");
  assert.equal(prompt.trim(), task.prompt.trim(), `${task.id}: prompt copy differs`);
  assert.ok(existsSync(join(root, "cases", `${task.id}.md`)), `${task.id}: missing readable case`);
  assert.ok(!/C:\\Users\\|\/Users\/|rollout-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(task)), `${task.id}: raw local provenance belongs in private index`);
}
for (const source of sources) {
  assert.ok(source.date && source.summary && source.tool, `${source.id}: incomplete source`);
}
const record = read("run-record.template.json");
assert.equal(record.status, "not-run");
assert.equal(record.accepted, null);
assert.equal(record.costUsd, null);
console.log(`Full-scenario specifications valid: ${suite.cases.length} cases, ${sources.length} source references; 0 full-scenario model runs. Narrowed pilot runs are recorded separately in business-pilot-v1.`);
