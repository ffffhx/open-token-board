import { wrapText } from "../src/wrap.mjs";

function check(label, got, expected) {
  const gs = JSON.stringify(got);
  const es = JSON.stringify(expected);
  if (gs !== es) {
    console.error(`FAIL ${label}: got ${gs}, expected ${es}`);
    process.exit(1);
  }
}

// 1. 基本换行：精确适配 width
check(
  "exact-fit",
  wrapText("aa bb cc", 5),
  ["aa bb", "cc"]
);

// 2. 单词恰好等于 width，单独一行
check(
  "word-equals-width",
  wrapText("hello world", 5),
  ["hello", "world"]
);

// 3. 单词本身超过 width，单独占一行
check(
  "overflow-word",
  wrapText("hi superlongword ok", 6),
  ["hi", "superlongword", "ok"]
);

// 4. 多个连续空格折叠为单个分隔符
check(
  "multiple-spaces",
  wrapText("foo   bar  baz", 7),
  ["foo bar", "baz"]
);

// 5. 空字符串返回空数组
check(
  "empty-string",
  wrapText("", 10),
  []
);

// 6. 只有空白字符返回空数组
check(
  "whitespace-only",
  wrapText("   ", 10),
  []
);

// 7. 所有单词都能放在一行
check(
  "all-fit",
  wrapText("a b c", 10),
  ["a b c"]
);

// 8. 每个单词单独一行（width 恰好容纳最短单词）
check(
  "one-per-line",
  wrapText("ab cd ef", 2),
  ["ab", "cd", "ef"]
);

console.log("OK word-wrap");
process.exit(0);
