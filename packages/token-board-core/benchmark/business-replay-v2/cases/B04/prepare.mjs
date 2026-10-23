import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
try {
  const workspace=path.resolve(process.argv[2]||'');
  if(!process.argv[2]||!fs.existsSync(path.join(workspace,'src/renderer/main.ts')))throw Error('Pass an existing exported workspace');
  let esbuildRequire=require;
  try {require.resolve('esbuild/package.json');}catch{esbuildRequire=createRequire(require.resolve('tsx'));}
  const testRequire=createRequire(require.resolve('@playwright/test'));
  const playwrightRequire=createRequire(testRequire.resolve('playwright'));
  const esbuildPackage=esbuildRequire.resolve('esbuild/package.json');
  const binaryRequire=createRequire(esbuildPackage);
  const dependencies=[
    ['esbuild',esbuildPackage,'0.27.7'],
    [`@esbuild/${process.platform}-${process.arch}`,binaryRequire.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`),'0.27.7'],
    ['@playwright/test',require.resolve('@playwright/test/package.json'),'1.56.1'],
    ['playwright',testRequire.resolve('playwright/package.json'),'1.56.1'],
    ['playwright-core',playwrightRequire.resolve('playwright-core/package.json'),'1.56.1']
  ];
  for(const [name,manifest,version] of dependencies){
    if(JSON.parse(fs.readFileSync(manifest,'utf8')).version!==version)throw Error(`Wrong installed ${name} version`);
    const destination=path.join(workspace,'node_modules',name);fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.cpSync(path.dirname(manifest),destination,{recursive:true});
  }
  const executable=testRequire('playwright').chromium.executablePath();
  if(!fs.existsSync(executable))throw Error('Chromium build 1194 missing; run pnpm exec playwright install chromium with PLAYWRIGHT_BROWSERS_PATH configured');
  const browserCache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.dirname(path.dirname(path.dirname(executable)));
  fs.writeFileSync(path.join(workspace,'ENVIRONMENT.json'),JSON.stringify({schemaVersion:1,nodeMinimum:'22.13',dependencies:Object.fromEntries(dependencies.map(([name,,version])=>[name,version])),playwrightBrowsersPath:browserCache,browserBuild:'1194',purpose:'Only disposable test browser binaries; no user browser profile'},null,2)+'\n');
  console.log(JSON.stringify({prepared:true,dependencies:dependencies.length,browserBuild:'1194',selfTest:'node replay/smoke.mjs'}));
}catch(error){console.log(JSON.stringify({prepared:false,error:error.message}));process.exitCode=2;}
