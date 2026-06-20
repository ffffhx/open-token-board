/**
 * 贪心自动换行：将 text 按 width 宽度切分为多行，返回字符串数组。
 * - 多个连续空格视为单个分隔符，首尾空白忽略。
 * - 单词本身超过 width 时单独占一行。
 * - 空输入返回空数组。
 */
export function wrapText(text, width) {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines = [];
  let current = "";

  for (const word of words) {
    if (current === "") {
      // 第一个词直接放入当前行（即使超过 width 也单独占一行）
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      // 加上空格和新词后不超过 width，可以追加
      current += " " + word;
    } else {
      // 超过宽度，换行
      lines.push(current);
      current = word;
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines;
}
