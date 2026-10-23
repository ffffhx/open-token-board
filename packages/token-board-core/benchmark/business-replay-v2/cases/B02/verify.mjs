import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {isDeepStrictEqual} from 'node:util';import crypto from 'node:crypto';
const dir=path.dirname(fileURLToPath(import.meta.url));const repo=path.resolve(dir,'../../../../../..');
const input=path.resolve(process.argv[2]||'');const temporary=path.join(repo,'tests/.tmp/business-replay-v2/B02');fs.mkdirSync(temporary,{recursive:true});
const run=fs.mkdtempSync(path.join(temporary,'verify-'));const checks=[];let db,base,app,outcome=2;
const check=(id,passed,category,details)=>checks.push({id,passed:Boolean(passed),category,details});
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];const p95=a=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*.95)-1)];const mad=a=>median(a.map(x=>Math.abs(x-median(a))));
const copy=(from,to)=>fs.cpSync(from,to,{recursive:true,filter:p=>!p.split(path.sep).some(v=>['node_modules','artifacts','.runtime'].includes(v))&&!p.endsWith('.replay-runtime.json')});
function prepare(workspace){const p=spawnSync(process.execPath,[path.join(dir,'prepare.mjs'),workspace],{encoding:'utf8',windowsHide:true,timeout:240000});if(p.status!==0)throw Error('Runtime preparation: '+(p.stdout||p.stderr));return JSON.parse(fs.readFileSync(path.join(workspace,'.replay-runtime.json'),'utf8'));}
function normalized(entries){return entries.map(({generatedAt,...entry})=>entry).sort((a,b)=>a.key.localeCompare(b.key));}
function compare(a,b){if(isDeepStrictEqual(normalized(a),normalized(b)))return {passed:true};const aa=new Map(a.map(e=>[e.key,e]));return {passed:false,mismatched:b.filter(e=>!isDeepStrictEqual(normalized([aa.get(e.key)||{}]),normalized([e]))).map(e=>e.key),actualKeys:a.map(e=>e.key),expectedKeys:b.map(e=>e.key)};}
async function candidateCall(operation){try{return await operation();}catch(error){error.candidateFailure=true;throw error;}}
async function candidateService(harness,...args){const service=await candidateCall(()=>harness.service(...args));const command=service.command;service.command=op=>candidateCall(async()=>{const value=await command(op);if(op==='state'&&(!value||!Array.isArray(value.entries)||value.entries.some(e=>!e||typeof e.key!=='string'||!e.summary||typeof e.summary!=='object')))throw Error('Candidate returned an invalid snapshot state');return value;});return service;}
try{
  const baseline=path.join(run,'baseline'),candidate=path.join(run,'candidate');copy(path.join(dir,'workspace'),baseline);copy(input,candidate);
  const runtime=prepare(baseline);prepare(candidate);
  const require=createRequire(path.join(baseline,'package.json'));const {register}=await import(pathToFileURL(require.resolve('tsx/esm/api')));register();
  const harness=await import(pathToFileURL(path.join(baseline,'replay/run.mjs')));const fixtureModule=await import(pathToFileURL(path.join(baseline,'replay/fixture.mjs')));
  const events=fixtureModule.fixture();db=await harness.database(runtime,path.join(run,'database'));await harness.seed(baseline,db.url,'replay',events);
  base=await harness.service(baseline,db.url,'replay',path.join(run,'baseline-api'));app=await candidateService(harness,candidate,db.url,'replay',path.join(run,'candidate-api'));
  const original=(await base.command('state')).entries;let candidateState=await app.command('state');const initial=compare(candidateState.entries,original);
  check('all-statistics-identical',initial.passed,'business',{combinations:54,...initial});
  if(!initial.passed)throw Object.assign(Error('Full statistics contract failed; performance is not graded for a candidate that changes the result.'),{candidateFailure:true,checkId:'performance-not-graded'});
  // Warm both services once, then alternate their execution order every pair.
  await harness.measure(base);await harness.measure(app);
  const samples=[];for(let i=0;i<7;i++){let b,c;if(i%2){c=await harness.measure(app);b=await harness.measure(base);}else{b=await harness.measure(base);c=await harness.measure(app);}samples.push({round:i+1,order:i%2?'candidate,baseline':'baseline,candidate',baseline:b,candidate:c});process.stderr.write(`B02 pair ${i+1}/7: baseline=${Math.round(b.durationMs)}ms candidate=${Math.round(c.durationMs)}ms\n`);harness.json(path.join(run,'samples.json'),samples);}
  const bm=samples.map(x=>x.baseline.durationMs),cm=samples.map(x=>x.candidate.durationMs),paired=samples.map(x=>x.baseline.durationMs-x.candidate.durationMs);
  const gain=median(paired),noise=3*mad(paired),wins=paired.filter(x=>x>0).length;
  check('repeatable-refresh-improvement',median(cm)<median(bm)*.85&&gain>noise&&wins>=6,'business',{baselineMs:bm,candidateMs:cm,baselineMedianMs:median(bm),candidateMedianMs:median(cm),pairedGainMedianMs:gain,pairedNoise3MAD:noise,pairedWins:wins,rule:'7 alternating pairs after warmup; at least 15% median improvement, 6 paired wins, and median paired gain > 3*MAD of paired differences'});
  const br=samples.flatMap(s=>s.baseline.reads),cr=samples.flatMap(s=>s.candidate.reads);const expectedReadDigest=harness.businessDigest(original.find(e=>e.key==='today:tokens')?.summary);const validRead=r=>r.status===200&&r.source==='snapshot'&&r.summarySha256===expectedReadDigest;
  // A measurement floor avoids treating sub-millisecond differences as user-visible regression.
  check('reads-available-during-refresh',cr.length>=7&&cr.every(validRead)&&p95(cr.map(r=>r.ms))<=Math.max(100,p95(br.map(r=>r.ms))*1.3),'business',{reads:cr.length,successfulAndConsistent:cr.filter(validRead).length,baselineP95Ms:p95(br.map(r=>r.ms)),candidateP95Ms:p95(cr.map(r=>r.ms)),latencyAllowance:'max(100ms, baseline P95 * 1.3); exact cached summary and HTTP 200 for each sampled read'});
  const corrected={...events[0],inputTokens:events[0].inputTokens+4321,totalTokens:events[0].totalTokens+4321};await harness.seed(baseline,db.url,'replay',[corrected]);await base.command('refresh');
  await Promise.all([app.command('refresh'),app.command('refresh')]);const updated=(await base.command('state')).entries;candidateState=await app.command('state');const correction=compare(candidateState.entries,updated);
  check('corrected-data-and-overlap',correction.passed&&!isDeepStrictEqual(normalized(original),normalized(updated)),'business',correction);
  await db.admin.query('ALTER TABLE replay.usage_events RENAME TO unavailable_events');let failed=false;try{await app.command('refresh');}catch{failed=true;}
  const failedState=await app.command('state');const oldRead=await candidateCall(()=>fetch(app.base+'/api/usage/leaderboard?range=today&metric=tokens',{signal:AbortSignal.timeout(30000)}).then(async r=>({status:r.status,body:await r.json()})));
  check('failure-preserves-valid-snapshot',failed&&Boolean(failedState.lastError)&&compare(failedState.entries,updated).passed&&oldRead.status===200&&isDeepStrictEqual(oldRead.body.summary,updated.find(e=>e.key==='today:tokens')?.summary),'business',{refreshRejected:failed,errorRecorded:Boolean(failedState.lastError),remainingEntries:failedState.entries.length,readStatus:oldRead.status});
  await db.admin.query('ALTER TABLE replay.unavailable_events RENAME TO usage_events');await app.command('refresh');const recovered=await app.command('state');check('failure-recovery',!recovered.lastError&&compare(recovered.entries,updated).passed,'business',{entries:recovered.entries.length,error:recovered.lastError});
  await app.close();app=await candidateService(harness,candidate,db.url,'replay',path.join(run,'candidate-api'));check('restart-restores-full-results',compare((await app.command('state')).entries,updated).passed,'business',{entries:(await app.command('state')).entries.length});
  await app.close();app=null;await base.close();base=null;
  await harness.seed(baseline,db.url,'empty',[]);base=await harness.service(baseline,db.url,'empty',path.join(run,'empty-baseline'));app=await candidateService(harness,candidate,db.url,'empty',path.join(run,'empty-candidate'));
  const empty=compare((await app.command('state')).entries,(await base.command('state')).entries);check('empty-dataset-compatible',empty.passed,'preservation',empty);
  const reportFile=path.join(run,'measurements.json');harness.json(reportFile,{kind:'independent-measurement',now:fixtureModule.NOW,eventCount:events.length,samples,checks});
  check('replay-can-start-and-measure',true,'delivery',{measurementFile:reportFile,eventCount:events.length,postgres:'16.14',rounds:7,source:'full historical HTTP API and PostgreSQL storage'});
  const delivery=path.join(candidate,'DELIVERY.md');check('measurement-report-delivered',fs.existsSync(delivery)&&Boolean(fs.readFileSync(delivery,'utf8').trim()),'delivery',{required:'Nonempty DELIVERY.md; diagnosis, commands, raw measurements, correctness and startup address are reviewed separately'});
  console.log(JSON.stringify({checks,artifacts:run}));outcome=checks.every(c=>c.passed)?0:1;
}catch(error){if(error.candidateFailure){check(error.checkId||'candidate-execution',false,'business',{error:error.message});console.log(JSON.stringify({checks,artifacts:run}));outcome=1;}else{console.log(JSON.stringify({infrastructureError:error.stack||error.message,checks,artifacts:run}));outcome=2;}}
finally{await app?.close().catch(()=>{});await base?.close().catch(()=>{});await db?.close().catch(()=>{});}
process.exit(outcome);
