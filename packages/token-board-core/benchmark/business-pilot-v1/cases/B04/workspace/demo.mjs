import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { catalogFixture } from './catalog-fixture.mjs';
import { createDom } from './node-dom.mjs';

const source = await readFile(new URL('./src/profile-catalog.mjs', import.meta.url), 'utf8');
const fixture = catalogFixture(source);
fixture.registry([{ id: 'demo', name: 'Fixture Work', dirName: 'demo', fixedCdpPort: 19401 }]);
const candidates = fixture.api.findAvailableAgentBrowserProfileCandidatesSync({ excludedPort: 19400, requestedSession: 'demo' }, fixture.home, fixture.now);
if (process.argv.includes('--once')) {
  const dom = createDom();
  Object.assign(globalThis, { document: dom.document, window: dom.window, FormData: dom.FormData });
  const ui = await import('./src/fixture-ui.mjs');
  const { render } = await import('./src/render-root.mjs');
  const state = { profiles: [{ id: 'demo', name: 'Before' }], runningProfiles: [], externalInstances: [] };
  ui.configureUi(dom.root, { getState: async () => structuredClone(state) }, structuredClone(state));
  ui.store.modal = { kind: 'rename', profileId: 'demo' }; render();
  dom.root.querySelector('#profile-rename').value = 'After user input';
  ui.store.busy = true; ui.store.busyState = { key: 'rename-profile', profileId: 'demo', message: 'saving' }; render();
  console.log(JSON.stringify({ draftAfterBusyRender: dom.root.querySelector('#profile-rename').value, availableProfilesWithoutSnapshot: candidates }, null, 2));
} else {
  const page = `<!doctype html><meta charset="utf-8"><title>B04 isolated fixture</title>
    <style>body{font:16px system-ui;max-width:900px;margin:30px auto;background:#152020;color:white}button,input{padding:8px;margin:6px}a{color:#7de5af}.modal-backdrop{border:1px solid #668;padding:20px}li{margin:10px}#fixture-controls{position:sticky;top:0;background:#273;padding:12px}</style>
    <h1>Profile fixture · no real browser profiles</h1><p>Registry candidates: ${candidates.map(p => p.profileName).join(', ') || '(empty)'}</p>
    <div id="fixture-controls"><button id="tick">模拟状态刷新</button><button id="fail">下次保存失败</button><button id="restart">模拟重启</button></div><div id="app"></div>
    <script type="module">
      import * as ui from './src/fixture-ui.mjs'; import {render} from './src/render-root.mjs';
      let persisted={profiles:[{id:'demo',name:'Before'},{id:'other',name:'Other profile'}],runningProfiles:[],externalInstances:[]}; let fail=false;
      const api={getState:async()=>structuredClone(persisted),renameProfile:async(id,name)=>{await new Promise(r=>setTimeout(r,800));if(fail){fail=false;throw Error('Fixture save failed');}persisted.profiles.find(p=>p.id===id).name=name;return structuredClone(persisted);}};
      ui.configureUi(document.querySelector('#app'),api,structuredClone(persisted));
      document.addEventListener('click',e=>{const edit=e.target.closest('[data-edit]');if(edit){ui.store.modal={kind:'rename',profileId:edit.dataset.edit};render();}if(e.target.dataset.action==='close-modal'&&(e.target.tagName==='BUTTON'||!e.target.closest('form'))){ui.store.modal=null;render();}});
      document.addEventListener('submit',e=>{if(e.target.matches('[data-rename-form]')){e.preventDefault();ui.submitRename(e.target);}});
      document.querySelector('#tick').onclick=()=>{ui.store.startupSettings={supported:true,enabled:!ui.store.startupSettings?.enabled};render();};
      document.querySelector('#fail').onclick=()=>{fail=true;};
      document.querySelector('#restart').onclick=()=>{ui.configureUi(document.querySelector('#app'),api,structuredClone(persisted));};
    </script>`;
  const allowed = new Set(['/src/render-root.mjs', '/src/fixture-ui.mjs']);
  const server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); return; }
    if (!allowed.has(req.url)) { res.writeHead(404).end(); return; }
    try { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(await readFile(new URL('.' + req.url, import.meta.url))); }
    catch { res.writeHead(500).end('Fixture error'); }
  });
  server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`B04 fixture: http://127.0.0.1:${server.address().port}/`));
}
