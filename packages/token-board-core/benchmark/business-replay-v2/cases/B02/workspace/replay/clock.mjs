import fs from 'node:fs';
import path from 'node:path';
if(process.env.B02_NOW){
  const RealDate=Date, fixed=RealDate.parse(process.env.B02_NOW);
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
}
if(process.env.B02_PROCESS_METRICS){
  process.once('exit',()=>{try{fs.writeFileSync(path.join(process.env.B02_PROCESS_METRICS,`${process.pid}.json`),JSON.stringify({pid:process.pid,ppid:process.ppid,cpu:process.cpuUsage(),resources:process.resourceUsage()}));}catch{}});
}
