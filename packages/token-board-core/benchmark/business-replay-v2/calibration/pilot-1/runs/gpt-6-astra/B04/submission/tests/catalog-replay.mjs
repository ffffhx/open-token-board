import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'profilepilot-catalog-'));
const oldEnv={...process.env};
try {
  // All registry search paths and lease files belong to the test.
  process.env.CPM_DATA_DIR=path.join(scratch,'custom data');
  process.env.APPDATA=path.join(scratch,'appdata');
  process.env.XDG_CONFIG_HOME=path.join(scratch,'config');
  const file=path.join(scratch,'lease.cjs');
  await build({entryPoints:[path.join(root,'src/main/agent-browser-lease.ts')],bundle:true,platform:'node',format:'cjs',outfile:file,logLevel:'silent'});
  const api=createRequire(import.meta.url)(file);
  const home=path.join(scratch,'home');
  fs.mkdirSync(process.env.CPM_DATA_DIR,{recursive:true});
  const registry=path.join(process.env.CPM_DATA_DIR,'profiles.json');
  const profile=(id,port,extra={})=>({id,name:`Name ${id}`,dirName:id,fixedCdpPort:port,createdAt:new Date().toISOString(),lastLaunchedAt:null,...extra});
  const records=[profile('b',9402),null,profile('bad',0),profile('escape',9409,{dirName:'../outside'}),profile('a',9401),profile('disabled',9403,{agentAccessDisabled:true}),profile('last',null,{lastCdpPort:9404})];
  const save=()=>fs.writeFileSync(registry,JSON.stringify({profiles:records,extra:'unchanged'}));
  save();const original=fs.readFileSync(registry,'utf8');
  const now=Date.now();
  const catalog=()=>api.listAgentBrowserProfileCatalogSync({},home,now);
  assert.deepEqual(catalog().map(p=>p.cdpPort),[9401,9402,9403,9404]);
  assert(catalog().every(p=>p.running===false));
  assert.equal(api.findConfiguredAgentBrowserProfileByPortSync(9401,process.env,home).userDataDir,path.join(process.env.CPM_DATA_DIR,'profiles','a'));
  assert.equal(api.findConfiguredAgentBrowserProfileByPortSync(9409,process.env,home),null);
  const runtime=[
    {profileId:'isolated:a',profileName:'Old A',cdpPort:9401,running:true,agentAccessDisabled:true},
    {profileId:'isolated:someone-else',profileName:'Wrong B',cdpPort:9402,running:true},
    {profileId:'native:Default',profileName:'Native',cdpPort:9410,running:true}
  ];
  api.writeAgentBrowserRuntimeProfilesSync(runtime,home,now);
  let entries=catalog();
  assert.equal(entries.find(p=>p.cdpPort===9401).running,true);
  assert.equal(entries.find(p=>p.cdpPort===9401).profileName,'Name a');
  assert.equal(entries.find(p=>p.cdpPort===9401).available,true);
  assert.equal(entries.find(p=>p.cdpPort===9402).running,false);
  assert.equal(entries.find(p=>p.cdpPort===9410).running,true);
  records[4].name='Changed immediately';records[4].agentAccessDisabled=true;save();
  assert.equal(catalog()[0].profileName,'Changed immediately');
  assert.equal(catalog()[0].unavailableReason,'agent_access_disabled');
  records[4].agentAccessDisabled=false;save();
  api.acquireAgentBrowserProfileLeaseSync({cdpPort:9401,session:'cx-owner',holderPid:process.pid},home,now);
  const candidates=session=>api.findAvailableAgentBrowserProfileCandidatesSync({excludedPort:9404,requestedSession:session},home,now);
  assert.deepEqual(candidates('cx-other').map(p=>p.cdpPort),[9402,9410]);
  assert.deepEqual(candidates('cx-owner').map(p=>p.cdpPort),[9401,9402,9410]);
  assert.equal(candidates('cx-owner')[0].alreadyOwnedBySession,true);
  // A stale snapshot removes temporary targets, but never configured targets or live leases.
  const snapshotFile=api.agentBrowserRuntimeProfilesPath(home);
  const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));snapshot.updatedAt=new Date(now-60000).toISOString();
  fs.writeFileSync(snapshotFile,JSON.stringify(snapshot));
  assert.deepEqual(candidates('cx-other').map(p=>p.cdpPort),[9402]);
  assert.equal(catalog()[0].unavailableReason,'occupied');
  assert(catalog().every(p=>p.running===false));
  fs.writeFileSync(snapshotFile,'broken JSON');
  assert.deepEqual(candidates('cx-owner').map(p=>p.cdpPort),[9401,9402]);
  assert.equal(api.readActiveAgentBrowserProfileOccupancySync(9401,home,now+3600000).session,'cx-owner');
  // Reads must not mutate registration or unrelated metadata.
  records[4].name='Name a';delete records[4].agentAccessDisabled;save();
  catalog();assert.equal(fs.readFileSync(registry,'utf8'),original);
  console.log(JSON.stringify({registeredWithoutWindow:true,freshRuntimeUnion:true,identityMatching:true,immediateMetadata:true,leasesAndOrdering:true,staleAndMalformedSnapshot:true,customDataDirAndInvalidEntries:true,readOnlyRegistry:true}));
} finally {
  for(const key of ['CPM_DATA_DIR','APPDATA','XDG_CONFIG_HOME']) {if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key]}
  fs.rmSync(scratch,{recursive:true,force:true});
}
