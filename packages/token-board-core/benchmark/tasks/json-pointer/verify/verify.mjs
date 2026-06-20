import { get, set } from "../src/json-pointer.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function deepEq(got, want, label) {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function throws(fn, label) {
  n++;
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}: expected throw`);
}

const sample = {
  foo: ["bar", "baz"],
  "": 0,
  "a/b": 1,
  "c%d": 2,
  "e^f": 3,
  "g|h": 4,
  "i\\j": 5,
  "k\"l": 6,
  " ": 7,
  "m~n": 8,
};

// --- 1. RFC6901 标准取值样例 ---
deepEq(get(sample, ""), sample, "whole doc");
deepEq(get(sample, "/foo"), ["bar", "baz"], "get /foo");
deepEq(get(sample, "/foo/0"), "bar", "get /foo/0");
deepEq(get(sample, "/"), 0, "get / (empty key)");
deepEq(get(sample, "/a~1b"), 1, "get /a~1b => key a/b");
deepEq(get(sample, "/c%d"), 2, "get /c%d");
deepEq(get(sample, "/e^f"), 3, "get /e^f");
deepEq(get(sample, "/g|h"), 4, "get /g|h");
deepEq(get(sample, "/i\\j"), 5, "get /i\\j");
deepEq(get(sample, "/k\"l"), 6, "get /k\"l");
deepEq(get(sample, "/ "), 7, "get / (space key)");
deepEq(get(sample, "/m~0n"), 8, "get /m~0n => key m~n");

// --- 2. 转义顺序：~01 必须解为 ~1（先 ~1 后 ~0 会错）---
{
  const d = { "~1": "tilde-one", "/": "slash" };
  deepEq(get(d, "/~01"), "tilde-one", "~01 => ~1 (order matters)");
  deepEq(get(d, "/~1"), "slash", "~1 => /");
}

// --- 3. 嵌套数组/对象取值 ---
{
  const d = { a: { b: [{ c: 42 }, { c: 7 }] } };
  deepEq(get(d, "/a/b/1/c"), 7, "nested get");
  deepEq(get(d, "/a/b/0"), { c: 42 }, "nested get object element");
}

// --- 4. get 在缺失路径上必须抛错（不是返回 undefined）---
throws(() => get({ a: 1 }, "/b"), "missing key throws");
throws(() => get({ a: { b: 1 } }, "/a/c"), "missing nested key throws");
throws(() => get({ a: [1, 2] }, "/a/5"), "array index out of range throws");
throws(() => get({ a: [1, 2] }, "/a/-1"), "negative-ish/invalid index throws");
throws(() => get({ a: 1 }, "/a/b"), "descend into non-container throws");
throws(() => get({ a: [1] }, "/a/x"), "non-numeric array index throws");

// --- 5. 数字键 vs 数组下标 ---
{
  // 数组用数字下标
  deepEq(get({ arr: [10, 20, 30] }, "/arr/2"), 30, "array numeric index");
  // 对象的数字字符串键
  deepEq(get({ obj: { 2: "two" } }, "/obj/2"), "two", "object numeric key");
}

// --- 6. set: 空指针替换整个文档 ---
deepEq(set({ a: 1 }, "", { b: 2 }), { b: 2 }, "set '' replaces whole doc");

// --- 7. set: 不可变性，原 doc 不被修改 ---
{
  const orig = { a: { b: 1 }, list: [1, 2] };
  const snapshot = JSON.parse(JSON.stringify(orig));
  const next = set(orig, "/a/b", 99);
  deepEq(orig, snapshot, "original doc not mutated (object)");
  deepEq(next, { a: { b: 99 }, list: [1, 2] }, "new doc has update");
  // 未触及的子树应是共享引用（结构共享，浅拷贝路径）
  n++;
  if (next.list !== orig.list) fail("untouched subtree should be shared reference");
}

// --- 8. set: 数组下标替换，不可变 ---
{
  const orig = { xs: [1, 2, 3] };
  const next = set(orig, "/xs/1", 20);
  deepEq(next, { xs: [1, 20, 3] }, "set array index");
  deepEq(orig, { xs: [1, 2, 3] }, "array not mutated");
  n++;
  if (next.xs === orig.xs) fail("changed array should be a copy");
}

// --- 9. set: "-" 追加到数组末尾 ---
{
  const orig = { xs: [1, 2] };
  const next = set(orig, "/xs/-", 3);
  deepEq(next, { xs: [1, 2, 3] }, "set '-' appends");
  deepEq(orig, { xs: [1, 2] }, "append does not mutate original");
}

// --- 10. set: 末端追加（idx == length）---
{
  const next = set({ xs: [1, 2] }, "/xs/2", 3);
  deepEq(next, { xs: [1, 2, 3] }, "set at length appends");
}

// --- 11. set: 创建中间容器 ---
{
  const next = set({}, "/a/b/c", 1);
  deepEq(next, { a: { b: { c: 1 } } }, "creates intermediate objects");
}

// --- 12. set: 转义键写入 ---
{
  const next = set({}, "/a~1b", 1); // 键 "a/b"
  deepEq(next, { "a/b": 1 }, "set escaped key a/b");
  const next2 = set({}, "/m~0n", 2); // 键 "m~n"
  deepEq(next2, { "m~n": 2 }, "set escaped key m~n");
}

// --- 13. set: 在数组上用 "-" 创建中间并追加 ---
{
  const next = set({ xs: [] }, "/xs/-", { y: 1 });
  deepEq(next, { xs: [{ y: 1 }] }, "append object to empty array");
}

// --- 14. set: 深层混合结构不可变更新 ---
{
  const orig = { users: [{ name: "a", tags: ["x"] }, { name: "b", tags: [] }] };
  const next = set(orig, "/users/1/tags/-", "new");
  deepEq(
    next,
    { users: [{ name: "a", tags: ["x"] }, { name: "b", tags: ["new"] }] },
    "deep immutable append",
  );
  deepEq(
    orig,
    { users: [{ name: "a", tags: ["x"] }, { name: "b", tags: [] }] },
    "deep original untouched",
  );
  n++;
  if (next.users[0] !== orig.users[0]) fail("untouched user[0] should be shared");
}

// --- 15. get/set 往返一致 ---
{
  const d = { a: [{ b: 1 }] };
  const next = set(d, "/a/0/b", 5);
  deepEq(get(next, "/a/0/b"), 5, "get after set roundtrip");
}

// --- 16. set 覆盖已有键的值（含 falsy 值）---
{
  deepEq(set({ a: 1 }, "/a", 0), { a: 0 }, "set falsy 0");
  deepEq(set({ a: 1 }, "/a", false), { a: false }, "set false");
  deepEq(set({ a: 1 }, "/a", null), { a: null }, "set null");
  deepEq(set({ a: 1 }, "/a", ""), { a: "" }, "set empty string");
}

console.log(`OK json-pointer (${n} assertions)`);
process.exit(0);
