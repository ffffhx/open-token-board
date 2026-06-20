import { compactRangeLabel } from "../src/range-label.mjs";

const cases = [
  [[1, 2, 3, 5, 7, 8], "1-3, 5, 7-8"],
  [[1, 2, 3], "1-3"],
  [[5], "5"],
  [[1, 3, 5], "1, 3, 5"],
  [[10, 11, 12, 20], "10-12, 20"],
  [[3, 1, 2], "1-3"],
  [[2, 4, 6, 7, 8, 100], "2, 4, 6-8, 100"],
];

for (const [input, expected] of cases) {
  const got = compactRangeLabel(input);
  if (got !== expected) {
    console.error(`FAIL compactRangeLabel(${JSON.stringify(input)}) => ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}
console.log("OK range-label");
process.exit(0);
