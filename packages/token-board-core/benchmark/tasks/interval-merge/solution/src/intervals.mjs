/**
 * 合并重叠区间。
 * @param {[number, number][]} intervals - 区间数组，每项为 [start, end]
 * @returns {[number, number][]} 合并后按 start 升序排列的区间数组
 */
export function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];

  // 按 start 升序排序
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);

  const merged = [sorted[0].slice()];

  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i];
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      // 重叠或相邻：扩展当前区间的 end
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}
