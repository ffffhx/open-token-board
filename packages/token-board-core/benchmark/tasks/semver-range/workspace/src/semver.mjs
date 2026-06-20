// 语义化版本范围匹配。
// 实现 satisfies(version, range)：判断 version 是否落在 range 内。
// 详见任务说明。本实现存在多处缺陷，请修复/补全。

function parseVersion(v) {
  // BUG: 校验过于宽松，未拒绝前导零、空白、prerelease 等
  const parts = String(v).split(".");
  return parts.map((p) => parseInt(p, 10));
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function satisfies(version, range) {
  const v = parseVersion(version);
  const r = range.trim();

  // BUG: 只处理了精确匹配和最朴素的比较符，caret/tilde/AND 都没实现
  if (r.startsWith(">=")) return compare(v, parseVersion(r.slice(2))) >= 0;
  if (r.startsWith(">")) return compare(v, parseVersion(r.slice(1))) > 0;
  if (r.startsWith("<")) return compare(v, parseVersion(r.slice(1))) < 0;
  return compare(v, parseVersion(r)) === 0;
}
