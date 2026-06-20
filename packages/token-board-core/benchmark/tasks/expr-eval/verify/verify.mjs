import { evaluate } from "../src/expr.mjs";

let failed = false;
function fail(msg) {
  if (!failed) {
    console.error("FAIL " + msg);
  }
  failed = true;
}

// 数值用例: [表达式, 期望值]。用近似比较容忍浮点误差。
const EPS = 1e-9;
const ok = [
  // 基本四则
  ["1+2", 3],
  ["7-3", 4],
  ["2*3", 6],
  ["8/2", 4],
  ["10/4", 2.5],
  // 优先级
  ["2+3*4", 14],
  ["2*3+4", 10],
  ["2+3*4-5", 9],
  ["10-2-3", 5], // 左结合
  ["100/10/2", 5], // 左结合: (100/10)/2 = 5
  ["2*3*4", 24],
  ["1-2+3", 2], // 左结合, 不是 1-(2+3)
  // 括号
  ["(2+3)*4", 20],
  ["2*(3+4)", 14],
  ["((1+2))*3", 9],
  ["(((5)))", 5],
  ["(1+2)*(3+4)", 21],
  ["2*(3+4*(5-1))", 38],
  // 一元负号
  ["-3", -3],
  ["-3+5", 2],
  ["2*-3", -6],
  ["2/-4", -0.5],
  ["- -3", 3], // 双重一元负号
  ["-(2+3)", -5],
  ["-(-(-4))", -4],
  ["3*-(1+1)", -6],
  ["10+-5", 5],
  ["+5", 5], // 一元正号
  ["+-+-2", 2],
  ["-2*-2", 4],
  // 小数
  ["0.5+0.25", 0.75],
  [".5+.5", 1],
  ["1.5*2", 3],
  ["3.14", 3.14],
  ["0.1+0.2", 0.3], // 浮点近似
  ["10.0/4.0", 2.5],
  // 空白
  ["  1  +  2  ", 3],
  ["\t2\n*\r3 ", 6],
  ["1+2*3", 7],
  ["( 1 + 2 ) * 3", 9],
  // 复杂混合
  ["2+3*4-10/2", 9],
  ["((2+3)*(4-1))/5", 3],
  ["-2*(3+-4)/-1", -2], // -2 * (3 + -4) / -1 = -2*(-1)/-1 = 2/-1 = -2
  ["1000000*1000000", 1e12],
  ["0/5", 0],
  ["0*123", 0],
  ["-0", 0],
];

for (const [expr, expected] of ok) {
  let got;
  try {
    got = evaluate(expr);
  } catch (e) {
    fail(`evaluate(${JSON.stringify(expr)}) threw "${e && e.message}" expected ${expected}`);
    continue;
  }
  if (typeof got !== "number") {
    fail(`evaluate(${JSON.stringify(expr)}) returned non-number ${JSON.stringify(got)}`);
    continue;
  }
  if (!(Math.abs(got - expected) <= EPS)) {
    fail(`evaluate(${JSON.stringify(expr)}) => ${got} expected ${expected}`);
  }
}

// 必须抛错的非法输入 / 除零。
const mustThrow = [
  "", // 空
  "   ", // 全空白
  "1+", // 运算符结尾
  "*3", // 二元运算符开头
  "1 2", // 两个数字相邻
  "1 2 3",
  "(1+2", // 缺右括号
  "1+2)", // 多余右括号
  "()", // 空括号
  "(", // 单独左括号
  ")", // 单独右括号
  "1//2", // 连续二元 /
  "1**2", // 连续二元 *
  "1*/2", // * 后跟 /
  "1/0", // 除零
  "5/(2-2)", // 除零(括号内)
  "10/(3-3)*2", // 除零
  "1.2.3", // 多个小数点
  "5.", // 点后无数字
  "a+1", // 未知字符
  "1+@", // 未知字符
  "3 & 4", // 未知字符
  "1.+2", // "1." 非法数字
  "2 3 +", // 数字相邻
  "*", // 单独运算符
  "/", // 单独运算符
  "(()", // 括号不匹配
  "())", // 括号不匹配
  "1+*2", // + 后跟二元 *
  "(1+2)(3)", // 相邻括号(隐式乘法不支持)
];

for (const expr of mustThrow) {
  let threw = false;
  let got;
  try {
    got = evaluate(expr);
  } catch (e) {
    threw = true;
    if (!(e instanceof Error)) {
      fail(`evaluate(${JSON.stringify(expr)}) threw non-Error ${JSON.stringify(e)}`);
    }
  }
  if (!threw) {
    fail(`evaluate(${JSON.stringify(expr)}) should throw but returned ${JSON.stringify(got)}`);
  }
}

// 合法但容易被误判为非法的: 1+(+2) 形式应为 3。
for (const [expr, expected] of [
  ["1+ +2", 3],
  ["1- -2", 3],
  ["1+ -2", -1],
  ["6/ -2", -3],
]) {
  let got;
  try {
    got = evaluate(expr);
  } catch (e) {
    fail(`evaluate(${JSON.stringify(expr)}) threw "${e && e.message}" expected ${expected}`);
    continue;
  }
  if (!(Math.abs(got - expected) <= EPS)) {
    fail(`evaluate(${JSON.stringify(expr)}) => ${got} expected ${expected}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK expr-eval");
process.exit(0);
