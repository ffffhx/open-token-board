/**
 * 对数组去重，保留每个元素第一次出现时的位置，输出顺序与原数组保持一致。
 * 例如：dedupe([3, 1, 2, 1, 3]) => [3, 1, 2]
 *
 * @param {Array} arr
 * @returns {Array}
 */
export function dedupe(arr) {
  const seen = new Set();
  const result = [];
  for (const val of arr) {
    if (!seen.has(val)) {
      seen.add(val);
      result.push(val);
    }
  }
  return result;
}
