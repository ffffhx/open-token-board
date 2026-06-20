/**
 * 判断字符串中的括号是否合法匹配。
 * 支持圆括号 ()、方括号 []、花括号 {}。
 * 非括号字符一律忽略。
 * @param {string} str
 * @returns {boolean}
 */
export function isBalanced(str) {
  const stack = [];
  const open = new Set(["(", "[", "{"]);
  const match = { ")": "(", "]": "[", "}": "{" };

  for (const ch of str) {
    if (open.has(ch)) {
      stack.push(ch);
    } else if (ch in match) {
      if (stack.length === 0 || stack[stack.length - 1] !== match[ch]) {
        return false;
      }
      stack.pop();
    }
  }

  return stack.length === 0;
}
