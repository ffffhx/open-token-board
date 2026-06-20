import { codeOf, describe } from "../src/status-codes.mjs";

function assert(label, got, expected) {
  if (got !== expected) {
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}

// 正确值：UNPROCESSABLE_ENTITY => 422（文件中错误地写成了 412）
assert("codeOf(UNPROCESSABLE_ENTITY)", codeOf("UNPROCESSABLE_ENTITY"), 422);

// describe(422) 反查应得到 UNPROCESSABLE_ENTITY
assert("describe(422)", describe(422), "UNPROCESSABLE_ENTITY");

// PRECONDITION_FAILED 不应受影响，仍为 412
assert("codeOf(PRECONDITION_FAILED)", codeOf("PRECONDITION_FAILED"), 412);
assert("describe(412)", describe(412), "PRECONDITION_FAILED");

// 相邻条目不应被 bug 破坏
assert("codeOf(MISDIRECTED_REQUEST)", codeOf("MISDIRECTED_REQUEST"), 421);
assert("describe(421)",               describe(421),                 "MISDIRECTED_REQUEST");
assert("codeOf(LOCKED)",              codeOf("LOCKED"),              423);
assert("describe(423)",               describe(423),                 "LOCKED");

// 其他正常条目的一致性
assert("codeOf(NOT_FOUND)",           codeOf("NOT_FOUND"),           404);
assert("describe(404)",               describe(404),                 "NOT_FOUND");
assert("codeOf(INTERNAL_SERVER_ERROR)", codeOf("INTERNAL_SERVER_ERROR"), 500);
assert("describe(500)",               describe(500),                 "INTERNAL_SERVER_ERROR");
assert("codeOf(OK)",                  codeOf("OK"),                  200);
assert("describe(200)",               describe(200),                 "OK");

// 不存在的键/码应返回 undefined
assert("codeOf(NONEXISTENT)",         codeOf("NONEXISTENT"),         undefined);
assert("describe(999)",               describe(999),                 undefined);

console.log("OK status-codes");
process.exit(0);
