import { isBalanced } from "../src/brackets.mjs";

const cases = [
  // [input, expected, description]
  ["()", true, "simple parens"],
  ["[]", true, "simple brackets"],
  ["{}", true, "simple braces"],
  ["([{}])", true, "nested all types"],
  ["(abc[def])", true, "non-bracket chars ignored"],
  ["hello world", true, "no brackets at all"],
  ["([)]", false, "interleaved/crossed"],
  ["((", false, "unclosed parens"],
  [")", false, "unmatched close paren"],
  ["{[}", false, "mismatched brace"],
  ["((()))", true, "deeply nested same type"],
  ["()[]{}", true, "sequential pairs"],
  ["([{abc}])", true, "nested with non-bracket chars"],
  ["(]", false, "wrong close type"],
  ["", true, "empty string"],
  ["{[]()}", true, "mixed nested"],
  ["((())", false, "one unclosed"],
];

let allPassed = true;

for (const [input, expected, desc] of cases) {
  const got = isBalanced(input);
  if (got !== expected) {
    console.error(
      `FAIL [${desc}] isBalanced(${JSON.stringify(input)}) => ${got} expected ${expected}`
    );
    allPassed = false;
  }
}

if (!allPassed) {
  process.exit(1);
}

console.log("OK balanced-brackets");
process.exit(0);
