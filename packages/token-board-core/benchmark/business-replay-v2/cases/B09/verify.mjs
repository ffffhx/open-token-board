import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const candidate = process.argv[2] && path.resolve(process.argv[2]);
const checks = [];
const precisionChecks = [];
const add = (id, passed, category, details) => checks.push({ id, passed: Boolean(passed), category, details });
const read = (dir, file) => readFile(path.join(dir, file));
const hash = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/g, '\n');
// Ignore only line-end whitespace and terminal blank lines. Interior spaces,
// indentation, paragraph boundaries and code-string spaces remain significant.
const substantive = value => normalized(value).replace(/[\t ]+$/gm, '').replace(/\n+$/, '');
const company = '## 二、云杉科技·流舟实习\n';
const project = '## 1. ProfilePilot：真实 Chrome 与 Agent 的浏览器控制面\n';
const nextProject = '## 2. FlowDesk 测试账号切换工具链\n';
function split(text) {
  const intro = /^> 适用场景：[^\n]*\n\n/m.exec(text);
  if (!intro) return null;
  const a = intro.index + intro[0].length;
  const b = text.indexOf(company), c = text.indexOf(project), d = text.indexOf(nextProject);
  if (!(a < b && b < c && c < d) || [company, project, nextProject].some(x => text.indexOf(x) !== text.lastIndexOf(x))) return null;
  return { prefix: text.slice(0, a), opening: text.slice(a, b), bridge: text.slice(b, c), projectHeading: project, body: text.slice(c + project.length, d), suffix: text.slice(d) };
}
async function files(dir, at = '') {
  const result = [];
  for (const entry of await readdir(path.join(dir, at), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const rel = at ? `${at}/${entry.name}` : entry.name;
    if ((await lstat(path.join(dir, rel))).isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${rel}`);
    if (entry.isDirectory()) result.push(...await files(dir, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}
try {
  if (!candidate) throw new Error('Usage: node verify.mjs <candidate>');
  const baseline = path.join(root, 'workspace');
  const oracle = JSON.parse(await read(root, 'oracle.json'));
  const baselineFiles = await files(baseline), candidateFiles = await files(candidate);
  const allowed = new Set([...baselineFiles, 'REPORT.md', 'TASK.txt']);
  const extra = candidateFiles.filter(x => !allowed.has(x));
  add('file-scope', extra.length === 0, 'preservation', { unexpectedFiles: extra });
  const inputChanges = [];
  for (const name of baselineFiles.filter(x => x !== 'handbook.md')) {
    try { if (!(await read(baseline, name)).equals(await read(candidate, name))) inputChanges.push(name); }
    catch { inputChanges.push(name); }
  }
  if (candidateFiles.includes('TASK.txt') && !(await read(candidate, 'TASK.txt')).equals(await read(root, 'prompt.txt'))) inputChanges.push('TASK.txt');
  add('readonly-materials', inputChanges.length === 0, 'preservation', { modifiedOrMissing: inputChanges });
  let bytes = Buffer.alloc(0);
  try { bytes = await read(candidate, 'handbook.md'); } catch { /* task failure */ }
  const text = bytes.toString('utf8');
  const actual = split(normalized(text));
  const initial = split(normalized((await read(baseline, 'handbook.md')).toString('utf8')));
  if (!initial) throw new Error('Invalid baseline document');
  add('document-regions', Boolean(actual), 'preservation', 'Two editable regions and their surrounding protected headings must remain identifiable and unique.');
  add('opening-version', actual && substantive(actual.opening) === substantive(oracle.opening), 'business', 'Opening text and section arrangement must match the historical content; whitespace precision is reported separately.');
  const protectedNames = ['prefix', 'bridge', 'projectHeading', 'suffix'];
  const changedRegions = protectedNames.filter(k => !actual || substantive(actual[k]) !== substantive(initial[k]));
  add('protected-content', changedRegions.length === 0, 'preservation', { changedRegions, explanation: 'Checks actual text and Markdown structure outside both editable regions; a trailing blank line cannot be the only failure.' });
  const body = actual?.body || '';
  add('project-revised', substantive(body) !== substantive(initial.body) && body.trim().length > 0, 'business', 'Project 1 must be edited and nonempty. There is no minimum length; completeness, source support and readability require the structured rubric review.');

  // Only inspect quantitative achievement claims, never generic digits, heading/list numbering or source references.
  const sentences = body.replace(/^#{1,6}[^\n]*$/gm, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').split(/[。！？\n]/).map(x => x.trim()).filter(Boolean);
  const negative = /(?:不|未|没有|缺乏|无法|不能|并非|不代表).{0,18}(?:保证|保障|成功率|故障率|提升|下降|提速|毫秒|秒|瞬|百分|\d+\s*%)/;
  const flagged = sentences.filter(s => !negative.test(s) && (/(?:成功率|故障率|提速|提升|下降|减少|降低).{0,14}\d+(?:\.\d+)?\s*%/.test(s) || /(?:耗时|延迟).{0,12}\d+(?:\.\d+)?\s*(?:毫秒|秒|分钟)/.test(s) || /(?:保障|保证).{0,10}(?:无损|零故障|永不|百分之百)|崩溃.{0,8}瞬(?:间|时).{0,6}回滚/.test(s)));
  checks.push({ id: 'source-claims-review', passed: flagged.length === 0, category: 'business', required: false, details: { flaggedClaims: flagged, explanation: 'Advisory only: numeric claims, quoted examples and negations require contextual review. This heuristic cannot establish an unsupported assertion or block business acceptance.' } });

  let report = '';
  try { report = (await read(candidate, 'REPORT.md')).toString('utf8'); } catch { /* task failure */ }
  add('report-delivered', report.trim().length > 0, 'delivery', 'A nonempty REPORT.md is delivered; its evidence, accuracy and readability are not established by this check and require formal review.');
  precisionChecks.push({ id: 'opening-bytes', passed: Boolean(actual && actual.opening === oracle.opening), category: 'precision', details: 'Exact sanitized LF content including intra-paragraph spacing.' });
  precisionChecks.push({ id: 'protected-bytes', passed: Boolean(actual && protectedNames.every(k => actual[k] === initial[k])), category: 'precision', details: 'Exact protected-region bytes after LF normalization; differences are separate from substantive preservation.' });
  precisionChecks.push({ id: 'utf8-lf', passed: !text.includes('\r') && !text.includes('\uFFFD') && !text.startsWith('\uFEFF'), category: 'precision', details: 'UTF-8 without BOM, replacement characters or CRLF.' });
  const categoryPassed = category => checks.filter(x => x.category === category && x.required !== false).every(x => x.passed);
  const preservationPassed = categoryPassed('preservation');
  const businessPassed = categoryPassed('business') && preservationPassed;
  const deliveryPassed = categoryPassed('delivery');
  const passed = businessPassed && deliveryPassed;
  console.log(JSON.stringify({ passed, businessPassed, preservationPassed, deliveryPassed, checks, precisionChecks, manualReviewRequired: true, reviewStatus: 'pending-semantic-review', reviewPacket: { rubric: 'fact-rubric.json', candidateSha256: hash(bytes), projectBody: body, report, requiredDecisions: ['source-grounding', 'required-fact-coverage', 'readable-project', 'report-chain'], instruction: 'Apply fact-rubric.json criterion by criterion with candidate/source quotations. Machine pass is not full acceptance.' } }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ passed: false, businessPassed: false, checks, error: String(error?.message || error) }, null, 2));
  process.exitCode = 2;
}
