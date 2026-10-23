import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'profilepilot-catalog-test-'));
const original={CPM_DATA_DIR:process.env.CPM_DATA_DIR,APPDATA:process.env.APPDATA,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME};
try {
  const home=path.join(scratch,'home'),data=path.join(scratch,'custom-data');
  fs.mkdirSync(data,{recursive:true});
  process.env.CPM_DATA_DIR=data;process.env.APPDATA=home;process.env.XDG_CONFIG_HOME=path.join(home,'.config');
  const output=path.join(scratch,'lease.cjs');
  await build({entryPoints:[path.join(root,'src/main/agent-browser-lease.ts')],bundle:true,platform:'node',format:'cjs',outfile:output,logLevel:'silent',plugins:[{name:'no-device-process',setup(b){
    b.onResolve({filter:/^(node:)?child_process$/},()=>({path:'child_process',namespace:'isolated'}));
    b.onLoad({filter:/.*/,namespace:'isolated'},()=>({contents:`export const execFileSync=()=>{throw Error('Device inspection disabled')};export const execFile=execFileSync;`}));
  }}]});
  const api=require(output),now=Date.now();
  const registryFile=path.join(data,'profiles.json');
  const profile=(id,port,extra={})=>({id,name:id,dirName:id,fixedCdpPort:port,createdAt:new Date(now).toISOString(),lastLaunchedAt:null,...extra});
  const rows=[null,{id:'broken'},profile('escape',9320,{dirName:'../../escape'}),profile('badport',70000),profile('first',9341,{projectTag:'new tag',clonedFromProfileId:'native:Default'}),profile('disabled',9342,{agentAccessDisabled:true}),profile('owned',9343),profile('excluded',9344),profile('last',null,{lastCdpPort:9345})];
  const writeRegistry=()=>fs.writeFileSync(registryFile,JSON.stringify({profiles:rows,nativeProfiles:{Default:{name:'Native preserved'}},custom:{keep:1}}));
  writeRegistry();
  const catalog=(session='cx-request',excludedPort=9344,t=now)=>api.listAgentBrowserProfileCatalogSync({requestedSession:session,excludedPort},home,t);
  assert.deepEqual(catalog().map(p=>p.cdpPort),[9341,9342,9343,9345]);
  assert.equal(catalog()[0].running,false);
  assert.equal(catalog().find(p=>p.cdpPort===9342).unavailableReason,'agent_access_disabled');
  assert.equal(api.findConfiguredAgentBrowserProfileByPortSync(9341,process.env,home).userDataDir,path.join(data,'profiles','first'));
  assert.equal(api.findConfiguredAgentBrowserProfileByPortSync(9320,process.env,home),null);
  const before=fs.readFileSync(registryFile,'utf8');
  api.acquireAgentBrowserProfileLeaseSync({cdpPort:9343,session:'cx-owner',holderPid:process.pid},home,now);
  assert.equal(catalog().find(p=>p.cdpPort===9343).unavailableReason,'occupied');
  assert.equal(catalog('cx-owner').find(p=>p.cdpPort===9343).alreadyOwnedBySession,true);
  const runtime=[{profileId:'isolated:first',profileName:'Old first',cdpPort:9341,running:true,agentAccessDisabled:true,projectTag:'old'},
    {profileId:'isolated:someone-else',profileName:'Wrong identity',cdpPort:9345,running:true},
    {profileId:'native:Default',profileName:'Fresh native',cdpPort:9350,running:true},
    {profileId:'isolated:disabled',profileName:'Old disabled',cdpPort:9342,running:true}];
  api.writeAgentBrowserRuntimeProfilesSync(runtime,home,now);
  let result=catalog();
  assert.deepEqual(result.map(p=>p.cdpPort),[9341,9342,9343,9345,9350]);
  assert.equal(result[0].profileName,'first');assert.equal(result[0].running,true);assert.equal(result[0].available,true);assert.equal(result[0].projectTag,'new tag');
  assert.equal(result.find(p=>p.cdpPort===9345).running,false);
  assert.equal(result.find(p=>p.cdpPort===9342).available,false);
  rows[4].name='Renamed registration';rows[4].agentAccessDisabled=true;rows[5].agentAccessDisabled=false;writeRegistry();
  result=catalog();assert.equal(result[0].profileName,'Renamed registration');assert.equal(result[0].available,false);assert.equal(result.find(p=>p.cdpPort===9342).available,true);
  result=catalog('cx-request',9344,now+60000);
  assert.deepEqual(result.map(p=>p.cdpPort),[9341,9342,9343,9345]);assert.equal(result.some(p=>p.running),false);assert.equal(result.find(p=>p.cdpPort===9343).unavailableReason,'occupied');
  assert.equal(catalog('cx-owner',9344,now+60000).find(p=>p.cdpPort===9343).available,true);
  const snapshotFile=api.agentBrowserRuntimeProfilesPath(home);
  fs.writeFileSync(snapshotFile,'{broken');
  assert.deepEqual(catalog().map(p=>p.cdpPort),[9341,9342,9343,9345]);
  fs.rmSync(snapshotFile);
  assert.equal(catalog().length,4);
  api.writeAgentBrowserRuntimeProfilesSync(runtime,home,now);
  fs.writeFileSync(registryFile,'{broken');
  assert.deepEqual(catalog().map(p=>p.cdpPort),[9341,9342,9345,9350]);
  assert.equal(api.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:9344,requestedSession:'cx-request'},home,now).some(p=>p.cdpPort===9341),false);
  writeRegistry();
  assert.deepEqual(JSON.parse(fs.readFileSync(registryFile,'utf8')).custom,{keep:1});
  rows[4].name='first';delete rows[4].agentAccessDisabled;rows[5].agentAccessDisabled=true;writeRegistry();
  assert.equal(fs.readFileSync(registryFile,'utf8'),before);
  console.log(JSON.stringify({durableRegistration:true,authoritativeMetadata:true,identityMatchedRuntime:true,freshNativePreserved:true,staleTemporaryRemoved:true,leasesAndPolicy:true,customDirectoryAndInvalidRows:true,readOnlyCatalog:true}));
} finally {
  for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  fs.rmSync(scratch,{recursive:true,force:true});
}
