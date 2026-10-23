import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.resolve(process.argv[2]||path.join(os.tmpdir(),'otb-b02-runtime-16.14'));
fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(path.join(cache,'runs'),{recursive:true});
try{
  // Dependency preparation is outside every timed measurement.
  const command=process.platform==='win32'?'pnpm.cmd':'pnpm';
  const install=spawnSync(command,['install','--frozen-lockfile','--ignore-scripts','--registry=https://registry.npmjs.org'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:process.platform==='win32',timeout:180000});
  if(install.status!==0)throw Error('Dependency installation failed: '+(install.stderr||install.stdout).slice(-1500));
  const platform=process.platform==='win32'?'windows-x64':process.platform==='linux'&&process.arch==='x64'?'linux-x64':null;
  if(!platform)throw Error('Replay runtime supports Windows x64 and Linux x64; configure a supported local runtime.');
  const modules=path.join(workspace,'node_modules/.pnpm');const packageDir=fs.readdirSync(modules).find(n=>n===`@embedded-postgres+${platform}@16.14.0-beta.17`);
  if(!packageDir)throw Error('Pinned PostgreSQL platform package is missing');
  const platformRoot=path.join(modules,packageDir,'node_modules/@embedded-postgres',platform);
  const native=path.join(cache,'postgres-16.14');
  if(!fs.existsSync(path.join(native,'.complete'))){fs.cpSync(path.join(platformRoot,'native'),native,{recursive:true});fs.writeFileSync(path.join(native,'.complete'),'16.14.0-beta.17\n');}
  const config={postgresBin:path.join(native,'bin'),runs:path.join(cache,'runs'),postgresPackage:'16.14.0-beta.17',platform,preparedOutsideMeasurement:true};
  fs.writeFileSync(path.join(workspace,'.replay-runtime.json'),JSON.stringify(config,null,2)+'\n');
  console.log(JSON.stringify({prepared:true,workspace,...config}));
}catch(error){console.log(JSON.stringify({infrastructureError:error.message}));process.exitCode=2;}
