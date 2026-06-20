// 语义化版本范围匹配。
// 实现 satisfies(version, range)：判断 version 是否落在 range 内。

const NUM = /^(0|[1-9][0-9]*)$/; // 非负整数，禁止前导零（"0" 合法，"01" 非法）

function parseVersion(v) {
  if (typeof v !== "string") throw new TypeError(`version must be a string: ${String(v)}`);
  const parts = v.split(".");
  if (parts.length !== 3) throw new Error(`invalid version: ${v}`);
  const out = [];
  for (const p of parts) {
    if (!NUM.test(p)) throw new Error(`invalid version segment: ${v}`);
    out.push(Number(p));
  }
  return out;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// 把一个 "比较符 + 版本" 子句解析成 { op, ver }。op 仅限 >= <= > < =。
// 比较符与版本之间不允许空白；版本必须合法。
function parseComparator(clause) {
  let op;
  let rest;
  if (clause.startsWith(">=")) {
    op = ">=";
    rest = clause.slice(2);
  } else if (clause.startsWith("<=")) {
    op = "<=";
    rest = clause.slice(2);
  } else if (clause.startsWith(">")) {
    op = ">";
    rest = clause.slice(1);
  } else if (clause.startsWith("<")) {
    op = "<";
    rest = clause.slice(1);
  } else if (clause.startsWith("=")) {
    op = "=";
    rest = clause.slice(1);
  } else {
    throw new Error(`invalid comparator: ${clause}`);
  }
  // 比较符与版本之间不允许空白
  if (/\s/.test(rest) || rest.length === 0) throw new Error(`invalid comparator: ${clause}`);
  return { op, ver: parseVersion(rest) };
}

function testComparator(v, { op, ver }) {
  const c = compare(v, ver);
  switch (op) {
    case ">=": return c >= 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    case "<": return c < 0;
    case "=": return c === 0;
    default: throw new Error(`invalid op: ${op}`);
  }
}

// caret 展开为 [>=lower, <upper]
function caretBounds(ver) {
  const [maj, min, pat] = ver;
  const lower = { op: ">=", ver };
  let upper;
  if (maj > 0) {
    upper = { op: "<", ver: [maj + 1, 0, 0] };
  } else if (min > 0) {
    upper = { op: "<", ver: [0, min + 1, 0] };
  } else {
    // ^0.0.x => >=0.0.x <0.0.(x+1)
    upper = { op: "<", ver: [0, 0, pat + 1] };
  }
  return [lower, upper];
}

// tilde 展开为 [>=lower, <upper]
function tildeBounds(ver) {
  const [maj, min] = ver;
  const lower = { op: ">=", ver };
  const upper = { op: "<", ver: [maj, min + 1, 0] };
  return [lower, upper];
}

export function satisfies(version, range) {
  const v = parseVersion(version);
  if (typeof range !== "string") throw new TypeError(`range must be a string: ${String(range)}`);
  const r = range.trim();
  if (r.length === 0) throw new Error("empty range");

  // caret
  if (r[0] === "^") {
    const ver = parseVersion(r.slice(1));
    return caretBounds(ver).every((cmp) => testComparator(v, cmp));
  }
  // tilde
  if (r[0] === "~") {
    const ver = parseVersion(r.slice(1));
    return tildeBounds(ver).every((cmp) => testComparator(v, cmp));
  }

  // 比较符（可能是空格分隔的 AND），或精确版本
  const hasComparator = /^[<>=]/.test(r);
  if (hasComparator) {
    const clauses = r.split(/\s+/);
    const comps = clauses.map((c) => parseComparator(c));
    return comps.every((cmp) => testComparator(v, cmp));
  }

  // 精确版本：不允许空格组合
  if (/\s/.test(r)) throw new Error(`invalid range: ${range}`);
  const exact = parseVersion(r);
  return compare(v, exact) === 0;
}
