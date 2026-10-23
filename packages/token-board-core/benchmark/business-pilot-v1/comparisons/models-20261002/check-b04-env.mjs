// Supplemental contract review: TASK.txt names env.CPM_DATA_DIR, not input.env.
// Keep the participant source unchanged; inject the environment into the VM adapter.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const source = await readFile(resolve(process.argv[2], 'src/profile-catalog.mjs'), 'utf8');
const adapter = await readFile(new URL('../../cases/B04/workspace/catalog-fixture.mjs', import.meta.url), 'utf8');
const needle = 'platform, env: {}, pid: 424242,';
assert.equal(adapter.split(needle).length, 2, 'Frozen adapter layout changed');
const root = '/isolated-test/registry';
const adapted = adapter.replace(needle, `platform, env: ${JSON.stringify({CPM_DATA_DIR:root})}, pid: 424242,`);
const { catalogFixture } = await import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
const f = catalogFixture(source, 'darwin');
f.registry([
  { id: 'last', name: 'Last port fallback', dirName: 'last', lastCdpPort: 25001 },
  { id: 'escape', name: 'Traversal', dirName: '../../elsewhere', fixedCdpPort: 25002 },
  { id: 'invalid', name: 'Invalid', dirName: 'invalid', fixedCdpPort: 70000 },
  { id: 'missing', name: 'Missing directory', fixedCdpPort: 25004 }
], root);
const checks = [];
try {
  const result = f.api.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:25000}, f.home, f.now);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(p=>[p.cdpPort,p.profileName]))), [[25001,'Last port fallback']]);
  checks.push({id:'explicit-directory-via-process-env',passed:true});
} catch(error) {
  checks.push({id:'explicit-directory-via-process-env',passed:false,details:String(error.message)});
}
const passed = checks.every(c=>c.passed);
console.log(JSON.stringify({passed,checks,sourceChanged:false,adapterChange:'Inject only CPM_DATA_DIR into mock process.env; participant code unchanged'}));
process.exitCode = passed ? 0 : 1;
