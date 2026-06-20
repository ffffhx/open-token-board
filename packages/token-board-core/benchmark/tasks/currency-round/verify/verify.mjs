import { roundMoney } from "../src/money.mjs";

// 银行家舍入（Round Half to Even）测试用例
// 格式：[输入分, 期望输出分, 说明]
const cases = [
  // 恰好 x.5 — 关键银行家舍入场景
  [0.5,  0,  "0.5 -> 0 (偶数)"],
  [1.5,  2,  "1.5 -> 2 (偶数)"],
  [2.5,  2,  "2.5 -> 2 (偶数)"],
  [3.5,  4,  "3.5 -> 4 (偶数)"],
  [4.5,  4,  "4.5 -> 4 (偶数)"],
  [5.5,  6,  "5.5 -> 6 (偶数)"],
  // 非 0.5 情况，与 Math.round 相同
  [1.2,  1,  "1.2 -> 1 (普通舍)"],
  [1.8,  2,  "1.8 -> 2 (普通入)"],
  [2.0,  2,  "2.0 -> 2 (整数不变)"],
  [100.5, 100, "100.5 -> 100 (偶数)"],
  [101.5, 102, "101.5 -> 102 (偶数)"],
];

let failed = false;
for (const [input, expected, desc] of cases) {
  const got = roundMoney(input);
  if (got !== expected) {
    console.error(`FAIL roundMoney(${input}) => ${got}, expected ${expected}  [${desc}]`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("OK currency-round");
process.exit(0);
