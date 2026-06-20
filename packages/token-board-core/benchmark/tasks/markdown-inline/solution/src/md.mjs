/**
 * 行内 Markdown -> HTML。
 *
 * 具名导出 renderInline(md)。语义见任务说明（meta.prompt）。
 *
 * 设计：单次线性扫描，自左向右逐字符消费，遇到结构性标记时向右探测其配对：
 *   - 反斜杠转义优先级最高（在任何标记判定之前处理）。
 *   - 代码段 `code`：单反引号定界，内部不解析 markdown / 不处理反斜杠，仅 HTML 转义；
 *     无闭合反引号则该反引号按字面量处理。
 *   - 链接 [text](url)：text 递归按行内解析，url 做 URL 转义；语法不完整则 '[' 字面量。
 *   - 强调 ** / __ -> strong，* / _ -> em；探测不到配对则该标记按字面量处理。
 *   - 其余字符作为纯文本，& < > 做 HTML 转义（& 先转）。
 */

const ESCAPABLE = new Set(["*", "_", "`", "[", "]", "\\", "(", ")"]);

function escapeHtml(s) {
  // 必须先替换 &，否则会把后续 &lt; 里的 & 再次转义。
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else out += ch;
  }
  return out;
}

function escapeUrl(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else out += ch;
  }
  return out;
}

export function renderInline(md) {
  if (typeof md !== "string") {
    throw new TypeError("renderInline expects a string");
  }
  return renderRange(md, 0, md.length);
}

// 渲染 src[start, end) 这一段（用于链接 text 的递归渲染）。
function renderRange(src, start, end) {
  let out = "";
  let i = start;

  while (i < end) {
    const ch = src[i];

    // 1) 反斜杠转义（最高优先级）
    if (ch === "\\") {
      const next = src[i + 1];
      if (next !== undefined && i + 1 < end && ESCAPABLE.has(next)) {
        out += escapeHtml(next); // 转义后的字符按字面量（仍需 HTML 转义 & < >，本集合不含但保持一致）
        i += 2;
        continue;
      }
      // 反斜杠后不是可转义字符：反斜杠本身为字面量
      out += "\\";
      i += 1;
      continue;
    }

    // 2) 代码段
    if (ch === "`") {
      let j = i + 1;
      while (j < end && src[j] !== "`") j++;
      if (j < end) {
        // 找到闭合反引号 [i+1, j)
        out += "<code>" + escapeHtml(src.slice(i + 1, j)) + "</code>";
        i = j + 1;
        continue;
      }
      // 无闭合：字面量反引号
      out += "`";
      i += 1;
      continue;
    }

    // 3) 链接
    if (ch === "[") {
      const link = parseLink(src, i, end);
      if (link) {
        const inner = renderRange(src, link.textStart, link.textEnd);
        out += `<a href="${escapeUrl(link.url)}">${inner}</a>`;
        i = link.next;
        continue;
      }
      out += "[";
      i += 1;
      continue;
    }

    // 4) 强调
    if (ch === "*" || ch === "_") {
      const isDouble = src[i + 1] === ch && i + 1 < end;
      const markLen = isDouble ? 2 : 1;
      const tag = isDouble ? "strong" : "em";
      const closeIdx = findEmphasisClose(src, i + markLen, end, ch, markLen);
      if (closeIdx !== -1) {
        const inner = renderRange(src, i + markLen, closeIdx);
        out += `<${tag}>${inner}</${tag}>`;
        i = closeIdx + markLen;
        continue;
      }
      // 找不到配对：该标记按字面量
      out += escapeHtml(ch.repeat(markLen));
      i += markLen;
      continue;
    }

    // 5) 纯文本
    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

// 从 from 起，在 [from, end) 内寻找与开标记匹配的闭合 emphasis 位置。
// 必须跳过：反斜杠转义、代码段（其中的 * _ 不算标记）。
// 返回闭合标记的起始下标；找不到返回 -1。
function findEmphasisClose(src, from, end, ch, markLen) {
  let i = from;
  while (i < end) {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      if (next !== undefined && i + 1 < end && ESCAPABLE.has(next)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "`") {
      // 跳过代码段（含其闭合反引号）；若无闭合则当作普通字符前进
      let j = i + 1;
      while (j < end && src[j] !== "`") j++;
      if (j < end) {
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === ch) {
      // 候选闭合标记
      const candDouble = src[i + 1] === ch && i + 1 < end;
      if (markLen === 2) {
        if (candDouble) return i; // ** 配 **
        // 单个 ch 不能闭合 ** —— 跳过这一个继续找
        i += 1;
        continue;
      } else {
        // markLen === 1：单标记。闭合处不能紧接着同字符构成更长串的一部分吗？
        // 取第一个出现的同字符即可作为单标记闭合。
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

// 解析 [text](url)，要求紧随 ] 之后是 (。返回
//   { textStart, textEnd, url, next } 或 null。
// text 内允许嵌套 [] 与转义 \] ；url 读到匹配的右括号（支持转义 \) 与嵌套 ()）。
function parseLink(src, start, end) {
  // src[start] === '['
  let i = start + 1;
  let depth = 1;
  const textStart = i;
  while (i < end) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      // 链接文本里的代码段：其中的 ] 不结束链接
      let j = i + 1;
      while (j < end && src[j] !== "`") j++;
      if (j < end) {
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "]") {
      depth--;
      if (depth === 0) break;
      i++;
      continue;
    }
    i++;
  }
  if (depth !== 0) return null; // 没有闭合的 ]
  const textEnd = i; // src[i] === ']'
  i++; // 跳过 ']'
  if (src[i] !== "(") return null;
  i++; // 跳过 '('
  let url = "";
  let pdepth = 1;
  while (i < end) {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      if (next !== undefined && i + 1 < end && ESCAPABLE.has(next)) {
        url += next;
        i += 2;
        continue;
      }
      url += "\\";
      i += 1;
      continue;
    }
    if (c === "(") {
      pdepth++;
      url += c;
      i++;
      continue;
    }
    if (c === ")") {
      pdepth--;
      if (pdepth === 0) {
        i++;
        break;
      }
      url += c;
      i++;
      continue;
    }
    url += c;
    i++;
  }
  if (pdepth !== 0) return null; // 没有闭合的 )
  return { textStart, textEnd, url, next: i };
}
