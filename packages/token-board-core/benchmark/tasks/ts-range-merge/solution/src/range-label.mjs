// 把一组整数压缩成人类可读的区间标签。
// 例如 [1,2,3,5,7,8] => "1-3, 5, 7-8"
// 连续（差值为 1）的数字合并成 "起-止"，单独的数字原样输出，用 ", " 连接。
export function compactRangeLabel(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}
