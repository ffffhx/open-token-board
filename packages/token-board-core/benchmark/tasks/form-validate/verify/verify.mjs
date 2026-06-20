import { validateForm } from "../src/validate-form.mjs";

function assert(label, got, expected) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  if (g !== e) {
    console.error(`FAIL ${label}\n  got:      ${g}\n  expected: ${e}`);
    process.exit(1);
  }
}

// 辅助：从错误列表提取 { field, code } 对，便于比较
function codes(errors) {
  return errors.map(({ field, code }) => ({ field, code }));
}

// ── Case 1: 所有字段均合法，应返回空数组 ──────────────────────────────────
assert(
  "all valid",
  validateForm([
    { name: "username", value: "alice", required: true, minLength: 2, maxLength: 20, pattern: /^[a-z]+$/ },
    { name: "age",      value: "25",    required: false, pattern: /^\d+$/ },
  ]),
  []
);

// ── Case 2: required — 完全空字符串触发 required 错误 ─────────────────────
assert(
  "required empty string",
  codes(validateForm([{ name: "email", value: "", required: true }])),
  [{ field: "email", code: "required" }]
);

// ── Case 3: required — 纯空白字符串（仅含空格）trim 后为空，也应触发 ───────
assert(
  "required whitespace-only value",
  codes(validateForm([{ name: "email", value: "   ", required: true }])),
  [{ field: "email", code: "required" }]
);

// ── Case 4: required — 非空字符串不触发 required ──────────────────────────
assert(
  "required non-empty",
  codes(validateForm([{ name: "email", value: "a@b.com", required: true }])),
  []
);

// ── Case 5: minLength — trim 后长度小于 minLength 报错 ────────────────────
assert(
  "minLength too short",
  codes(validateForm([{ name: "pwd", value: "ab", minLength: 6 }])),
  [{ field: "pwd", code: "minLength" }]
);

// ── Case 6: minLength — trim 后长度等于 minLength 不报错 ─────────────────
assert(
  "minLength exactly met",
  codes(validateForm([{ name: "pwd", value: "abcdef", minLength: 6 }])),
  []
);

// ── Case 7: maxLength — trim 后长度超过 maxLength 报错 ───────────────────
assert(
  "maxLength exceeded",
  codes(validateForm([{ name: "bio", value: "hello world", maxLength: 5 }])),
  [{ field: "bio", code: "maxLength" }]
);

// ── Case 8: pattern — 不匹配时报错 ───────────────────────────────────────
assert(
  "pattern mismatch",
  codes(validateForm([{ name: "zip", value: "abc", pattern: /^\d{5}$/ }])),
  [{ field: "zip", code: "pattern" }]
);

// ── Case 9: pattern — 匹配时不报错 ───────────────────────────────────────
assert(
  "pattern match ok",
  codes(validateForm([{ name: "zip", value: "12345", pattern: /^\d{5}$/ }])),
  []
);

// ── Case 10: 多字段混合错误，顺序应与字段顺序一致 ──────────────────────────
assert(
  "multiple field errors",
  codes(validateForm([
    { name: "username", value: "  ", required: true },          // required (whitespace)
    { name: "password", value: "hi",  minLength: 8 },           // minLength
    { name: "nickname", value: "valid_nick", pattern: /^\d+$/ }, // pattern mismatch
  ])),
  [
    { field: "username", code: "required" },
    { field: "password", code: "minLength" },
    { field: "nickname", code: "pattern" },
  ]
);

// ── Case 11: minLength trim — 值含前后空格，trim 后满足 minLength ─────────
assert(
  "minLength with surrounding spaces trims ok",
  codes(validateForm([{ name: "tag", value: "  hello  ", minLength: 5 }])),
  []
);

console.log("OK form-validate");
process.exit(0);
