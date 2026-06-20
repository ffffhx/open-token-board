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
  const n = a.length;
  const m = b.length;

  // LCS 长度 DP。dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度。
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (Object.is(a[i], b[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const script = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (Object.is(a[i], b[j])) {
      script.push({ type: "keep", value: a[i] });
      i++;
      j++;
      continue;
    }
    // 不匹配：要么删 a[i]，要么插 b[j]。挑能保持 LCS 最优的方向。
    // tie-break：当两条路径都同样最优时，优先删除（del 在 ins 之前）。
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      script.push({ type: "del", value: a[i] });
      i++;
    } else {
      script.push({ type: "ins", value: b[j] });
      j++;
    }
  }
  while (i < n) {
    script.push({ type: "del", value: a[i] });
    i++;
  }
  while (j < m) {
    script.push({ type: "ins", value: b[j] });
    j++;
  }
  return script;
}
