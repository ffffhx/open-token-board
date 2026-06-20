// 计算把数组 a 变成数组 b 的「最短编辑脚本」。
//
// 返回一个操作数组，每个操作形如：
//   { type: "keep", value }  保留 a 中的一个元素（同时对应 b 中相同元素）
//   { type: "del",  value }  删除 a 中的一个元素
//   { type: "ins",  value }  插入一个 b 中的元素
//
// 约束：
//   - keep 的数量等于 a 与 b 的最长公共子序列(LCS)长度，
//     因此 del + ins 的数量等于经典编辑距离（仅增删，不含替换）。
//   - 把脚本依次应用到 a 必须得到 b。
//   - 同一位置上若既要删除又要插入，删除排在插入之前（确定性 tie-break）。
//
// 元素相等使用 Object.is 判定。
export function computeEditScript(a, b) {
  // TODO: 这是一个朴素且不正确的实现，只处理了公共前缀，
  // 剩余部分直接「全删再全插」，并不是最短脚本，tie-break 也不对。
  const script = [];
  let i = 0;
  while (i < a.length && i < b.length && Object.is(a[i], b[i])) {
    script.push({ type: "keep", value: a[i] });
    i++;
  }
  for (let k = i; k < a.length; k++) {
    script.push({ type: "del", value: a[k] });
  }
  for (let k = i; k < b.length; k++) {
    script.push({ type: "ins", value: b[k] });
  }
  return script;
}
