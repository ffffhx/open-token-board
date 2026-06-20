// 递归下降算术表达式求值器。
// 支持: + - * / 、括号、一元负号、十进制数（含小数）、任意空白。
// 优先级: 一元负号 > * / > + -，且 * / 和 + - 都是左结合。
// 除以 0 抛错。非法输入（括号不匹配、运算符结尾、空表达式、连续二元运算符、未知字符）抛 Error。
// 返回 number。
export function evaluate(str) {
  if (typeof str !== "string") {
    throw new Error("input must be a string");
  }

  // ---- 词法分析 ----
  // token 种类: number / + / - / * / / / ( / )
  const tokens = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const c = str[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "(" || c === ")") {
      tokens.push({ type: c });
      i++;
      continue;
    }
    // 数字: 形如 12, 12.5, .5, 5. 非法; 必须至少一位数字。
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      let digitsBefore = 0;
      while (j < n && str[j] >= "0" && str[j] <= "9") {
        j++;
        digitsBefore++;
      }
      let hasDot = false;
      let digitsAfter = 0;
      if (j < n && str[j] === ".") {
        hasDot = true;
        j++;
        while (j < n && str[j] >= "0" && str[j] <= "9") {
          j++;
          digitsAfter++;
        }
      }
      // 不允许多个小数点 / 后面再跟点等情况
      if (j < n && str[j] === ".") {
        throw new Error("malformed number near index " + i);
      }
      // 至少要有一位数字（在点的任一侧）
      if (digitsBefore === 0 && digitsAfter === 0) {
        throw new Error("malformed number near index " + i);
      }
      // 形如 "5." （有点但点后无数字）视为非法
      if (hasDot && digitsAfter === 0) {
        throw new Error("malformed number near index " + i);
      }
      const text = str.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new Error("malformed number: " + text);
      }
      tokens.push({ type: "number", value });
      i = j;
      continue;
    }
    throw new Error("unknown character: " + JSON.stringify(c));
  }

  if (tokens.length === 0) {
    throw new Error("empty expression");
  }

  // ---- 递归下降解析 ----
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+' | '-') term)*
  function parseExpr() {
    let value = parseTerm();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const op = next().type;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  // term := factor (('*' | '/') factor)*
  function parseTerm() {
    let value = parseFactor();
    while (peek() && (peek().type === "*" || peek().type === "/")) {
      const op = next().type;
      const rhs = parseFactor();
      if (op === "*") {
        value = value * rhs;
      } else {
        if (rhs === 0) {
          throw new Error("division by zero");
        }
        value = value / rhs;
      }
    }
    return value;
  }

  // factor := ('-' | '+') factor | primary
  function parseFactor() {
    const t = peek();
    if (!t) {
      throw new Error("unexpected end of input");
    }
    if (t.type === "-") {
      next();
      return -parseFactor();
    }
    if (t.type === "+") {
      next();
      return parseFactor();
    }
    return parsePrimary();
  }

  // primary := number | '(' expr ')'
  function parsePrimary() {
    const t = peek();
    if (!t) {
      throw new Error("unexpected end of input");
    }
    if (t.type === "number") {
      next();
      return t.value;
    }
    if (t.type === "(") {
      next();
      const value = parseExpr();
      const closing = peek();
      if (!closing || closing.type !== ")") {
        throw new Error("unbalanced parentheses: missing )");
      }
      next();
      return value;
    }
    throw new Error("unexpected token: " + t.type);
  }

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error("unexpected trailing tokens at " + pos);
  }
  if (!Number.isFinite(result)) {
    throw new Error("result is not finite");
  }
  return result;
}
