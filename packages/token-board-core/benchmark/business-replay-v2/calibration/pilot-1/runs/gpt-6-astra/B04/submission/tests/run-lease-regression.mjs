import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'profilepilot-original-tests-'));
const output=path.join(root,'dist');
if(fs.existsSync(output))throw Error('Refusing to overwrite existing dist');
try {
  await build({entryPoints:['agent-browser-lease','process-scan'].map(name=>path.join(root,'src/main',name+'.ts')),outdir:path.join(output,'main'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const result=spawnSync(process.execPath,['--test','tests/agent-browser-lease.test.js'],{cwd:root,encoding:'utf8',env:{...process.env,CPM_DATA_DIR:path.join(scratch,'data'),APPDATA:path.join(scratch,'appdata'),XDG_CONFIG_HOME:path.join(scratch,'config'),HOME:scratch,USERPROFILE:scratch}});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;
}finally{
  fs.rmSync(output,{recursive:true,force:true});
  fs.rmSync(scratch,{recursive:true,force:true});
}
