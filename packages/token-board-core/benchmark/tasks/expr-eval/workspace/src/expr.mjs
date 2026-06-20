// 递归下降算术表达式求值器（待实现 / 含 bug）。
// 当前实现把整串按空白切分后从左到右计算，既不处理优先级，也不处理括号、
// 一元负号、除零和非法输入。需要按 prompt 描述重新实现 evaluate。
export function evaluate(str) {
  const tokens = String(str).trim().split(/\s+/);
  let value = Number(tokens[0]);
  for (let i = 1; i + 1 < tokens.length; i += 2) {
    const op = tokens[i];
    const rhs = Number(tokens[i + 1]);
    if (op === "+") value += rhs;
    else if (op === "-") value -= rhs;
    else if (op === "*") value *= rhs;
    else if (op === "/") value /= rhs;
  }
  return value;
}
