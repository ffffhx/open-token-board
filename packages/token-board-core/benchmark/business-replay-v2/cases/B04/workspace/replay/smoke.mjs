// Public, ordinary application smoke test. Extend tests/ for your own reproduction.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const config=JSON.parse(fs.readFileSync(path.join(root,'ENVIRONMENT.json'),'utf8'));
process.env.PLAYWRIGHT_BROWSERS_PATH=config.playwrightBrowsersPath;
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'profilepilot-smoke-'));
let browser;
try {
  const dataDir=path.join(scratch,'data');fs.mkdirSync(dataDir,{recursive:true});
  const profile={id:'demo',name:'Demo Profile',dirName:'demo',fixedCdpPort:9341,createdAt:'2026-09-01T00:00:00.000Z',lastLaunchedAt:null};
  const registryFile=path.join(dataDir,'profiles.json');fs.writeFileSync(registryFile,JSON.stringify({profiles:[profile]}));
  const plugins=[{name:'test-device-boundary',setup(builder){
    builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test'}));
    builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`const unavailable=()=>{throw Error('Desktop devices are unavailable in smoke test')};export const app={getPath:()=>${JSON.stringify(scratch)},isPackaged:false};export const shell={openExternal:unavailable,openPath:unavailable};export const screen={};export const BrowserWindow=unavailable;export const globalShortcut={};export const ipcMain={};export const dialog={};export const nativeImage={};export const clipboard={};`}));
    builder.onResolve({filter:/^(node:)?child_process$/},()=>({path:'process',namespace:'device'}));
    builder.onLoad({filter:/.*/,namespace:'device'},()=>({contents:`export const execFile=()=>{throw Error('Process launch disabled')};export const execFileSync=execFile;export const spawn=execFile;export const spawnSync=execFile;export const exec=execFile;export const execSync=execFile;export const fork=execFile;`}));
  }}];
  const bundle=async(entry,platform)=>(await build({entryPoints:[path.join(root,entry)],bundle:true,write:false,platform,format:platform==='browser'?'iife':'cjs',target:'es2022',logLevel:'silent',plugins:platform==='node'?plugins:[]})).outputFiles[0].text;
  const renderer=await bundle('src/renderer/main.ts','browser');
  const managerPath=path.join(scratch,'manager.cjs');fs.writeFileSync(managerPath,await bundle('src/main/profile-manager.ts','node'));
  const {ProfileManager}=require(managerPath),manager=new ProfileManager(dataDir);
  const state=()=>({profiles:JSON.parse(fs.readFileSync(registryFile,'utf8')).profiles.map(p=>({...p,id:`isolated:${p.id}`,source:'isolated',userDataDir:path.join(dataDir,'profiles',p.dirName),path:path.join(dataDir,'profiles',p.dirName),profileDataPath:path.join(dataDir,'profiles',p.dirName,'Default'),running:false,pids:[],cdpPort:null,cdpUrl:null,bifrostProxy:null,upstreamProxy:null,directConnection:false,listeningPorts:[],pinnedToMini:false,quickLaunchSlot:null,clonedFromProfileId:null,clonedFromName:null,cloneCount:0,cdpClients:[],gatewayControl:null,agentBrowserOccupancy:null,livePrimaryUrl:null,liveTabCount:null,cdpContention:null,agentActivity:null,windowActivation:'background',userName:null,isDefault:false,deletable:true,agentAccessDisabled:false})),runningProfiles:[],currentProfile:null,externalInstances:[],chromeFound:true,platform:process.platform,dataDir,agentOverlayEnabled:true,miniProfileIds:[],mainProfileOrder:[],accountSyncRecords:{},takeoverHistory:[]});
  browser=await chromium.launch({headless:true,channel:'chromium'});const context=await browser.newContext();context.setDefaultTimeout(5000);
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="app"></div>'}));
  const page=await context.newPage();await page.exposeFunction('smokeState',state);
  await page.exposeFunction('smokeRename',async(id,name)=>{await manager.renameProfile(id,name);return state()});
  await page.goto('http://replay.invalid/');
  await page.evaluate(()=>{localStorage.setItem('profilepilot:onboarding:v1:seen','1');window.profileManager=new Proxy({getInitialState:()=>window.smokeState(),getState:()=>window.smokeState(),renameProfile:(id,name)=>window.smokeRename(id,name),getStartupSettings:async()=>({enabled:false,supported:true}),getBifrostSnapshot:async()=>({available:false,running:false,proxies:[],rules:[],providers:[]})},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return()=>()=>{};return async()=>null;}})});
  await page.addScriptTag({content:renderer});await page.waitForSelector('[data-action="toggle-startup"]:not([disabled])');
  await page.locator('[data-action="toggle-profile-menu"]').click();await page.locator('[data-action="rename-profile"]').click();
  await page.locator('#profile-rename').fill('Smoke Rename');await page.locator('[data-rename-form] button[type="submit"]').click();
  await page.waitForSelector('[data-rename-form]',{state:'detached'});
  const saved=JSON.parse(fs.readFileSync(registryFile,'utf8')).profiles[0].name;
  console.log(JSON.stringify({started:true,ordinaryRenamePersisted:saved==='Smoke Rename',savedName:saved,browser:'disposable Chromium',data:'temporary registry'}));
  if(saved!=='Smoke Rename')process.exitCode=1;
}catch(error){console.error(error);process.exitCode=1;}
finally{if(browser)await browser.close();fs.rmSync(scratch,{recursive:true,force:true});}
