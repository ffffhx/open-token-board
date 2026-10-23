import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDom } from './workspace/node-dom.mjs';
import { catalogFixture } from './workspace/catalog-fixture.mjs';

const checks = [];
const workspace = process.argv[2] && path.resolve(process.argv[2]);
async function check(id, work) {
  try { await work(); checks.push({ id, passed: true, details: 'ok' }); }
  catch (error) { checks.push({ id, passed: false, details: String(error.message || error) }); }
}
const plain = value => JSON.parse(JSON.stringify(value));
try {
  if (!workspace) throw Error('Usage: node verify.mjs <workspace>');
  const catalogSource = await readFile(path.join(workspace, 'src/profile-catalog.mjs'), 'utf8');
  for (const platform of ['win32', 'darwin', 'linux']) {
    await check(`catalog-${platform}-missing-and-stale`, () => {
      for (const age of [null, 31001]) {
        const fixture = catalogFixture(catalogSource, platform);
        fixture.registry([
          { id: 'idle', name: '未启动工作', dirName: 'idle', fixedCdpPort: 19403 },
          { id: 'other', name: '占用', dirName: 'other', fixedCdpPort: 19404 },
          { id: 'disabled', name: '禁用', dirName: 'disabled', fixedCdpPort: 19405, agentAccessDisabled: true }
        ]);
        fixture.lease(19404, 'another-session');
        if (age !== null) fixture.snapshot([], age);
        const catalog = fixture.api.listAgentBrowserProfileCatalogSync({ requestedSession: 'current' }, fixture.home, fixture.now);
        assert.equal(catalog.length, 3, 'registered profiles must remain visible without a fresh snapshot');
        assert.deepEqual(plain(catalog.map(p => [p.profileName, p.running, p.available, p.unavailableReason])), [
          ['未启动工作', false, true, null], ['占用', false, false, 'occupied'], ['禁用', false, false, 'agent_access_disabled']
        ]);
        const available = fixture.api.findAvailableAgentBrowserProfileCandidatesSync({ excludedPort: 19400, requestedSession: 'current' }, fixture.home, fixture.now);
        assert.deepEqual(plain(available.map(p => p.cdpPort)), [19403]);
      }
    });
  }
  await check('catalog-fresh-authority-and-ownership', () => {
    const f = catalogFixture(catalogSource);
    f.registry([
      { id: 'work', name: 'Registry name', dirName: 'work', fixedCdpPort: 21503 },
      { id: 'blocked', name: 'Blocked', dirName: 'blocked', fixedCdpPort: 21501, agentAccessDisabled: true },
      { id: 'self', name: 'Own session', dirName: 'self', fixedCdpPort: 21502 },
      { id: 'new-id', name: 'Reused port', dirName: 'new-id', fixedCdpPort: 21504 }
    ]);
    f.snapshot([
      { profileId: 'isolated:work', profileName: 'Old snapshot name', cdpPort: 21503, running: true },
      { profileId: 'isolated:blocked', profileName: 'Old block state', cdpPort: 21501, running: true, agentAccessDisabled: false },
      { profileId: 'isolated:old-id', profileName: 'Old occupant', cdpPort: 21504, running: true }
    ]);
    f.lease(21502, 'current');
    const catalog = f.api.listAgentBrowserProfileCatalogSync({ requestedSession: 'current' }, f.home, f.now);
    const byPort = new Map(catalog.map(p => [p.cdpPort, p]));
    assert.equal(byPort.get(21503).profileName, 'Registry name');
    assert.equal(byPort.get(21503).running, true);
    assert.equal(byPort.get(21504).running, false, 'port reuse is not proof that the new Profile is running');
    assert.equal(byPort.get(21501).available, false);
    assert.equal(byPort.get(21502).alreadyOwnedBySession, true);
    const result = f.api.findAvailableAgentBrowserProfileCandidatesSync({ excludedPort: 21504, requestedSession: 'current' }, f.home, f.now);
    assert.deepEqual(plain(result.map(p => p.cdpPort)), [21502, 21503]);
  });
  await check('catalog-explicit-directory-and-validation', () => {
    const f = catalogFixture(catalogSource, 'darwin');
    const custom = '/isolated-test/registry';
    f.registry([
      { id: 'last', name: 'Last port fallback', dirName: 'last', lastCdpPort: 25001 },
      { id: 'escape', name: 'Traversal', dirName: '../../elsewhere', fixedCdpPort: 25002 },
      { id: 'invalid', name: 'Invalid', dirName: 'invalid', fixedCdpPort: 70000 },
      { id: 'missing', name: 'Missing directory', fixedCdpPort: 25004 }
    ], custom);
    const result = f.api.findAvailableAgentBrowserProfileCandidatesSync({ excludedPort: 25000, env: { CPM_DATA_DIR: custom } }, f.home, f.now);
    assert.deepEqual(plain(result.map(p => [p.cdpPort, p.profileName])), [[25001, 'Last port fallback']]);
  });
  await check('catalog-malformed-registry-fallback', () => {
    const f = catalogFixture(catalogSource, 'linux');
    f.files.set(f.paths.join(f.home, '.config', 'codex-chrome-profile-manager', 'profiles.json'), '{bad-json');
    f.registry([{ id: 'valid', name: 'Next directory', dirName: 'valid', fixedCdpPort: 26300 }]);
    const result = f.api.findAvailableAgentBrowserProfileCandidatesSync({ excludedPort: 26000 }, f.home, f.now);
    assert.deepEqual(plain(result.map(p => p.cdpPort)), [26300]);
  });

  let ui, render;
  await check('ui-module-load', async () => {
    ui = await import(pathToFileURL(path.join(workspace, 'src/fixture-ui.mjs')).href);
    ({ render } = await import(pathToFileURL(path.join(workspace, 'src/render-root.mjs')).href));
  });
  if (ui && render) {
    function setup({ failure = false, wait = null } = {}) {
      const dom = createDom();
      Object.assign(globalThis, { document: dom.document, window: dom.window, FormData: dom.FormData });
      let persisted = { profiles: [{ id: 'work', name: 'Before' }, { id: 'other', name: 'Other name' }], runningProfiles: [], externalInstances: [] };
      const calls = [];
      const api = {
        async getState() { return structuredClone(persisted); },
        async renameProfile(id, name) {
          calls.push({ id, name });
          if (wait) await wait;
          if (failure) throw Error('Simulated save error');
          persisted.profiles.find(p => p.id === id).name = name;
          return structuredClone(persisted);
        }
      };
      ui.configureUi(dom.root, api, structuredClone(persisted));
      const open = id => { ui.store.modal = { kind: 'rename', profileId: id }; render(); };
      open('work');
      return { ...dom, api, calls, open, persisted: () => structuredClone(persisted), input: () => dom.root.querySelector('#profile-rename') };
    }
    await check('rename-one-submit-existing-behavior', async () => {
      const f = setup();
      f.input().value = 'One submit already worked';
      await ui.submitRename(f.root.querySelector('[data-rename-form]'));
      assert.deepEqual(f.calls, [{ id: 'work', name: 'One submit already worked' }]);
      assert.equal(f.persisted().profiles[0].name, 'One submit already worked');
      assert.equal(f.root.querySelector('[data-rename-form]'), null);
      ui.configureUi(f.root, f.api, await f.api.getState()); f.open('work');
      assert.equal(f.input().value, 'One submit already worked');
    });
    await check('rename-draft-survives-status-refresh', () => {
      const f = setup();
      f.input().value = '用户草稿 <&"\'>';
      ui.store.startupSettings = { supported: true, enabled: true }; render();
      assert.equal(f.input().value, '用户草稿 <&"\'>');
      assert.equal(f.persisted().profiles[0].name, 'Before', 'typing alone must not persist');
    });
    await check('rename-draft-survives-pending-save', async () => {
      let release;
      const wait = new Promise(resolve => { release = resolve; });
      const f = setup({ wait });
      f.input().value = '一次保存';
      const saving = ui.submitRename(f.root.querySelector('[data-rename-form]'));
      const during = f.input()?.value;
      release(); await saving;
      assert.equal(during, '一次保存', 'pending save must not repaint the old name');
      assert.equal(f.calls.length, 1);
      assert.equal(f.persisted().profiles[0].name, '一次保存');
      assert.equal(f.root.querySelector('[data-rename-form]'), null);
    });
    await check('rename-failure-keeps-draft-and-retry', async () => {
      const f = setup({ failure: true });
      f.input().value = 'Retry <&"\'> name';
      await ui.submitRename(f.root.querySelector('[data-rename-form]'));
      assert.equal(f.input()?.value, 'Retry <&"\'> name');
      assert.equal(ui.store.toastKind, 'error');
      assert.equal(f.persisted().profiles[0].name, 'Before');
      const saved = f.persisted();
      f.api.renameProfile = async (id, name) => { saved.profiles.find(p => p.id === id).name = name; return structuredClone(saved); };
      f.api.getState = async () => structuredClone(saved);
      await ui.submitRename(f.root.querySelector('[data-rename-form]'));
      assert.equal(saved.profiles[0].name, 'Retry <&"\'> name');
      assert.equal(saved.profiles[1].name, 'Other name');
      assert.equal(f.root.querySelector('[data-rename-form]'), null);
      ui.configureUi(f.root, f.api, await f.api.getState()); f.open('work');
      assert.equal(f.input().value, 'Retry <&"\'> name', 'simulated restart must load persisted state');
    });
    await check('rename-profile-boundary-and-noop-render', () => {
      const f = setup();
      f.input().value = 'Unsubmitted A';
      const writes = f.root.writes; render();
      assert.equal(f.root.writes, writes, 'unchanged state should not rewrite DOM');
      f.open('other'); assert.equal(f.input().value, 'Other name');
      f.input().value = 'Unsubmitted B';
      ui.store.modal = null; render(); f.open('other');
      assert.equal(f.input().value, 'Other name');
    });
  }
  await check('report-present', async () => {
    assert.ok((await readFile(path.join(workspace, 'REPORT.md'), 'utf8')).trim().length > 20);
  });
  const passed = checks.every(c => c.passed);
  console.log(JSON.stringify({ passed, checks }));
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, error: String(error.message || error) }));
  process.exitCode = 2;
}
