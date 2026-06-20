import { mergeIntervals } from "../src/intervals.mjs";

function eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

const cases = [
  // 基本重叠
  {
    input: [[1, 3], [2, 6], [8, 10], [15, 18]],
    expected: [[1, 6], [8, 10], [15, 18]],
    desc: "基本重叠",
  },
  // 相邻区间（端点相触）应合并
  {
    input: [[1, 4], [4, 5]],
    expected: [[1, 5]],
    desc: "端点相触应合并",
  },
  // 输入无序，需先排序
  {
    input: [[1, 4], [0, 4]],
    expected: [[0, 4]],
    desc: "无序输入需排序",
  },
  // 完全包含
  {
    input: [[1, 10], [2, 5], [6, 8]],
    expected: [[1, 10]],
    desc: "完全包含",
  },
  // 不相交区间，保持独立
  {
    input: [[1, 2], [5, 7], [10, 12]],
    expected: [[1, 2], [5, 7], [10, 12]],
    desc: "不相交区间",
  },
  // 空数组
  {
    input: [],
    expected: [],
    desc: "空数组",
  },
  // 单个区间
  {
    input: [[3, 7]],
    expected: [[3, 7]],
    desc: "单个区间",
  },
  // 多区间全部重叠为一个
  {
    input: [[1, 4], [2, 3], [3, 6], [5, 8]],
    expected: [[1, 8]],
    desc: "连续重叠合并为一个",
  },
];

for (const { input, expected, desc } of cases) {
  let got;
  try {
    got = mergeIntervals(input);
  } catch (e) {
    console.error(`FAIL [${desc}]: mergeIntervals 抛出异常: ${e.message}`);
    process.exit(1);
  }
  if (!eq(got, expected)) {
    console.error(
      `FAIL [${desc}]: mergeIntervals(${JSON.stringify(input)}) => ${JSON.stringify(got)}, 期望 ${JSON.stringify(expected)}`
    );
    process.exit(1);
  }
}

console.log("OK interval-merge");
process.exit(0);
