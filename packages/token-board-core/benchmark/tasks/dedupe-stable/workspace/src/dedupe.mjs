/**
 * 对数组去重，保留每个元素第一次出现时的位置，输出顺序与原数组保持一致。
 * 例如：dedupe([3, 1, 2, 1, 3]) => [3, 1, 2]
 *
 * @param {Array} arr
 * @returns {Array}
 */
export function dedupe(arr) {
  const seen = new Map();
  // BUG: 把每次出现的索引都存入 Map，最终保留的是最后一次出现的位置
  for (let i = 0; i < arr.length; i++) {
    seen.set(arr[i], i);
  }
  // 按索引升序还原顺序，但此时每个 key 对应的是最后一次出现的索引
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([val]) => val);
}
