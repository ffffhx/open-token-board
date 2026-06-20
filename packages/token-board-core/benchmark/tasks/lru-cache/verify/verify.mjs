import LRU from "../src/lru.mjs";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

// ── Case 1: 基础读写 ──────────────────────────────────────────────
{
  const c = new LRU(3);
  c.put("a", 1);
  c.put("b", 2);
  c.put("c", 3);
  assert(c.get("a") === 1, "Case1: get('a') should be 1");
  assert(c.get("b") === 2, "Case1: get('b') should be 2");
  assert(c.get("z") === undefined, "Case1: get('z') should be undefined");
}

// ── Case 2: 容量为 1 时，put 新 key 应淘汰旧 key ────────────────
{
  const c = new LRU(1);
  c.put("x", 10);
  assert(c.get("x") === 10, "Case2: get('x') should be 10");
  c.put("y", 20);
  assert(c.get("x") === undefined, "Case2: 'x' should be evicted after put('y')");
  assert(c.get("y") === 20, "Case2: get('y') should be 20");
}

// ── Case 3: get 会刷新最近使用，影响淘汰顺序 ────────────────────
{
  const c = new LRU(2);
  c.put(1, "one");
  c.put(2, "two");
  // 访问 1，使 2 成为最久未使用
  assert(c.get(1) === "one", "Case3: get(1) should be 'one'");
  // 插入 3，应淘汰 2（最久未使用）
  c.put(3, "three");
  assert(c.get(2) === undefined, "Case3: 2 should be evicted (LRU)");
  assert(c.get(1) === "one", "Case3: 1 should still exist");
  assert(c.get(3) === "three", "Case3: 3 should exist");
}

// ── Case 4: put 已存在的 key 应更新值并刷新顺序 ─────────────────
{
  const c = new LRU(2);
  c.put("a", 1);
  c.put("b", 2);
  // 更新 a，使 b 成为最久未使用
  c.put("a", 99);
  assert(c.get("a") === 99, "Case4: updated value should be 99");
  // 插入 c，应淘汰 b
  c.put("c", 3);
  assert(c.get("b") === undefined, "Case4: 'b' should be evicted");
  assert(c.get("a") === 99, "Case4: 'a' should survive");
  assert(c.get("c") === 3, "Case4: 'c' should exist");
}

// ── Case 5: falsy 值（0、null、空字符串）应被视为合法缓存值 ─────
{
  const c = new LRU(3);
  c.put("zero", 0);
  c.put("nil", null);
  c.put("empty", "");
  assert(c.get("zero") === 0, "Case5: value 0 should be cached");
  assert(c.get("nil") === null, "Case5: value null should be cached");
  assert(c.get("empty") === "", "Case5: value '' should be cached");
  assert(c.get("missing") === undefined, "Case5: missing key should be undefined");
}

// ── Case 6: 连续淘汰顺序验证 ─────────────────────────────────────
{
  const c = new LRU(3);
  c.put(1, "a"); // 顺序: [1]
  c.put(2, "b"); // 顺序: [1,2]
  c.put(3, "c"); // 顺序: [1,2,3]
  c.get(1);      // 访问1 => 顺序变为 [2,3,1]（2最旧）
  c.put(4, "d"); // 淘汰2(最旧) => [3,1,4]
  assert(c.get(2) === undefined, "Case6: 2 should be evicted");
  // 此时顺序（get(2)命中失败不更新）: [3,1,4]
  // 注意：get(3)命中会将3刷新到末尾 => [1,4,3]
  assert(c.get(3) === "c", "Case6: 3 should exist");
  // 顺序: [1,4,3]
  c.put(5, "e"); // 淘汰1(最旧) => [4,3,5]
  assert(c.get(1) === undefined, "Case6: 1 should be evicted after get(3) refresh");
  assert(c.get(4) === "d", "Case6: 4 should exist");
  assert(c.get(3) === "c", "Case6: 3 should exist");
  assert(c.get(5) === "e", "Case6: 5 should exist");
}

// ── Case 7: 经典 LeetCode 146 用例 ──────────────────────────────
{
  const c = new LRU(2);
  c.put(1, 1);
  c.put(2, 2);
  assert(c.get(1) === 1, "Case7: get(1)=1");
  c.put(3, 3);                                    // 淘汰 2
  assert(c.get(2) === undefined, "Case7: 2 evicted");
  c.put(4, 4);                                    // 淘汰 1
  assert(c.get(1) === undefined, "Case7: 1 evicted");
  assert(c.get(3) === 3, "Case7: get(3)=3");
  assert(c.get(4) === 4, "Case7: get(4)=4");
}

console.log("OK lru-cache");
process.exit(0);
