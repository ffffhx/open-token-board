import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
async function listen(server) {
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return `http://127.0.0.1:${server.address().port}`;
}
function close(server) {
  server.closeAllConnections();
  return new Promise((done) => server.close(done));
}

export async function startPreview(root) {
  let site;
  const apiServer = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin === site) {
      res.setHeader('access-control-allow-origin', site);
      res.setHeader('access-control-allow-headers', 'x-local-user');
      res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
    }
    if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/health') { send(res, 200, '{"ok":true}'); return; }
    const match = pathname.match(/^\/api\/(private-posts|blog)\/([a-z0-9-]+)$/);
    if (!match || req.method !== 'GET') { send(res, 404, '{"error":"Not found"}'); return; }
    if (req.headers['x-local-user'] !== 'author') { send(res, 403, '{"error":"Forbidden"}'); return; }
    const ext = match[1] === 'blog' ? 'html' : 'json';
    try {
      const body = await readFile(join(root, 'runtime', 'published-content', `${match[2]}.${ext}`));
      send(res, 200, body, ext === 'html' ? 'text/html; charset=utf-8' : undefined);
    } catch (error) { send(res, error.code === 'ENOENT' ? 404 : 500, '{"error":"Read failed"}'); }
  });
  const api = await listen(apiServer);
  const siteServer = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/environment.js') { send(res, 200, `window.CONTENT_API=${JSON.stringify(api)};`, 'text/javascript'); return; }
    const file = pathname === '/' ? 'index.html' : pathname === '/client.mjs' ? 'client.mjs' : null;
    if (!file) { send(res, 404, 'Not found', 'text/plain'); return; }
    try {
      send(res, 200, await readFile(join(root, 'runtime', 'published-static', file)), file.endsWith('.mjs') ? 'text/javascript' : 'text/html; charset=utf-8');
    } catch { send(res, 500, 'Missing static build', 'text/plain'); }
  });
  try { site = await listen(siteServer); } catch (error) { await close(apiServer); throw error; }
  return { site, api, close: async () => { await Promise.all([close(apiServer), close(siteServer)]); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const preview = await startPreview(process.cwd());
  console.log(JSON.stringify({ site: preview.site, api: preview.api }));
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await preview.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
