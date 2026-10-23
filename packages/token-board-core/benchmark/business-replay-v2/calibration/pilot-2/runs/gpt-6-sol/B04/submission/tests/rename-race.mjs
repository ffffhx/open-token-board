import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const config = JSON.parse(fs.readFileSync(path.join(root, "ENVIRONMENT.json"), "utf8"));
process.env.PLAYWRIGHT_BROWSERS_PATH = config.playwrightBrowsersPath;
const { chromium } = require("@playwright/test");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "profilepilot-rename-race-"));
const dataDir = path.join(scratch, "data");
const registryPath = path.join(dataDir, "profiles.json");
let browser;

try {
  fs.mkdirSync(dataDir, { recursive: true });
  const profiles = [
    { id: "one", name: "First", dirName: "one", fixedCdpPort: 9341, createdAt: "2026-09-01T00:00:00.000Z", lastLaunchedAt: null },
    { id: "two", name: "Second", dirName: "two", fixedCdpPort: 9342, createdAt: "2026-09-01T00:00:00.000Z", lastLaunchedAt: null }
  ];
  fs.writeFileSync(registryPath, JSON.stringify({ profiles }));
  const devicePlugin = { name: "test-device-boundary", setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `const unavailable=()=>{throw Error('Desktop devices are unavailable')};export const app={getPath:()=>${JSON.stringify(scratch)},isPackaged:false};export const shell={openExternal:unavailable,openPath:unavailable};export const screen={};export const BrowserWindow=unavailable;export const globalShortcut={};export const ipcMain={};export const dialog={};export const nativeImage={};export const clipboard={};` }));
    builder.onResolve({ filter: /^(node:)?child_process$/ }, () => ({ path: "process", namespace: "device" }));
    builder.onLoad({ filter: /.*/, namespace: "device" }, () => ({ contents: `export const execFile=()=>{throw Error('Process launch disabled')};export const execFileSync=execFile;export const spawn=execFile;export const spawnSync=execFile;export const exec=execFile;export const execSync=execFile;export const fork=execFile;` }));
  } };
  const bundle = async (entry, platform) => (await build({
    entryPoints: [path.join(root, entry)], bundle: true, write: false, platform,
    format: platform === "browser" ? "iife" : "cjs", target: "es2022", logLevel: "silent",
    plugins: platform === "node" ? [devicePlugin] : []
  })).outputFiles[0].text;
  const renderer = await bundle("src/renderer/main.ts", "browser");
  const managerPath = path.join(scratch, "manager.cjs");
  fs.writeFileSync(managerPath, await bundle("src/main/profile-manager.ts", "node"));
  const { ProfileManager } = require(managerPath);
  const manager = new ProfileManager(dataDir);
  const state = () => ({
    profiles: JSON.parse(fs.readFileSync(registryPath, "utf8")).profiles.map((profile) => ({
      ...profile, id: `isolated:${profile.id}`, source: "isolated",
      userDataDir: path.join(dataDir, "profiles", profile.dirName),
      path: path.join(dataDir, "profiles", profile.dirName),
      profileDataPath: path.join(dataDir, "profiles", profile.dirName, "Default"),
      running: false, pids: [], cdpPort: null, cdpUrl: null, bifrostProxy: null,
      upstreamProxy: null, directConnection: false, listeningPorts: [], pinnedToMini: false,
      quickLaunchSlot: null, clonedFromProfileId: null, clonedFromName: null, cloneCount: 0,
      cdpClients: [], gatewayControl: null, agentBrowserOccupancy: null, livePrimaryUrl: null,
      liveTabCount: null, cdpContention: null, agentActivity: null, windowActivation: "background",
      userName: null, isDefault: false, deletable: true, agentAccessDisabled: false
    })),
    runningProfiles: [], currentProfile: null, externalInstances: [], chromeFound: true,
    platform: process.platform, dataDir, agentOverlayEnabled: true, miniProfileIds: [],
    mainProfileOrder: [], accountSyncRecords: {}, takeoverHistory: []
  });

  browser = await chromium.launch({ headless: true, channel: "chromium" });
  const context = await browser.newContext();
  context.setDefaultTimeout(5000);
  await context.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="app"></div>' }));
  const page = await context.newPage();
  await page.exposeFunction("testState", state);
  await page.exposeFunction("testRename", async (id, name) => {
    await manager.renameProfile(id, name);
    return state();
  });
  await page.goto("http://replay.invalid/");
  await page.evaluate(() => {
    localStorage.setItem("profilepilot:onboarding:v1:seen", "1");
    window.testResolveSettings = null;
    const settings = new Promise((resolve) => { window.testResolveSettings = resolve; });
    window.profileManager = new Proxy({
      getInitialState: () => window.testState(), getState: () => window.testState(),
      renameProfile: (id, name) => window.testRename(id, name),
      getStartupSettings: () => settings,
      getBifrostSnapshot: async () => ({ available: false, running: false, proxies: [], rules: [], providers: [] })
    }, { get(target, key) {
      if (key in target) return target[key];
      if (String(key).startsWith("on")) return () => () => {};
      return async () => null;
    } });
  });
  await page.addScriptTag({ content: renderer });
  await page.locator('[data-action="toggle-profile-menu"]').first().click();
  await page.locator('[data-action="rename-profile"]').first().click();
  await page.locator("#profile-rename").fill("First renamed once");
  await page.evaluate(() => window.testResolveSettings({ enabled: false, supported: true }));
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-startup"]')?.disabled === false);
  assert.equal(await page.locator("#profile-rename").inputValue(), "First renamed once");
  await page.locator('[data-rename-form] button[type="submit"]').click();
  await page.locator("[data-rename-form]").waitFor({ state: "detached" });
  assert.equal(JSON.parse(fs.readFileSync(registryPath, "utf8")).profiles[0].name, "First renamed once");
  assert.equal(JSON.parse(fs.readFileSync(registryPath, "utf8")).profiles[1].name, "Second");

  await page.locator('[data-action="toggle-profile-menu"]').first().click();
  await page.locator('[data-action="rename-profile"]').first().click();
  await page.locator("#profile-rename").fill("Discard me");
  await page.locator('[data-rename-form] [data-action="close-modal"]').click();
  await page.locator('[data-action="toggle-profile-menu"]').first().click();
  await page.locator('[data-action="rename-profile"]').first().click();
  assert.equal(await page.locator("#profile-rename").inputValue(), "First renamed once");
  await page.locator('[data-rename-form] [data-action="close-modal"]').click();
  await page.locator('[data-action="toggle-profile-menu"]').nth(1).click();
  await page.locator('[data-action="rename-profile"]').first().click();
  assert.equal(await page.locator("#profile-rename").inputValue(), "Second");
  console.log(JSON.stringify({ renameRacePersisted: true, cancelClearedDraft: true, otherProfileUnaffected: true }));
} finally {
  if (browser) await browser.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
