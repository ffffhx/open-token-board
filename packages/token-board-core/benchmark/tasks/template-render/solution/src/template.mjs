// 迷你模板引擎。render(tpl, data) -> string
//
// 语法：
//   {{path.to.value}}   插值，HTML 转义
//   {{{path.to.value}}} 原样插值，不转义
//   {{#if path}}...{{/if}}        path 为真值时渲染内部
//   {{#each path}}...{{/each}}    遍历数组，{{.}} 当前项，{{@index}} 下标
//   {{.}} / {{.field}}           相对当前上下文（each 内为当前项）
//   {{@index}}                   each 内当前下标
//
// 详见任务说明。语法非法（未闭合 / 标签不匹配）时抛错。

const TOKEN_RE = /\{\{\{\s*([^{}]*?)\s*\}\}\}|\{\{\s*([^{}]*?)\s*\}\}\}?/g;

// 把模板解析成 token 列表。
function tokenize(tpl) {
  const tokens = [];
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(tpl)) !== null) {
    if (m.index > last) {
      tokens.push({ type: "text", value: tpl.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      // triple-stache: {{{ ... }}}
      tokens.push({ type: "raw", path: m[1].trim() });
    } else {
      const inner = m[2].trim();
      if (inner.startsWith("#if")) {
        tokens.push({ type: "if", path: inner.slice(3).trim() });
      } else if (inner.startsWith("#each")) {
        tokens.push({ type: "each", path: inner.slice(5).trim() });
      } else if (inner === "/if") {
        tokens.push({ type: "/if" });
      } else if (inner === "/each") {
        tokens.push({ type: "/each" });
      } else {
        tokens.push({ type: "var", path: inner });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < tpl.length) tokens.push({ type: "text", value: tpl.slice(last) });
  return tokens;
}

// 把 token 列表构造成 AST（处理嵌套与匹配校验）。
function parse(tokens) {
  let i = 0;
  function parseBlock(stopTypes) {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === "/if" || t.type === "/each") {
        if (stopTypes.includes(t.type)) return nodes;
        throw new Error(`unexpected closing tag ${t.type}`);
      }
      if (t.type === "if") {
        i++;
        const body = parseBlock(["/if"]);
        if (i >= tokens.length || tokens[i].type !== "/if") {
          throw new Error("unclosed #if");
        }
        i++; // consume /if
        nodes.push({ type: "if", path: t.path, body });
        continue;
      }
      if (t.type === "each") {
        i++;
        const body = parseBlock(["/each"]);
        if (i >= tokens.length || tokens[i].type !== "/each") {
          throw new Error("unclosed #each");
        }
        i++; // consume /each
        nodes.push({ type: "each", path: t.path, body });
        continue;
      }
      nodes.push(t);
      i++;
    }
    return nodes;
  }
  const ast = parseBlock([]);
  if (i < tokens.length) throw new Error("trailing tokens after parse");
  return ast;
}

function escapeHtml(s) {
  let out = "";
  for (const ch of s) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else out += ch;
  }
  return out;
}

// 把任意值转换成插值用字符串。null / undefined -> ""。
function stringify(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isNaN(v) ? "" : String(v);
  if (typeof v === "boolean") return String(v);
  return String(v);
}

// 在 ctx（当前上下文）中解析 path。返回 undefined 表示缺失。
function resolve(path, ctx, scope) {
  if (path === "@index") return scope.index;
  if (path === ".") return ctx;
  if (path === "") return undefined; // 空插值 {{}} => 空串
  let rest = path;
  if (rest.startsWith(".")) {
    // 相对当前上下文，如 ".field.x"
    rest = rest.slice(1);
    if (rest === "") return undefined;
  }
  const keys = rest.split(".");
  let cur = ctx;
  for (const key of keys) {
    if (key === "") return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object" && typeof cur !== "string") return undefined;
    cur = cur[key];
  }
  return cur;
}

// if 的真值判定：falsy（false/null/undefined/0/NaN/""）或空数组 => false。
function isTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function renderNodes(nodes, ctx, scope) {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "var":
        out += escapeHtml(stringify(resolve(node.path, ctx, scope)));
        break;
      case "raw":
        out += stringify(resolve(node.path, ctx, scope));
        break;
      case "if": {
        const v = resolve(node.path, ctx, scope);
        if (isTruthy(v)) out += renderNodes(node.body, ctx, scope);
        break;
      }
      case "each": {
        const v = resolve(node.path, ctx, scope);
        if (Array.isArray(v)) {
          for (let idx = 0; idx < v.length; idx++) {
            out += renderNodes(node.body, v[idx], { index: idx });
          }
        }
        break;
      }
      default:
        throw new Error(`unknown node ${node.type}`);
    }
  }
  return out;
}

export function render(tpl, data) {
  if (typeof tpl !== "string") throw new Error("template must be a string");
  const tokens = tokenize(tpl);
  const ast = parse(tokens);
  return renderNodes(ast, data, { index: undefined });
}
