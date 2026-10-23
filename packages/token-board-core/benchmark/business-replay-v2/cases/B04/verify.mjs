import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = path.resolve(process.argv[2] || path.join(here, 'workspace'));
const require = createRequire(import.meta.url);
const checks = [];
let scratch, browser, context;
const originalEnvironment = Object.fromEntries(['CPM_DATA_DIR','APPDATA','XDG_CONFIG_HOME'].map(key=>[key,process.env[key]]));
function setRegistryEnvironment(env) {
  for(const key of ['CPM_DATA_DIR','APPDATA','XDG_CONFIG_HOME']) {
    if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];
  }
}
function check(id, passed, category, details) { checks.push({id, passed: Boolean(passed), category, details}); }
async function run(id, category, work) {
  try { const result = await work(); check(id, true, category, result ?? 'passed'); }
  catch (error) {
    if(browser && !browser.isConnected())throw new Error(`Test browser disconnected: ${error.message || error}`);
    check(id, false, category, String(error.message || error));
  }
}
function jsonWrite(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value,null,2)); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function registryRoot(home) {
  return process.platform === 'darwin' ? path.join(home,'Library','Application Support','ProfilePilot')
    : process.platform === 'win32' ? path.join(home,'ProfilePilot') : path.join(home,'.config','profilepilot');
}
const createdAt = '2026-09-01T00:00:00.000Z';
function stored(id, name, port, extra={}) { return {id,name,dirName:id,createdAt,lastLaunchedAt:null,fixedCdpPort:port,...extra}; }

