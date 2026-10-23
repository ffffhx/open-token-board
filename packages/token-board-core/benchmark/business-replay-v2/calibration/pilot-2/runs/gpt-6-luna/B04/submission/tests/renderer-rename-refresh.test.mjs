import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
process.env.PLAYWRIGHT_BROWSERS_PATH = JSON.parse(fs.readFileSync(path.join(root, 'ENVIRONMENT.json'), 'utf8')).playwrightBrowsersPath;
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');

test('rename draft survives a pushed state refresh and cancellation discards it', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'profilepilot-rename-refresh-'));
  let browser;
  try {
    const dataDir = path.join(scratch, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const registryFile = path.join(dataDir, 'profiles.json');
    const records = [
      { id: 'one', name: 'Original One', dirName: 'one', fixedCdpPort: 9341, createdAt: '2026-09-01T00:00:00.000Z', lastLaunchedAt: null },
      { id: 'two', name: 'Original Two', dirName: 'two', fixedCdpPort: 9342, createdAt: '2026-09-01T00:00:00.000Z', lastLaunchedAt: null }
    ];
    fs.writeFileSync(registryFile, JSON.stringify({ profiles: records }));
    const devices = { name: 'isolated-renderer-test-devices', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'isolated-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'isolated-test' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(scratch)},isPackaged:false};export const shell={openExternal(){},openPath(){}};export const screen={};export const BrowserWindow=class{};export const globalShortcut={};export const ipcMain={};export const dialog={};export const nativeImage={};export const clipboard={};` }));
      builder.onResolve({ filter: /^(node:)?child_process$/ }, () => ({ path: 'disabled-process', namespace: 'isolated-process' }));
      builder.onLoad({ filter: /.*/, namespace: 'isolated-process' }, () => ({ contents: 'export const execFile=()=>{};export const execFileSync=()=>{};export const spawn=()=>{};export const spawnSync=()=>{};export const exec=()=>{};export const execSync=()=>{};export const fork=()=>{};' }));
    } };
    const renderer = (await build({ entryPoints: [path.join(root, 'src/renderer/main.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', plugins: [devices] })).outputFiles[0].text;
    const managerBundle = (await build({ entryPoints: [path.join(root, 'src/main/profile-manager.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', plugins: [devices] })).outputFiles[0].text;
    const managerPath = path.join(scratch, 'manager.cjs');
    fs.writeFileSync(managerPath, managerBundle);
    const { ProfileManager } = require(managerPath);
    const manager = new ProfileManager(dataDir);
    const state = () => ({
      profiles: JSON.parse(fs.readFileSync(registryFile, 'utf8')).profiles.map((p) => ({ ...p, id: `isolated:${p.id}`, source: 'isolated', userDataDir: path.join(dataDir, 'profiles', p.dirName), path: path.join(dataDir, 'profiles', p.dirName), profileDataPath: path.join(dataDir, 'profiles', p.dirName, 'Default'), running: false, pids: [], cdpPort: null, cdpUrl: null, bifrostProxy: null, upstreamProxy: null, directConnection: false, listeningPorts: [], pinnedToMini: false, quickLaunchSlot: null, clonedFromProfileId: null, clonedFromName: null, cloneCount: 0, cdpClients: [], gatewayControl: null, agentBrowserOccupancy: null, livePrimaryUrl: null, liveTabCount: null, cdpContention: null, agentActivity: null, windowActivation: 'background', userName: null, isDefault: false, deletable: true, agentAccessDisabled: false })), runningProfiles: [], currentProfile: null, externalInstances: [], chromeFound: true, platform: process.platform, dataDir, agentOverlayEnabled: true, miniProfileIds: [], mainProfileOrder: [], accountSyncRecords: {}, takeoverHistory: []
    });
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="app"></div>' }));
    await page.exposeFunction('testState', state);
    await page.exposeFunction('testRename', async (id, name) => { await manager.renameProfile(id, name); return state(); });
    await page.goto('http://replay.invalid/');
    await page.evaluate(() => {
      localStorage.setItem('profilepilot:onboarding:v1:seen', '1');
      window.profileManager = new Proxy({
        getInitialState: () => window.testState(), getState: () => window.testState(),
        renameProfile: (id, name) => window.testRename(id, name),
        getStartupSettings: async () => ({ enabled: false, supported: true }),
        onStateChanged: (listener) => { window.pushTestState = listener; return () => {}; }
      }, { get(target, key) { if (key in target) return target[key]; if (String(key).startsWith('on')) return () => () => {}; return async () => null; } });
    });
    await page.addScriptTag({ content: renderer });
    await page.waitForSelector('[data-action="toggle-startup"]:not([disabled])');
    const openRename = async (row) => {
      const id = `isolated:${row}`;
      await page.locator(`[data-action="toggle-profile-menu"][data-id="${id}"]`).click();
      await page.locator(`[data-action="rename-profile"][data-id="${id}"]`).click();
    };
    await openRename('one');
    await page.locator('#profile-rename').fill('User draft');
    const pushed = await page.evaluate(async () => {
      const state = await window.testState();
      state.profiles[0].name = 'Background refresh';
      window.pushTestState(state);
      return true;
    });
    assert.equal(pushed, true);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#profile-rename').inputValue(), 'User draft');
    await page.locator('[data-rename-form] button[type="submit"]').click();
    await page.waitForSelector('[data-rename-form]', { state: 'detached' });
    assert.equal(JSON.parse(fs.readFileSync(registryFile, 'utf8')).profiles[0].name, 'User draft');

    await openRename('two');
    await page.locator('#profile-rename').fill('Discarded draft');
    await page.locator('[data-rename-form] button[type="button"]').click();
    await openRename('two');
    assert.equal(await page.locator('#profile-rename').inputValue(), 'Original Two');
  } finally {
    if (browser) await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
