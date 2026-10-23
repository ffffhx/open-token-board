import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startPreview } from './workspace/services/preview.mjs';
import { getPostBySlug } from './workspace/lib/posts.mjs';

const caseRoot = dirname(fileURLToPath(import.meta.url));
const baseline = join(caseRoot, 'workspace');
const checks = [];
const record = (id, passed, details) => checks.push({ id, passed: Boolean(passed), details });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalize = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function otherRecords(root) {
  const dir = join(root, 'runtime', 'published-content');
  return Object.fromEntries(files(dir).filter((path) => !relative(dir, path).startsWith('release-notes.'))
    .map((path) => [relative(dir, path), digest(readFileSync(path))]).sort(([a], [b]) => a.localeCompare(b)));
}
function runRelease(root, id) {
  const result = spawnSync(process.execPath, ['scripts/release.mjs', 'release-notes'], {
    cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024,
  });
  record(id, result.status === 0, {
    exitCode: result.status, stdout: (result.stdout || '').slice(-2000),
    stderr: (result.stderr || '').slice(-2000), error: result.error?.message,
  });
}
async function http(url, user) {
  const response = await fetch(url, {
    headers: user ? { 'x-local-user': user } : {}, redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, text: await response.text() };
}

let preview;
try {
  if (!process.argv[2]) throw new Error('Usage: node verify.mjs <workspace>');
  const candidate = resolve(process.argv[2]);
  if (!statSync(candidate).isDirectory()) throw new Error('Workspace is not a directory');
  // Never execute or mutate the frozen input directory. Each run gets a new disposable copy.
  const runRoot = mkdtempSync(join(tmpdir(), 'business-pilot-B11-'));
  cpSync(candidate, runRoot, { recursive: true, filter: (path) => {
    const rel = relative(candidate, path);
    return rel !== 'runtime' && !rel.startsWith(`runtime${sep}`) && rel !== '.git' && !rel.startsWith(`.git${sep}`);
  } });
  cpSync(join(baseline, 'runtime'), join(runRoot, 'runtime'), { recursive: true });

  const protectedFiles = ['README.md', 'package.json', ...['source', 'services', 'logs']
    .flatMap((dir) => files(join(baseline, dir)).map((path) => relative(baseline, path)))];
  const modifiedProtected = protectedFiles.filter((path) => !existsSync(join(candidate, path))
    || digest(readFileSync(join(candidate, path))) !== digest(readFileSync(join(baseline, path))));
  record('protected-inputs', modifiedProtected.length === 0, { modified: modifiedProtected });
  const report = join(candidate, 'REPORT.md');
  record('report', existsSync(report) && readFileSync(report, 'utf8').trim().length >= 80,
    'REPORT.md must contain a substantive diagnosis and executed verification; factual quality still needs review.');

  const retainedSlug = `retained-${randomUUID()}`;
  const retainedBody = `This record exists only in the content volume: ${randomUUID()}`;
  writeFileSync(join(runRoot, 'runtime', 'published-content', `${retainedSlug}.json`), JSON.stringify({
    slug: retainedSlug, hidden: true, contentHtml: `<p>${retainedBody}</p>`,
  }));
  writeFileSync(join(runRoot, 'runtime', 'published-content', `${retainedSlug}.html`), `<article>${retainedBody}</article>`);
  const beforeOthers = otherRecords(runRoot);
  const sourceHashes = Object.fromEntries(files(join(runRoot, 'source')).map((path) => [relative(runRoot, path), digest(readFileSync(path))]));
  preview = await startPreview(runRoot);
  const initial = await http(`${preview.api}/api/private-posts/release-notes`, 'author');
  record('fixture-reproduces-stale-content', initial.status === 200 && initial.text.includes('HANDOVER-V1') && !initial.text.includes('HANDOVER-V2'),
    'Initial independent content volume returns V1 while edited source contains V2.');
  const siteResponse = await http(preview.site);
  record('static-http', siteResponse.status === 200 && siteResponse.text.includes('client.mjs'), 'Static server is reachable over HTTP.');

  async function inspect(phase, expected, forbiddenMarkers) {
    const json = await http(`${preview.api}/api/private-posts/release-notes`, 'author');
    let data;
    try { data = JSON.parse(json.text); } catch { data = {}; }
    record(`${phase}-json`, json.status === 200 && data.hidden === true
      && normalize(data.contentHtml || '') === normalize(expected.contentHtml)
      && forbiddenMarkers.every((marker) => !json.text.includes(marker)), {
      httpStatus: json.status, expectedText: normalize(expected.contentHtml), actualText: normalize(data.contentHtml || ''),
    });
    const html = await http(`${preview.api}/api/blog/release-notes`, 'author');
    const article = html.text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
    record(`${phase}-html`, html.status === 200 && normalize(article || '') === normalize(expected.contentHtml)
      && forbiddenMarkers.every((marker) => !html.text.includes(marker)), {
      httpStatus: html.status, expectedText: normalize(expected.contentHtml), actualText: normalize(article || ''),
    });
    const denied = [];
    for (const user of [undefined, 'reader']) {
      for (const route of ['private-posts', 'blog']) {
        const result = await http(`${preview.api}/api/${route}/release-notes`, user);
        denied.push({ user: user || 'anonymous', route, status: result.status, leaked: result.text.includes('HANDOVER-') || result.text.includes('PRIVATE-') });
      }
    }
    record(`${phase}-access-control`, denied.every((result) => result.status === 403 && !result.leaked), denied);
    record(`${phase}-other-posts`, JSON.stringify(beforeOthers) === JSON.stringify(otherRecords(runRoot)),
      'All unrelated published JSON/HTML bytes and content-volume-only records must remain unchanged.');
    const staticLeaks = files(join(runRoot, 'runtime', 'published-static')).filter((path) => {
      const text = readFileSync(path, 'utf8');
      return /HANDOVER-V[12]|PRIVATE-/.test(text) || text.includes(retainedBody);
    }).map((path) => relative(runRoot, path));
    record(`${phase}-static-privacy`, staticLeaks.length === 0, { leakedFiles: staticLeaks });
  }

  runRelease(runRoot, 'current-release-command');
  await inspect('current', getPostBySlug(baseline, 'release-notes'), ['HANDOVER-V1']);
  const firstContent = readFileSync(join(runRoot, 'runtime', 'published-content', 'release-notes.json'));
  runRelease(runRoot, 'repeat-release-command');
  record('repeat-is-idempotent', digest(firstContent) === digest(readFileSync(join(runRoot, 'runtime', 'published-content', 'release-notes.json'))),
    'Publishing the same source twice leaves the JSON content identical.');
  record('source-preserved', Object.entries(sourceHashes).every(([path, hash]) => digest(readFileSync(join(runRoot, path))) === hash),
    'Release must not rewrite the user-authored source.');

  const sourcePath = join(runRoot, 'source', 'release-notes.md');
  const frontmatter = readFileSync(sourcePath, 'utf8').match(/^---\r?\n[\s\S]+?\r?\n---\r?\n/)[0];
  const newMarker = `PRIVATE-${randomUUID()}`;
  writeFileSync(sourcePath, `${frontmatter}\n# 服务交接说明\n\n下一次编辑：${newMarker}。输入包含 <检查> & "结果"，应正常显示。\n`);
  const nextExpected = getPostBySlug(runRoot, 'release-notes');
  runRelease(runRoot, 'new-edit-release-command');
  await inspect('new-edit', nextExpected, ['HANDOVER-V1', 'HANDOVER-V2']);
  const passed = checks.every((check) => check.passed);
  console.log(JSON.stringify({ passed, checks, notes: ['HTTP-level content and authorization verification; full browser interaction is a separate check.', 'Each run uses an isolated temporary copy; input workspaces are unchanged.'] }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, environmentError: String(error.stack || error) }, null, 2));
  process.exitCode = 2;
} finally {
  if (preview) await preview.close();
}