try {
  let esbuild;
  try { esbuild = require('esbuild'); }
  catch { esbuild = createRequire(require.resolve('tsx'))('esbuild'); }
  const {chromium} = require('@playwright/test');
  if (esbuild.version !== '0.27.7') throw new Error(`Harness requires esbuild 0.27.7; found ${esbuild.version}`);
  if (require('@playwright/test/package.json').version !== '1.56.1') throw new Error('Harness requires Playwright 1.56.1');
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) throw new Error('Candidate workspace directory not found');
  if (!fs.existsSync(path.join(candidate,'src/renderer/main.ts'))) {
    check('candidate-build',false,'delivery','Required renderer entry is missing from candidate');
    throw Object.assign(new Error('Candidate entry removed'),{candidateFailure:true});
  }
  scratch = fs.mkdtempSync(path.join(os.tmpdir(),'business-replay-b04-'));
  const work = path.join(scratch,'candidate'); fs.cpSync(candidate,work,{recursive:true,filter:source => !['node_modules','.git','dist'].includes(path.basename(source))});
  const home = path.join(scratch,'home'); const dataDir = registryRoot(home);
  const registryFile = path.join(dataDir,'profiles.json');
  const env = {CPM_DATA_DIR:dataDir,APPDATA:home,XDG_CONFIG_HOME:path.join(home,'.config')};
  setRegistryEnvironment(env);
  const originalProfiles = [stored('owned','Shared Research',9344),stored('beta','Research Beta',9342,{projectTag:'reporting'}),stored('legacy','Legacy Slot',null,{lastCdpPort:9345}),stored('alpha','Research Alpha',9341,{projectTag:'research',agentAccessDisabled:false}),stored('private','Personal',9343,{agentAccessDisabled:true})];
  jsonWrite(registryFile,{profiles:originalProfiles,nativeProfiles:{},miniProfileIds:['isolated:alpha'],mainProfileOrder:['isolated:beta','isolated:alpha']});
  const plugins = [{name:'isolated-desktop-boundary',setup(build) {
    build.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'boundary'}));
    build.onLoad({filter:/.*/,namespace:'boundary'},()=>({contents:`const unavailable=()=>{throw new Error('Desktop/device operation outside replay boundary')}; export const app={getPath:()=>${JSON.stringify(home)},getLocale:()=> 'zh-CN',isPackaged:false}; export const shell={openExternal:unavailable,openPath:unavailable}; export const screen={}; export const BrowserWindow=unavailable; export const globalShortcut={}; export const ipcMain={}; export const dialog={}; export const nativeImage={}; export const clipboard={};`,loader:'js'}));
    build.onResolve({filter:/^(node:)?child_process$/},()=>({path:'process',namespace:'device-boundary'}));
    build.onLoad({filter:/.*/,namespace:'device-boundary'},()=>({contents:`export const execFile=()=>{throw new Error('OS process execution disabled in replay')};export const execFileSync=execFile;export const spawn=execFile;export const spawnSync=execFile;export const exec=execFile;export const execSync=execFile;export const fork=execFile;`,loader:'js'}));
  }}];
  let rendererCode, managerCode, leaseCode;
  try {
    const bundle = async(entry,platform,options={}) => (await esbuild.build({entryPoints:[path.join(work,entry)],bundle:true,write:false,platform,format:platform==='browser'?'iife':'cjs',target:'es2022',logLevel:'silent',...(platform==='node'?{plugins}:{}),...options})).outputFiles[0].text;
    rendererCode = await bundle('src/renderer/main.ts','browser');
    managerCode = await bundle('src/main/profile-manager.ts','node');
    leaseCode = await bundle('src/main/agent-browser-lease.ts','node');
    check('candidate-build',true,'delivery','Full renderer entry and main-process modules bundled from candidate source');
  } catch (error) {
    check('candidate-build',false,'delivery',String(error.message));
    throw Object.assign(new Error('Candidate build failed'),{candidateFailure:true});
  }
  const managerBundle=path.join(scratch,'manager.cjs'), leaseBundle=path.join(scratch,'lease.cjs');
  fs.writeFileSync(managerBundle,managerCode); fs.writeFileSync(leaseBundle,leaseCode);
  let ProfileManager, lease, manager;
  try {
    ({ProfileManager}=require(managerBundle)); lease=require(leaseBundle);
    manager=new ProfileManager(dataDir);
  } catch(error) {
    check('candidate-runtime',false,'delivery',String(error.stack||error));
    throw Object.assign(new Error('Candidate module initialization failed'),{candidateFailure:true});
  }
  const now=Date.now();
  const list=(options={},at=now)=>lease.listAgentBrowserProfileCatalogSync({...options,env},home,at);
  const snapshot=(profiles,at=now)=>{
    const written=lease.writeAgentBrowserRuntimeProfilesSync(profiles,home,at);
    // JSON array order is not a business ordering contract. Preserve the actual
    // writer's values, but serialize in reverse order to exercise catalog ordering.
    jsonWrite(lease.agentBrowserRuntimeProfilesPath(home),{...written,profiles:[...written.profiles].reverse()});
    return written;
  };
  const runtime=(id,name,port,extra={})=>({profileId:`isolated:${id}`,profileName:name,cdpPort:port,source:'isolated',running:true,...extra});
  const leaseFile=port=>lease.agentBrowserProfileLeasePath(home,port);
  const putLease=(port,session,extra={})=>jsonWrite(leaseFile(port),{version:1,cdpPort:port,profileId:`isolated:${port===9344?'owned':'alpha'}`,profileName:'occupied',session,holderPid:process.pid,acquiredAt:new Date(now-1000).toISOString(),updatedAt:new Date(now).toISOString(),expiresAt:new Date(now+90_000).toISOString(),...extra});

  await run('catalog-without-desktop', 'business',()=>{
    const rows=list(); assert.deepEqual(rows.map(p=>p.cdpPort),[9341,9342,9343,9344,9345]);
    assert.equal(rows.find(p=>p.cdpPort===9341).running,false); return 'All registered launchable slots remain discoverable without a runtime snapshot';
  });
  await run('catalog-stale-snapshot','business',()=>{
    snapshot([runtime('alpha','Outdated Alpha',9341),runtime('runtime-only','Old transient',9399)],now-31_000);
    const rows=list(); assert.equal(rows.find(p=>p.cdpPort===9341)?.profileName,'Research Alpha');
    assert.equal(rows.find(p=>p.cdpPort===9341)?.running,false); assert.ok(!rows.some(p=>p.cdpPort===9399));
  });
  await run('catalog-fresh-rename-and-identity','business',async()=>{
    await manager.renameProfile('isolated:alpha','Catalog Renamed');
    snapshot([runtime('alpha','Outdated Alpha',9341),runtime('previous-owner','Port reused',9342),runtime('runtime-only','Runtime tab',9350)],now);
    const rows=list(); assert.equal(rows.find(p=>p.cdpPort===9341)?.profileName,'Catalog Renamed');
    assert.equal(rows.find(p=>p.cdpPort===9341)?.running,true); assert.equal(rows.find(p=>p.cdpPort===9342)?.running,false);
    assert.equal(rows.find(p=>p.cdpPort===9350)?.profileName,'Runtime tab');
  });
  for(const {id,port,initialDisabled,nextDisabled,direction} of [
    {id:'alpha',port:9341,initialDisabled:false,nextDisabled:true,direction:'disable'},
    {id:'private',port:9343,initialDisabled:true,nextDisabled:false,direction:'enable'}
  ]) {
    await run(`catalog-fresh-permission-${direction}`,'business',()=>{
      const original=JSON.parse(fs.readFileSync(registryFile,'utf8'));
      snapshot([runtime(id,'Settings target',port,{agentAccessDisabled:initialDisabled}),runtime('runtime-only','Runtime tab',9350)],now);
      const initial=list().find(profile=>profile.cdpPort===port);
      assert.equal(initial?.available,!initialDisabled,'Initial catalog must reflect the existing access setting');
      const updated={...original,profiles:original.profiles.map(profile=>profile.id===id?{...profile,agentAccessDisabled:nextDisabled}:profile)};
      jsonWrite(registryFile,updated);
      try {
        const current=list().find(profile=>profile.cdpPort===port);
        assert.equal(Boolean(current?.agentAccessDisabled),nextDisabled,'Registry access changes must override a still-fresh conflicting snapshot');
        assert.equal(current?.available,!nextDisabled);
        assert.equal(current?.unavailableReason,nextDisabled?'agent_access_disabled':null);
        const candidates=lease.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:9350,requestedSession:'requesting-agent',env},home,now);
        assert.equal(candidates.some(profile=>profile.cdpPort===port),!nextDisabled,'Recommendations must immediately honor the access change');
      } finally { jsonWrite(registryFile,original); }
    });
  }
  await run('catalog-input-order','business',()=>{
    snapshot([runtime('legacy','Legacy Slot',9345),runtime('runtime-only','Runtime tab',9350),runtime('alpha','Catalog Renamed',9341)],now);
    assert.deepEqual(list().map(profile=>profile.cdpPort),[9341,9342,9343,9344,9345,9350],'Catalog order must not depend on registry/snapshot serialization order');
    assert.deepEqual(lease.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:9344,requestedSession:'requesting-agent',env},home,now).map(profile=>profile.cdpPort),[9341,9342,9345,9350],'Recommendations must apply permission/exclusion filtering and ascending port order');
  });
  await run('catalog-occupancy-permissions','business',()=>{
    snapshot([],now-40_000); putLease(9344,'other-session');
    const rows=list({requestedSession:'requesting-agent'});
    assert.equal(rows.find(p=>p.cdpPort===9344)?.unavailableReason,'occupied');
    assert.equal(rows.find(p=>p.cdpPort===9343)?.unavailableReason,'agent_access_disabled');
    assert.equal(list({requestedSession:'other-session'}).find(p=>p.cdpPort===9344)?.alreadyOwnedBySession,true);
    assert.deepEqual(lease.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:9341,requestedSession:'requesting-agent',env},home,now).map(p=>p.cdpPort),[9342,9345]);
  });
  await run('catalog-path-containment','preservation',()=>{
    const original=JSON.parse(fs.readFileSync(registryFile,'utf8'));
    jsonWrite(registryFile,{...original,profiles:[...original.profiles,stored('escaped','Outside registry',9348,{dirName:'../escape'}),stored('bad-port','Invalid',99999),{id:'incomplete',fixedCdpPort:9349}]});
    try {
      const rows=list(); assert.ok(rows.every(p=>![9348,9349,99999].includes(p.cdpPort)));
      assert.ok(rows.some(p=>p.cdpPort===9342),'Valid registry entries must survive malformed neighbors');
    } finally { jsonWrite(registryFile,original); }
  });
  await run('catalog-broken-snapshot','business',()=>{
    fs.writeFileSync(lease.agentBrowserRuntimeProfilesPath(home),'{broken');
    assert.ok(list().some(p=>p.cdpPort===9342));
  });
  await run('catalog-live-lease-after-expiry','preservation',()=>{
    snapshot([],now-40_000); putLease(9344,'other-session',{expiresAt:new Date(now-100_000).toISOString()});
    assert.equal(list().find(p=>p.cdpPort===9344)?.unavailableReason,'occupied','Live holder PID keeps ownership');
  });
  await run('catalog-custom-data-root','business',()=>{
    const otherHome=path.join(scratch,'other-home'),custom=path.join(scratch,'custom-data');
    jsonWrite(path.join(custom,'profiles.json'),{profiles:[stored('custom','Custom directory',9441)]});
    const customEnvironment={CPM_DATA_DIR:custom,APPDATA:otherHome,XDG_CONFIG_HOME:path.join(otherHome,'.config')};
    setRegistryEnvironment(customEnvironment);
    try {
      const rows=lease.listAgentBrowserProfileCatalogSync({env:customEnvironment},otherHome,now);
      assert.equal(rows[0]?.profileName,'Custom directory');
    } finally { setRegistryEnvironment(env); }
  });

  // A fresh disposable Chromium context supplies real DOM, FormData and browser event ordering.
  // No persistent context, system Chrome executable, extension, CDP endpoint or signed-in Profile is used.
  browser=await chromium.launch({headless:true,channel:'chromium'});
  context=await browser.newContext();
  context.setDefaultTimeout(5000);
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><div id="app"></div></body></html>'}));
  const calls=[];
  function state() {
    const registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
    const profiles=registry.profiles.map(p=>({id:`isolated:${p.id}`,name:p.name,source:'isolated',dirName:p.dirName,userDataDir:path.join(dataDir,'profiles',p.dirName),path:path.join(dataDir,'profiles',p.dirName),profileDataPath:path.join(dataDir,'profiles',p.dirName,'Default'),createdAt:p.createdAt,lastLaunchedAt:p.lastLaunchedAt,running:false,pids:[],extensions:[],cdpPort:null,cdpUrl:null,fixedCdpPort:p.fixedCdpPort,agentAccessDisabled:p.agentAccessDisabled,projectTag:p.projectTag,extensionCount:0,profileCount:1,accountSync:null,userName:null,isDefault:false,deletable:true,bifrostProxy:null,upstreamProxy:null,directConnection:false,listeningPorts:[],pinnedToMini:false,quickLaunchSlot:null,clonedFromProfileId:null,clonedFromName:null,cloneCount:0,cdpClients:[],gatewayControl:null,agentBrowserOccupancy:null,livePrimaryUrl:null,liveTabCount:null,cdpContention:null,agentActivity:null,windowActivation:'background'}));
    return {profiles,runningProfiles:[],currentProfile:null,externalInstances:[],chromeFound:true,chromeCommand:'test-only',platform:process.platform,dataDir,agentOverlayEnabled:true,miniProfileIds:[],mainProfileOrder:[],accountSyncRecords:{},takeoverHistory:[]};
  }
  async function pageForRename(startupPending=true) {
    const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('__replayState',()=>state());
    await page.exposeFunction('__replayRename',async(id,name)=>{calls.push({id,name});await manager.renameProfile(id,name);return state();});
    await page.goto('http://replay.invalid/');
    await page.evaluate(({startupPending})=>{
      localStorage.setItem('profilepilot:onboarding:v1:seen','1');
      window.__callbacks={};
      const startup={enabled:false,supported:true,requiresApproval:false};
      let resolveStartup; const startupPromise=startupPending?new Promise(resolve=>{resolveStartup=resolve}):Promise.resolve(startup);
      window.__releaseStartup=()=>resolveStartup?.(startup);
      window.profileManager=new Proxy({
        getInitialState:()=>window.__replayState(),getState:()=>window.__replayState(),getStartupSettings:()=>startupPromise,
        renameProfile:(id,name)=>window.__replayRename(id,name),
        getBifrostSnapshot:async()=>({available:false,running:false,proxies:[],rules:[],providers:[]}),
        getViewMode:async()=> 'main'
      },{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return callback=>{window.__callbacks[key]=callback;return()=>{}};return async()=>null;}});
    },{startupPending});
    await page.addScriptTag({content:rendererCode});
    try { await page.waitForSelector('[data-action="toggle-profile-menu"]'); }
    catch(error) { throw new Error(`${error.message}; page errors=${JSON.stringify(errors)}; DOM=${(await page.locator('body').innerText()).slice(0,600)}`); }
    return {page,errors};
  }
  async function openRename(page,id='alpha') {
    await page.locator(`[data-action="toggle-profile-menu"][data-id="isolated:${id}"]`).first().click();
    await page.locator(`[data-action="rename-profile"][data-id="isolated:${id}"]`).click();
    await page.waitForSelector('#profile-rename');
  }
  await run('rename-first-save-persists','business',async()=>{
    const {page,errors}=await pageForRename();
    await openRename(page); const desired='首次保存 · Research & Review';
    await page.locator('#profile-rename').fill(desired);
    await page.evaluate(()=>window.__releaseStartup());
    await page.waitForFunction(()=>document.querySelector('[data-action="toggle-startup"]')?.getAttribute('disabled')===null);
    const afterRefresh=await page.locator('#profile-rename').inputValue();
    await page.locator('[data-rename-form] button[type="submit"]').click();
    await page.waitForSelector('[data-rename-form]',{state:'detached'});
    const disk=JSON.parse(fs.readFileSync(registryFile,'utf8')).profiles.find(p=>p.id==='alpha').name;
    const shown=await page.locator('#app').innerText();
    assert.equal(afterRefresh,desired,'Background startup completion must preserve the draft');
    assert.equal(disk,desired,'First save must reach the real registry'); assert.ok(shown.includes(desired));assert.deepEqual(errors,[]);
    await page.close();
    return {savedName:disk,renameCalls:calls.length,storage:'real temporary profiles.json'};
  });
  await run('rename-empty-draft-validation','preservation',async()=>{
    const {page}=await pageForRename();await openRename(page,'beta');
    const before=calls.length;await page.locator('#profile-rename').fill('');await page.evaluate(()=>window.__releaseStartup());
    await page.waitForFunction(()=>document.querySelector('[data-action="toggle-startup"]')?.getAttribute('disabled')===null);
    assert.equal(await page.locator('#profile-rename').inputValue(),'','An intentional empty draft must not revert to the saved name');
    await page.locator('[data-rename-form] button[type="submit"]').click();
    assert.equal(calls.length,before,'Native form validation should block empty submission');await page.close();
  });
  await run('rename-cancel-does-not-cross-profile','preservation',async()=>{
    const {page}=await pageForRename(false); await openRename(page,'alpha');await page.locator('#profile-rename').fill('Do not leak');
    await page.locator('[data-rename-form] [data-action="close-modal"]').click();
    await openRename(page,'beta');assert.equal(await page.locator('#profile-rename').inputValue(),'Research Beta');
    await page.locator('[data-rename-form] [data-action="close-modal"]').click();await openRename(page,'alpha');
    const saved=JSON.parse(fs.readFileSync(registryFile,'utf8')).profiles.find(p=>p.id==='alpha').name;
    assert.equal(await page.locator('#profile-rename').inputValue(),saved);await page.close();
  });
  await run('rename-registry-preserves-neighbors','preservation',async()=>{
    const disk=JSON.parse(fs.readFileSync(registryFile,'utf8'));
    assert.equal(disk.profiles.find(p=>p.id==='beta').name,'Research Beta');
    assert.equal(disk.profiles.find(p=>p.id==='alpha').fixedCdpPort,9341);
    assert.equal(disk.profiles.find(p=>p.id==='private').agentAccessDisabled,true);
    assert.deepEqual(disk.mainProfileOrder,['isolated:beta','isolated:alpha']);
    const freshManager=new ProfileManager(dataDir);await freshManager.renameProfile('isolated:beta','Reloaded Beta');
    assert.equal(JSON.parse(fs.readFileSync(registryFile,'utf8')).profiles.find(p=>p.id==='beta').name,'Reloaded Beta');
    await assert.rejects(()=>freshManager.renameProfile('isolated:beta',' '.repeat(5)));
  });
  await run('frozen-context-preserved','delivery',()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(here,'source-manifest.json'),'utf8'));
    const changed=Object.keys(manifest.sha256).filter(file=>!fs.existsSync(path.join(candidate,file))||sha(path.join(candidate,file))!==manifest.sha256[file]);
    assert.ok(changed.every(file=>/^(src|tests)\//.test(file)),`Changes outside source/test tree: ${changed.filter(file=>!/^(src|tests)\//.test(file)).join(', ')}`);
    return {changedFiles:changed};
  });
} catch(error) {
  if (!error.candidateFailure) {
    check('harness-environment',false,'delivery',String(error.stack||error));
    process.exitCode=2;
  }
} finally {
  setRegistryEnvironment(originalEnvironment);
  if(context)await context.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(scratch)fs.rmSync(scratch,{recursive:true,force:true});
}
if(process.exitCode!==2)process.exitCode=checks.every(c=>c.passed)?0:1;
console.log(JSON.stringify({schemaVersion:1,caseId:'B04',checks,passed:process.exitCode===0,exitCode:process.exitCode}));
