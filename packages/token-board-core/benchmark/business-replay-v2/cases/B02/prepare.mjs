import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(dir,'../../../../../..');
const workspace=path.resolve(process.argv[2]);
const cache=path.join(repo,'tests/.tmp/business-replay-v2/B02/runtime');
const result=spawnSync(process.execPath,[path.join(workspace,'replay/bootstrap.mjs'),cache],{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:1000000});
process.stdout.write(result.stdout||JSON.stringify({infrastructureError:result.error?.message||result.stderr||'Bootstrap produced no result'})+'\n');
process.exitCode=result.status??2;
