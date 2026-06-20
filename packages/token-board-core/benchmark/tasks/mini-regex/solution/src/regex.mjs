/**
 * 迷你正则匹配引擎（回溯实现）。
 *
 * export function isMatch(pattern, text) -> boolean
 * 当且仅当 pattern 完整匹配整个 text 时返回 true。
 * 非法 pattern 抛出异常。
 */

// 元素类型：
//   { kind: "char", ch }   匹配某个具体字符（用码点比较）
//   { kind: "any" }        "." 匹配任意单个字符
//   { kind: "class", neg, ranges }  字符类，ranges 为 [lo, hi] 码点区间数组
// 量词：quant ∈ "", "*", "+", "?"
//
// 编译产物：tokens = [{ elem, quant }, ...]

function codePoints(s) {
  // 以 Unicode 码点切分，正确处理代理对/emoji。
  return Array.from(s, (c) => c.codePointAt(0));
}

function parseClass(cps, i) {
  // cps[i] === '[' 的码点。返回 { elem, next }。
  const open = i;
  i++; // 跳过 '['
  if (i >= cps.length) {
    throw new Error("unterminated character class");
  }
  let neg = false;
  if (cps[i] === 0x5e /* ^ */) {
    neg = true;
    i++;
  }
  const ranges = [];
  let sawAny = false;
  // 收集类内成员，直到遇到 ']'。
  while (true) {
    if (i >= cps.length) {
      throw new Error("unterminated character class");
    }
    const c = cps[i];
    if (c === 0x5d /* ] */) {
      // 类结束。
      if (!sawAny) {
        // 空类 [] 或 [^] 视为非法。
        throw new Error("empty character class");
      }
      i++; // 跳过 ']'
      return { elem: { kind: "class", neg, ranges }, next: i };
    }
    // 判断是否为范围 a-z：当前字符后跟 '-' 再跟一个非 ']' 字符。
    if (
      i + 2 < cps.length &&
      cps[i + 1] === 0x2d /* - */ &&
      cps[i + 2] !== 0x5d /* ] */
    ) {
      const lo = c;
      const hi = cps[i + 2];
      if (lo > hi) {
        throw new Error("range out of order in character class");
      }
      ranges.push([lo, hi]);
      sawAny = true;
      i += 3;
      continue;
    }
    // 普通单字符（包括位于类首/类尾的 '-' 字面量）。
    ranges.push([c, c]);
    sawAny = true;
    i++;
  }
  void open;
}

function compile(pattern) {
  if (typeof pattern !== "string") {
    throw new Error("pattern must be a string");
  }
  const cps = codePoints(pattern);
  const tokens = [];
  let i = 0;
  while (i < cps.length) {
    const c = cps[i];
    let elem;
    if (c === 0x2a /* * */ || c === 0x2b /* + */ || c === 0x3f /* ? */) {
      throw new Error("quantifier with nothing to repeat");
    }
    if (c === 0x5d /* ] */) {
      throw new Error("unmatched ']'");
    }
    if (c === 0x5b /* [ */) {
      const r = parseClass(cps, i);
      elem = r.elem;
      i = r.next;
    } else if (c === 0x2e /* . */) {
      elem = { kind: "any" };
      i++;
    } else {
      elem = { kind: "char", ch: c };
      i++;
    }
    // 量词
    let quant = "";
    if (i < cps.length) {
      const q = cps[i];
      if (q === 0x2a) {
        quant = "*";
        i++;
      } else if (q === 0x2b) {
        quant = "+";
        i++;
      } else if (q === 0x3f) {
        quant = "?";
        i++;
      }
    }
    tokens.push({ elem, quant });
  }
  return tokens;
}

function elemMatches(elem, cp) {
  if (cp === undefined) return false;
  switch (elem.kind) {
    case "any":
      return true;
    case "char":
      return elem.ch === cp;
    case "class": {
      let inside = false;
      for (const [lo, hi] of elem.ranges) {
        if (cp >= lo && cp <= hi) {
          inside = true;
          break;
        }
      }
      return elem.neg ? !inside : inside;
    }
    default:
      return false;
  }
}

// 回溯匹配：tokens[ti] 起，text 的码点数组 tc 从 si 起，是否能匹配到两端结束。
function matchFrom(tokens, ti, tc, si) {
  if (ti === tokens.length) {
    return si === tc.length;
  }
  const { elem, quant } = tokens[ti];
  if (quant === "") {
    if (si < tc.length && elemMatches(elem, tc[si])) {
      return matchFrom(tokens, ti + 1, tc, si + 1);
    }
    return false;
  }
  if (quant === "?") {
    // 先尝试匹配一个（贪婪），再尝试零个。
    if (si < tc.length && elemMatches(elem, tc[si])) {
      if (matchFrom(tokens, ti + 1, tc, si + 1)) return true;
    }
    return matchFrom(tokens, ti + 1, tc, si);
  }
  // "*" 或 "+"：贪婪消费尽可能多，再回溯。
  // 先确定可消费的最大长度。
  let end = si;
  while (end < tc.length && elemMatches(elem, tc[end])) {
    end++;
  }
  const min = quant === "+" ? 1 : 0;
  if (end - si < min) {
    return false;
  }
  // 从多到少回溯。
  for (let take = end; take >= si + min; take--) {
    if (matchFrom(tokens, ti + 1, tc, take)) return true;
  }
  return false;
}

export function isMatch(pattern, text) {
  if (typeof text !== "string") {
    throw new Error("text must be a string");
  }
  const tokens = compile(pattern);
  const tc = codePoints(text);
  return matchFrom(tokens, 0, tc, 0);
}
