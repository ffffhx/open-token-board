import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const caseRoot = path.dirname(fileURLToPath(import.meta.url));
const baselineRoot = path.join(caseRoot, 'workspace');
const candidate = process.argv[2] && path.resolve(process.argv[2]);
const checks = [];
const advisoryChecks = [];
const add = (id, passed, details) => checks.push({ id, passed: Boolean(passed), details });
const read = (root, name) => readFile(path.join(root, name));
const markers = ['## 一、整体面试开场白\n', '## 二、云杉科技·流舟实习\n', '## 1. ProfilePilot：真实 Chrome 与 Agent 的浏览器控制面\n', '## 2. FlowDesk 测试账号切换工具链\n'];

function splitDocument(text) {
  const positions = markers.map(marker => text.indexOf(marker));
  if (positions.some((position, index) => position < 0 || (index && position <= positions[index - 1]))) return null;
  if (markers.some(marker => text.indexOf(marker) !== text.lastIndexOf(marker))) return null;
  const [opening, company, project, protectedSection] = positions;
  return {
    prefix: text.slice(0, opening),
    opening: text.slice(opening, company),
    separator: text.slice(company, project),
    project: text.slice(project, protectedSection),
    suffix: text.slice(protectedSection),
  };
}

async function files(root, base = '') {
  const out = [];
  for (const entry of await readdir(path.join(root, base), { withFileTypes: true })) {
    if (entry.name === '.git') continue; // runner may create an isolated Git repository.
    const relative = base ? `${base}/${entry.name}` : entry.name;
    const stat = await lstat(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link in candidate input: ${relative}`);
    if (entry.isDirectory()) out.push(...await files(root, relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

try {
  if (!candidate) throw new Error('Usage: node verify.mjs <workspace>');
  const baselineFiles = await files(baselineRoot);
  const candidateFiles = await files(candidate);
  const allowed = new Set([...baselineFiles, 'REPORT.md', 'TASK.txt']);
  const extra = candidateFiles.filter(name => !allowed.has(name));
  add('file-scope', extra.length === 0, extra.length ? `Unexpected files: ${extra.join(', ')}` : 'Only the supplied files, optional exported TASK.txt and REPORT.md are present.');
  const modifiedInputs = [];
  for (const name of baselineFiles.filter(name => name !== 'handbook.md')) {
    try {
      if (!(await read(baselineRoot, name)).equals(await read(candidate, name))) modifiedInputs.push(name);
    } catch { modifiedInputs.push(name); }
  }
  if (candidateFiles.includes('TASK.txt') && !(await read(candidate, 'TASK.txt')).equals(await read(caseRoot, 'prompt.txt'))) modifiedInputs.push('TASK.txt');
  add('readonly-materials', modifiedInputs.length === 0, modifiedInputs.length ? `Modified/missing inputs: ${modifiedInputs.join(', ')}` : 'All history and source files are byte-identical to the supplied inputs.');

  let document;
  try { document = (await read(candidate, 'handbook.md')).toString('utf8'); }
  catch { document = ''; }
  const actual = splitDocument(document);
  const initial = splitDocument((await read(baselineRoot, 'handbook.md')).toString('utf8'));
  const saved = splitDocument((await read(baselineRoot, '.history/read-02.md')).toString('utf8'));
  if (!initial || !saved) throw new Error('Invalid canonical fixture structure.');
  add('document-structure', actual !== null, 'All required section headings must remain unique and ordered.');
  add('saved-opening', actual && actual.opening === saved.opening, 'Opening must exactly match the pre-edit saved-text evidence, including spacing and LF newlines.');
  add('protected-content', actual && actual.prefix === initial.prefix && actual.separator === initial.separator && actual.suffix === initial.suffix, 'All content outside the opening and project 1 must be byte-identical to the supplied working copy.');

  const project = actual?.project || '';
  add('project-updated', actual && project !== initial.project && project.replace(/^#{1,6} .*$/gm, '').trim().length > 0, 'Project 1 must contain a substantive edit; source accuracy is reviewed by a person.');
  const body = project.replace(/^#{1,6} .*$/gm, '').replace(/^\s*\d+[.)、]\s+/gm, '');
  const factGroups = {
    background: /登录(?:态|状态)/.test(body) && /支付|付款/.test(body) && /人工|开发者|人机/.test(body),
    conflict: /焦点|窗口/.test(body) && /争|抢|冲突/.test(body),
    allocation: /Gateway/i.test(body) && /Profile/i.test(body) && /租约/.test(body) && /分配|空闲/.test(body),
    communication: ['Wrapper', 'Daemon', 'WebSocket', 'CDP', 'Ticket'].every(term => new RegExp(term, 'i').test(body)) && /一次性/.test(body) && /管道|pipe/i.test(body) && /校验|验证|检查/.test(body),
    takeover: /控制条/.test(body) && /暂停/.test(body) && /接管/.test(body) && /恢复|继续/.test(body),
    result: /日常/.test(body) && /并行|并发/.test(body) && /(?:2|两|二)\s*(?:个)?\s*独立(?:的)?\s*(?:Agent\s*浏览器\s*)?Session/i.test(body),
  };
  const missing = Object.entries(factGroups).filter(([, value]) => !value).map(([key]) => key);
  advisoryChecks.push({ id: 'project-source-coverage', passed: missing.length === 0, details: missing.length ? `Missing fact signals: ${missing.join(', ')}. This is an advisory heuristic; wording can differ and must be reviewed semantically.` : 'Required source mechanisms and business fact signals are represented; human semantic review is still required.' });
  const numbers = body.match(/\d+(?:\.\d+)?/g) || [];
  const unsupported = numbers.filter(number => !['2', '5'].includes(number));
  add('project-source-numbers', unsupported.length === 0, unsupported.length ? `Numbers absent from the supplied source: ${[...new Set(unsupported)].join(', ')}` : 'Numeric facts are limited to those in the source (5 surveyed tools, 2 daily sessions); meaning still requires review.');
  const absoluteClaim = /100\s*%|百分之百|零故障|保证.{0,8}(?:成功|无损)|崩溃.{0,6}瞬间|永不.{0,6}(?:失败|冲突)/;
  const overclaims = body.split(/[。！？\n]/).some(sentence => absoluteClaim.test(sentence) && !/(?:不|未|没有|缺乏|无法|不能|并非).{0,18}(?:100\s*%|百分之百|零故障|保证|崩溃|永不)/.test(sentence));
  add('unsupported-guarantees', !overclaims, 'Known unsupported absolute-result phrases must not be stated as project achievements.');

  const links = [...document.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
  const linkErrors = [];
  for (const link of links) {
    if (/^(?:https?:|#)/.test(link)) continue;
    const target = path.resolve(candidate, link.split('#')[0]);
    if (!target.startsWith(candidate + path.sep)) { linkErrors.push(link); continue; }
    try { if (!(await lstat(target)).isFile()) linkErrors.push(link); }
    catch { linkErrors.push(link); }
  }
  add('source-link', links.includes('references/project-notes.md') && linkErrors.length === 0, linkErrors.length ? `Broken/outside links: ${linkErrors.join(', ')}` : 'Project notes have a valid relative link.');

  let report = '';
  try { report = (await read(candidate, 'REPORT.md')).toString('utf8'); } catch { /* missing report is a task failure */ }
  const citesSnapshot = /(?:\.history\/read-02\.md|E02)/.test(report);
  const citesTime = /13:35:22(?:\.812)?|21:35:22(?:\.812)?/.test(report);
  add('report-evidence', report.length >= 40 && citesSnapshot && citesTime, 'REPORT.md must identify the adopted snapshot/event and its recorded time; factual accuracy requires reviewer inspection.');
  const passed = checks.every(check => check.passed);
  console.log(JSON.stringify({ passed, checks, advisoryChecks, manualReviewRequired: true }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, error: String(error?.message || error) }, null, 2));
  process.exitCode = 2;
}
