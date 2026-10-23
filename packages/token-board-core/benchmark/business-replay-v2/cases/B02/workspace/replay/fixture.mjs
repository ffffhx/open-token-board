export const NOW = '2026-09-14T12:00:00.000Z';
export const RANGES = ['today','1D','7D','30D','90D','week','month','lastweek','lastmonth'];
export const METRICS = ['tokens','cost','sessions','messages','users','lines'];
// Synthetic identities only. Each input is deterministic and independently regenerable.
export function fixture({days=120,users=12,perDay=3,seed=90214}={}) {
  let state=seed>>>0; const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  const events=[];
  for(let d=0;d<days;d++)for(let u=0;u<users;u++)for(let j=0;j<perDay;j++) {
    if(u===users-1&&d<34)continue; // previous-only member
    if(u===users-2&&d>12)continue; // recently joined member
    const input=100+rand()%8000, output=20+rand()%800, cached=rand()%3000, creation=rand()%900;
    const timestamp=new Date(Date.parse(NOW)-d*86400000-j*3600000-u*1000).toISOString();
    events.push({id:`synthetic-${seed}-${d}-${u}-${j}`,userId:`github:synthetic-${u}`,displayName:`Synthetic ${String(u).padStart(2,'0')}`,team:`Team ${u%3}`,source:j%2?'codex':'claude-code',tool:j%2?'Codex CLI':'Claude Code',model:['gpt-5-codex','claude-sonnet-4.5','claude-haiku-3.5'][j%3],project:`project-${u%4}`,timestamp,inputTokens:input,cacheCreationInputTokens:creation,cachedInputTokens:cached,outputTokens:output,reasoningOutputTokens:rand()%100,totalTokens:input+output+cached+creation,costUsd:(1+rand()%500)/1024,messages:1+rand()%15,sessionId:`session-${u}-${Math.floor(d/2)}-${j%2}`,errorCount:j?rand()%3:null,interruptedCount:0,toolCallCount:10+rand()%40,linesWritten:u%3===0?null:rand()%80});
  }
  const base=events[0];
  for(const [i,time] of ['2026-09-13T15:59:59.999Z','2026-09-13T16:00:00.000Z','2026-08-31T15:59:59.999Z','2026-08-31T16:00:00.000Z','2026-09-06T15:59:59.999Z','2026-09-06T16:00:00.000Z'].entries())events.push({...base,id:`boundary-${i}`,timestamp:time,sessionId:`boundary-${i}`});
  for(const u of ['tie-a','tie-b'])events.push({...base,id:u,userId:u,displayName:u,sessionId:u,linesWritten:null});
  return events;
}
