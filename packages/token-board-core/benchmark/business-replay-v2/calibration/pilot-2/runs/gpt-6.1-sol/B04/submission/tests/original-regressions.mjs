import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'profilepilot-original-tests-'));
process.env.APPDATA=path.join(scratch,'home');process.env.XDG_CONFIG_HOME=path.join(scratch,'home','.config');process.env.CPM_DATA_DIR=path.join(scratch,'data');
const plugins=[{name:'isolated-device-boundary',setup(b){
  b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'isolated-electron'}));
  b.onLoad({filter:/.*/,namespace:'isolated-electron'},()=>({contents:`const unavailable=()=>{throw Error('Desktop devices disabled')};export const app={getPath:()=>${JSON.stringify(scratch)},isPackaged:false};export const shell={openExternal:unavailable,openPath:unavailable};export const screen={};export const BrowserWindow=unavailable;export const globalShortcut={};export const ipcMain={};export const dialog={};export const nativeImage={};export const clipboard={};`}));
  b.onResolve({filter:/^(node:)?child_process$/},()=>({path:'process',namespace:'isolated-process'}));
  b.onLoad({filter:/.*/,namespace:'isolated-process'},()=>({contents:`export const execFile=()=>{throw Error('Device processes disabled')};export const execFileSync=execFile;export const spawn=execFile;export const spawnSync=execFile;export const exec=execFile;export const execSync=execFile;export const fork=execFile;`}));
}}];
try {
  for(const name of ['agent-browser-lease','process-scan','profile-manager'])await build({entryPoints:[path.join(root,'src/main',name+'.ts')],outfile:path.join(scratch,name+'.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins});
  for(const name of ['agent-browser-lease.test.js','registry-concurrency.test.js']){
    const file=path.join(root,'tests',name),mod=new Module(file);
    mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
    const ordinary=mod.require.bind(mod);
    mod.require=request=>request.startsWith('../dist/main/')?require(path.join(scratch,path.basename(request,'.js')+'.cjs')):ordinary(request);
    mod._compile(fs.readFileSync(file,'utf8'),file);
  }
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
