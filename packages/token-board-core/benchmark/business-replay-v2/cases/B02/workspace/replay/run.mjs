import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {fixture,NOW} from './fixture.mjs';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function businessDigest(value){const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
export const json=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
export async function freePort(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
export function cleanEnv(){const env={...process.env};for(const k of Object.keys(env))if(/^(TOKEN_BOARD_|DATABASE_URL$|PG[A-Z]|SNAPSHOT_SHARE_|FEISHU_|KIMI_|OPENAI_|B02_)/.test(k))delete env[k];return env;}
export async function database(runtime,dir){
  const require=createRequire(path.join(root,'package.json'));const {Client}=require('pg');
  const port=await freePort(),data=path.join(dir,'data');fs.mkdirSync(dir,{recursive:true});
  const ext=process.platform==='win32'?'.exe':'';const bin=name=>path.join(runtime.postgresBin,name+ext);
  const invoke=(name,args)=>{const result=spawnSync(bin(name),args,{windowsHide:true,stdio:'ignore',timeout:120000,env:cleanEnv()});if(result.status!==0)throw Error(`PostgreSQL ${name} failed (${result.status}): ${result.error?.message||'see '+dir}`);};
  invoke('initdb',['-D',data,'-U','replay','--auth=trust','--encoding=UTF8','--locale=C','--no-sync']);
  invoke('pg_ctl',['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=30 -c shared_buffers=32MB -c fsync=off -c synchronous_commit=off`,'-w','start']);
  const url=`postgresql://replay@127.0.0.1:${port}/postgres`;
  const admin=new Client({connectionString:url});await admin.connect();
  return {url,admin,async close(){await admin.end();invoke('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}};
}
export async function seed(workspace,url,schema,events){
  const {createTokenUsageStore}=await import(pathToFileURL(path.join(workspace,'packages/token-board-core/src/token-board-storage.ts')));
  const store=await createTokenUsageStore({databaseUrl:url,postgresSchema:schema,dataFile:'unused'});
  try{await store.insertEvents(events);}finally{await store.close?.();}
}
export async function service(workspace,url,schema,dir){
  fs.mkdirSync(dir,{recursive:true});const metricsDir=path.join(dir,'process-metrics');fs.mkdirSync(metricsDir,{recursive:true});
  const port=await freePort();const base=`http://127.0.0.1:${port}`;
  const env={...cleanEnv(),TOKEN_BOARD_PORT:String(port),TOKEN_BOARD_HOST:'127.0.0.1',TOKEN_BOARD_DATABASE_URL:url,TOKEN_BOARD_POSTGRES_SCHEMA:schema,TOKEN_BOARD_DATA_FILE:path.join(dir,'usage.json'),TOKEN_BOARD_USERS_FILE:path.join(dir,'users.json'),TOKEN_BOARD_LEADERBOARD_SNAPSHOT_FILE:path.join(dir,'snapshots.json'),TOKEN_BOARD_AGENT_SPEED_DATA_FILE:path.join(dir,'speed.json'),SNAPSHOT_SHARE_DATA_FILE:path.join(dir,'shares.json'),TOKEN_BOARD_AUTH_SECRET:'synthetic-replay-only-auth-secret',TOKEN_BOARD_FEISHU_WEBHOOK_URL:'',TOKEN_BOARD_DAILY_REPORT_ENABLED:'false',TOKEN_BOARD_WEEKLY_REPORT_ENABLED:'false',TOKEN_BOARD_LEADERBOARD_SNAPSHOT_REFRESH_MS:'86400000',B02_NOW:NOW,B02_REPLAY_CONTROL:'1',B02_PROCESS_METRICS:metricsDir,TZ:'Asia/Shanghai'};
  env.NODE_OPTIONS=`--import=${pathToFileURL(path.join(workspace,'replay/clock.mjs')).href}`;
  const child=spawn(process.execPath,['--import','tsx','apps/token-board-api/src/server.ts'],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let log='',seq=0;const pending=new Map();
  child.stdout.on('data',x=>{log+=x;});child.stderr.on('data',x=>{log+=x;});
  child.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
  child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Service exited: '+log.slice(-2000)));}pending.clear();});
  const command=operation=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Service ${operation} timed out`));},120000);pending.set(id,{resolve,reject,timer});child.send({id,operation},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
  try{
    for(let i=0;;i++){if(child.exitCode!==null)throw Error('Service startup failed: '+log.slice(-2000));try{const r=await fetch(base+'/api/usage/health',{signal:AbortSignal.timeout(1000)});if(r.ok)break;}catch{}if(i>=120)throw Error('Service readiness timeout: '+log.slice(-2000));await delay(100);}
    await command('refresh');
  }catch(error){child.kill();throw error;}
  return {base,command,child,dir,async close(){fs.writeFileSync(path.join(dir,'service.log'),log);child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),delay(3000)]);}};
}
export async function measure(app){
  const reads=[];let running=true;
  const load=(async()=>{while(running){const start=performance.now();try{const response=await fetch(app.base+'/api/usage/leaderboard?range=today&metric=tokens',{signal:AbortSignal.timeout(30000)});const body=await response.json();reads.push({ms:performance.now()-start,status:response.status,source:body.source,generatedAt:body.generatedAt,summarySha256:businessDigest(body.summary)});}catch(e){reads.push({ms:performance.now()-start,status:0,error:e.message});}await delay(15);}})();
  const started=performance.now();let details,elapsedMs;
  try{details=await app.command('refresh');elapsedMs=performance.now()-started;}finally{running=false;await load;}
  return {...details,apiReportedDurationMs:details.durationMs,durationMs:elapsedMs,reads};
}

async function main(){
  const mode=process.argv[2]||'measure';const runtime=JSON.parse(fs.readFileSync(path.join(root,'.replay-runtime.json'),'utf8'));
  const runDir=fs.mkdtempSync(path.join(runtime.runs,'run-'));const db=await database(runtime,path.join(runDir,'db'));let app;
  try{
    const events=fixture();await seed(root,db.url,'replay',events);app=await service(root,db.url,'replay',path.join(runDir,'api'));
    if(mode==='serve'){console.log(JSON.stringify({url:app.base,dataDirectory:runDir,events:events.length}));await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
    else{const samples=[];await measure(app);for(let i=0;i<7;i++)samples.push(await measure(app));const result={now:NOW,events:events.length,samples,entries:(await app.command('state')).entries};const file=path.join(root,'artifacts','measurement.json');json(file,result);console.log(JSON.stringify({file,rawSamplesMs:samples.map(s=>s.durationMs),events:events.length}));}
  }finally{await app?.close();await db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({infrastructureError:error.message}));process.exitCode=2;});
