import { computeBackoffMs } from "../src/backoff.mjs";

// 测试用例：[attempt, baseMs, capMs, expected]
// 公式：min(baseMs * 2^(attempt-1), capMs)
const cases = [
  // attempt=1 => 2^0=1 => baseMs * 1 = baseMs
  [1, 100, 10000, 100],
  // attempt=2 => 2^1=2 => 100 * 2 = 200
  [2, 100, 10000, 200],
  // attempt=3 => 2^2=4 => 100 * 4 = 400
  [3, 100, 10000, 400],
  // attempt=4 => 2^3=8 => 100 * 8 = 800
  [4, 100, 10000, 800],
  // cap 生效：attempt=5 => 2^4=16 => 100*16=1600, cap=1000 => 1000
  [5, 100, 1000, 1000],
  // cap 生效：attempt=10 => 2^9=512 => 50*512=25600, cap=5000 => 5000
  [10, 50, 5000, 5000],
  // 基础场景：baseMs=500, attempt=1 => 500
  [1, 500, 60000, 500],
  // cap 正好等于计算结果：attempt=3 => 2^2=4 => 200*4=800, cap=800 => 800
  [3, 200, 800, 800],
];

let failed = false;
for (const [attempt, baseMs, capMs, expected] of cases) {
  const got = computeBackoffMs(attempt, baseMs, capMs);
  if (got !== expected) {
    console.error(
      `FAIL computeBackoffMs(${attempt}, ${baseMs}, ${capMs}) => ${got}, expected ${expected}`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK retry-backoff");
process.exit(0);
