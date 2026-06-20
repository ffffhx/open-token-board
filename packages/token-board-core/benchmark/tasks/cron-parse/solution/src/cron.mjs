/**
 * 5 字段 cron 表达式的下一次触发时间计算（UTC）。
 *
 * nextRun(expr, fromEpochSec):
 *   返回严格大于 fromEpochSec、且 seconds=0 的下一个匹配 UTC 时刻（epoch 秒）。
 *
 * 字段顺序：min hour dom month dow
 * 取值范围：min 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-6 (0=Sunday)。
 * 字段语法：'*'、单值、范围 a-b、步长 '*' + /n 与 a-b + /n、逗号列表 a,b,c。
 * dom/dow 规则：当 dom 与 dow 都被限制（都不是 '*'）时，某天匹配 = dom 匹配 或 dow 匹配；
 * 否则两者都需匹配。
 * 非法表达式或越界值抛异常。
 */

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dow", min: 0, max: 6 },
];

function err(msg) {
  throw new Error(`cron parse error: ${msg}`);
}

// 解析一个整数 token，必须是无符号十进制（无 +、无前导符号、无小数）。
function parseInt10(s) {
  if (typeof s !== "string" || s.length === 0) err(`empty number`);
  if (!/^[0-9]+$/.test(s)) err(`invalid number "${s}"`);
  // 去掉前导 0 之后仍是合法数字；Number 解析安全（cron 范围很小）
  const v = Number(s);
  if (!Number.isSafeInteger(v)) err(`number out of range "${s}"`);
  return v;
}

// 解析单个字段为一个 boolean 数组 allowed[min..max]（以 min 为下标 0）。
function parseField(raw, field) {
  if (typeof raw !== "string") err(`field ${field.name} not a string`);
  if (raw.length === 0) err(`field ${field.name} empty`);
  const span = field.max - field.min + 1;
  const allowed = new Array(span).fill(false);

  const setRange = (lo, hi, step) => {
    if (step <= 0 || !Number.isInteger(step)) err(`bad step in ${field.name}`);
    if (lo < field.min || lo > field.max) err(`value ${lo} out of range in ${field.name}`);
    if (hi < field.min || hi > field.max) err(`value ${hi} out of range in ${field.name}`);
    if (lo > hi) err(`range ${lo}-${hi} reversed in ${field.name}`);
    for (let v = lo; v <= hi; v += step) allowed[v - field.min] = true;
  };

  const parts = raw.split(",");
  for (const part of parts) {
    if (part.length === 0) err(`empty list item in ${field.name}`);

    // 拆出可选的步长
    let body = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      body = part.slice(0, slash);
      const stepStr = part.slice(slash + 1);
      if (part.indexOf("/", slash + 1) !== -1) err(`multiple "/" in ${field.name}`);
      step = parseInt10(stepStr);
      if (step <= 0) err(`step must be positive in ${field.name}`);
      if (body.length === 0) err(`empty before "/" in ${field.name}`);
    }

    if (body === "*") {
      setRange(field.min, field.max, step);
      continue;
    }

    const dash = body.indexOf("-");
    if (dash !== -1) {
      if (body.indexOf("-", dash + 1) !== -1) err(`multiple "-" in ${field.name}`);
      const loStr = body.slice(0, dash);
      const hiStr = body.slice(dash + 1);
      const lo = parseInt10(loStr);
      const hi = parseInt10(hiStr);
      setRange(lo, hi, step);
      continue;
    }

    // 单值
    const v = parseInt10(body);
    if (v < field.min || v > field.max) err(`value ${v} out of range in ${field.name}`);
    if (slash !== -1) {
      // a/n 形式：等价于 a-max/n
      setRange(v, field.max, step);
    } else {
      allowed[v - field.min] = true;
    }
  }

  return allowed;
}

function parseExpr(expr) {
  if (typeof expr !== "string") err(`expr not a string`);
  const trimmed = expr.trim();
  if (trimmed.length === 0) err(`empty expr`);
  // 以任意空白分隔，且不允许出现非预期数量的字段
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 5) err(`expected 5 fields, got ${tokens.length}`);

  const minute = parseField(tokens[0], FIELDS[0]);
  const hour = parseField(tokens[1], FIELDS[1]);
  const dom = parseField(tokens[2], FIELDS[2]);
  const month = parseField(tokens[3], FIELDS[3]);
  const dow = parseField(tokens[4], FIELDS[4]);

  const domRestricted = tokens[2] !== "*";
  const dowRestricted = tokens[4] !== "*";

  return { minute, hour, dom, month, dow, domRestricted, dowRestricted };
}

// 判断给定 UTC 日期是否日匹配（按 cron 的 dom/dow OR 规则）。
function dayMatches(spec, year, month1, day) {
  const domOk = spec.dom[day - 1]; // dom 下标 = day - 1（min=1）
  // 计算星期：使用 UTC
  const dow = new Date(Date.UTC(year, month1 - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const dowOk = spec.dow[dow]; // dow min=0
  if (spec.domRestricted && spec.dowRestricted) {
    return domOk || dowOk;
  }
  // 否则两者都需匹配（未限制的一方其 allowed 全为 true）
  return domOk && dowOk;
}

export function nextRun(expr, fromEpochSec) {
  const spec = parseExpr(expr);

  if (typeof fromEpochSec !== "number" || !Number.isFinite(fromEpochSec)) {
    err(`fromEpochSec must be a finite number`);
  }

  // 从 fromEpochSec 的下一分钟开始（严格大于，且 seconds=0）。
  // 先归一到不晚于 from 的整分钟，再 +60。
  let t = Math.floor(fromEpochSec / 60) * 60 + 60;

  // 上限：搜索范围给足（cron 最长间隔不超过几年）。8 年的分钟数。
  const MAX_MINUTES = 8 * 366 * 24 * 60;
  for (let i = 0; i < MAX_MINUTES; i++) {
    const d = new Date(t * 1000);
    const year = d.getUTCFullYear();
    const month1 = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();

    if (!spec.month[month1 - 1]) {
      // 跳到下个月 1 号 00:00
      const ny = month1 === 12 ? year + 1 : year;
      const nm = month1 === 12 ? 1 : month1 + 1;
      t = Math.floor(Date.UTC(ny, nm - 1, 1, 0, 0, 0) / 1000);
      continue;
    }

    if (!dayMatches(spec, year, month1, day)) {
      // 跳到次日 00:00
      t = Math.floor(Date.UTC(year, month1 - 1, day + 1, 0, 0, 0) / 1000);
      continue;
    }

    if (!spec.hour[hh]) {
      // 跳到下个小时整点
      t += (60 - mm) * 60; // 到下一个整点；mm 在 0..59
      // 注意：若 mm=0 上面会 +3600，正确（当前小时 hour 不匹配，前进到下一小时）
      continue;
    }

    if (!spec.minute[mm]) {
      t += 60;
      continue;
    }

    return t;
  }

  err(`no matching time found within search window`);
}
