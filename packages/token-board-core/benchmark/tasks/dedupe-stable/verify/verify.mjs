import { dedupe } from "../src/dedupe.mjs";

const cases = [
  // [input, expected]
  [[3, 1, 2, 1, 3], [3, 1, 2]],
  [[1, 2, 3], [1, 2, 3]],
  [[1, 1, 1], [1]],
  [[], []],
  [["a", "b", "a", "c"], ["a", "b", "c"]],
  [[2, 1, 2, 3, 1], [2, 1, 3]],
  [[5, 4, 3, 4, 5, 6], [5, 4, 3, 6]],
  [[1, 2, 1, 2, 1], [1, 2]],
];

for (const [input, expected] of cases) {
  const got = dedupe(input);
  const ok =
    got.length === expected.length &&
    got.every((v, i) => v === expected[i]);
  if (!ok) {
    console.error(
      `FAIL dedupe(${JSON.stringify(input)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
    );
    process.exit(1);
  }
}

console.log("OK dedupe-stable");
process.exit(0);
