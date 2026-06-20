import { parseCsvLine } from "../src/csv.mjs";

const cases = [
  // [input, expected]
  // 基础：无引号
  ["a,b,c", ["a", "b", "c"]],
  // 单字段
  ["hello", ["hello"]],
  // 引号字段内含逗号
  ['"hello, world",x', ["hello, world", "x"]],
  // 引号字段内含 "" 转义
  ['"say ""hi""",y', ['say "hi"', "y"]],
  // 混合：普通 + 引号 + 普通
  ['one,"two,three",four', ["one", "two,three", "four"]],
  // 引号字段同时含逗号和转义引号
  ['"a,""b"",c",end', ['a,"b",c', "end"]],
  // 空字段
  ["a,,c", ["a", "", "c"]],
  // 引号内空字段
  ['"",x', ["", "x"]],
];

let failed = false;
for (const [input, expected] of cases) {
  const got = parseCsvLine(input);
  const ok =
    got.length === expected.length &&
    got.every((v, i) => v === expected[i]);
  if (!ok) {
    console.error(
      `FAIL parseCsvLine(${JSON.stringify(input)}) => ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK csv-quote-parse");
process.exit(0);
