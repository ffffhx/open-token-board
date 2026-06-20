import Cache from "../src/lru-ttl.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function eq(got, want, label) {
  n++;
  if (got !== want) {
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

// --- 1. 基本 set/get ---
{
  const c = new Cache(3, 10);
  c.set("a", 1, 0);
  eq(c.get("a", 0), 1, "basic get");
  eq(c.get("missing", 0), undefined, "miss returns undefined");
}

// --- 2. value 可以是 0/null/''/false，都是合法值 ---
{
  const c = new Cache(4, 100);
  c.set("zero", 0, 0);
  c.set("nul", null, 0);
  c.set("empty", "", 0);
  c.set("ff", false, 0);
  eq(c.get("zero", 1), 0, "value 0");
  eq(c.get("nul", 1), null, "value null");
  eq(c.get("empty", 1), "", "value empty string");
  eq(c.get("ff", 1), false, "value false");
}

// --- 3. 过期边界：now >= insertedAt+ttl 才算过期 ---
{
  const c = new Cache(2, 10);
  c.set("x", 1, 5); // expireAt = 15
  eq(c.get("x", 14), 1, "before expiry");
  eq(c.get("x", 15), undefined, "exact expiry boundary expired");
}
{
  const c = new Cache(2, 10);
  c.set("x", 1, 5); // expireAt = 15
  eq(c.get("x", 14), 1, "before expiry 2");
  eq(c.get("x", 16), undefined, "after expiry");
}

// --- 4. 过期条目被 get 后必须真正删除（size 减少）---
{
  const c = new Cache(3, 10);
  c.set("a", 1, 0); // expireAt 10
  eq(c.size, 1, "size 1 after one set");
  eq(c.get("a", 10), undefined, "expired get");
  eq(c.size, 0, "expired entry removed from cache");
}

// --- 5. set 重置 insertedAt（续命）---
{
  const c = new Cache(2, 10);
  c.set("a", 1, 0); // expireAt 10
  c.set("a", 2, 8); // 更新 -> expireAt 18
  eq(c.get("a", 10), 2, "re-set resets insertedAt: still alive at 10");
  eq(c.get("a", 17), 2, "alive at 17");
  eq(c.get("a", 18), undefined, "expired at 18");
}

// --- 6. 自定义 ttl 覆盖 defaultTtl ---
{
  const c = new Cache(2, 100);
  c.set("a", 1, 0, 5); // expireAt 5
  eq(c.get("a", 4), 1, "custom ttl alive");
  eq(c.get("a", 5), undefined, "custom ttl expired");
}

// --- 7. ttl 显式传入仍走校验，非法抛错 ---
{
  const c = new Cache(2, 10);
  throws(() => c.set("a", 1, 0, 0), "ttl 0 throws");
  throws(() => c.set("a", 1, 0, -3), "ttl negative throws");
  throws(() => c.set("a", 1, 0, 1.5), "ttl non-integer throws");
}

// --- 8. 构造参数校验 ---
{
  throws(() => new Cache(0, 10), "capacity 0 throws");
  throws(() => new Cache(-1, 10), "capacity negative throws");
  throws(() => new Cache(2.5, 10), "capacity non-int throws");
  throws(() => new Cache(2, 0), "defaultTtl 0 throws");
  throws(() => new Cache(2, -5), "defaultTtl negative throws");
}

// --- 9. 基本 LRU 淘汰（无过期参与）---
{
  const c = new Cache(2, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("c", 3, 0); // a 是最久未用 -> 淘汰 a
  eq(c.get("a", 1), undefined, "a evicted");
  eq(c.get("b", 1), 2, "b alive");
  eq(c.get("c", 1), 3, "c alive");
}

// --- 10. get 刷新最近使用，改变淘汰目标 ---
{
  const c = new Cache(2, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  eq(c.get("a", 1), 1, "touch a"); // a 变最近使用，b 变最久
  c.set("c", 3, 2); // 淘汰 b
  eq(c.get("b", 3), undefined, "b evicted after touching a");
  eq(c.get("a", 3), 1, "a survived");
  eq(c.get("c", 3), 3, "c alive");
}

// --- 11. set 已存在 key 也刷新最近使用 ---
{
  const c = new Cache(2, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("a", 10, 1); // 更新 a -> a 最近使用
  c.set("c", 3, 2); // 淘汰 b
  eq(c.get("b", 3), undefined, "b evicted after re-set a");
  eq(c.get("a", 3), 10, "a updated and survived");
}

// --- 12. 过期项优先淘汰，即使它不是最久未使用 ---
{
  const c = new Cache(3, 1000);
  c.set("a", 1, 0, 5); // expireAt 5（短命）
  c.set("b", 2, 0, 1000);
  c.set("c", 3, 0, 1000);
  // now=10 时 a 已过期。插入 d 应优先淘汰过期的 a，而非最久未用的 b
  c.set("d", 4, 10);
  eq(c.get("a", 10), undefined, "expired a evicted preferentially");
  eq(c.get("b", 10), 2, "b survives despite being LRU");
  eq(c.get("c", 10), 3, "c survives");
  eq(c.get("d", 10), 4, "d inserted");
}

// --- 13. 多个过期项时，淘汰最久未使用的那个过期项（Map 顺序）---
{
  const c = new Cache(3, 1000);
  c.set("a", 1, 0, 5); // 过期 @5
  c.set("b", 2, 0, 5); // 过期 @5
  c.set("c", 3, 0, 1000);
  // now=10：a、b 都过期；插入 d 应淘汰更久未用的 a（先插入的过期项）
  c.set("d", 4, 10);
  eq(c.get("a", 10), undefined, "oldest expired (a) evicted");
  eq(c.size, 3, "size stays at capacity");
  // b 仍在缓存里（但已过期），get 会删除它
  eq(c.get("b", 10), undefined, "b expired on access");
  eq(c.get("c", 10), 3, "c alive");
  eq(c.get("d", 10), 4, "d alive");
}

// --- 14. 没有过期项时退回普通 LRU 淘汰 ---
{
  const c = new Cache(2, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("c", 3, 5); // 无过期 -> 淘汰最久未用 a
  eq(c.get("a", 5), undefined, "no-expiry path evicts LRU a");
  eq(c.get("b", 5), 2, "b alive");
}

// --- 15. 更新已存在 key 不触发淘汰（即使满）---
{
  const c = new Cache(2, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("a", 99, 1); // 更新已存在，size 仍为 2，不应淘汰 b
  eq(c.size, 2, "update does not change size");
  eq(c.get("a", 2), 99, "a updated");
  eq(c.get("b", 2), 2, "b not evicted by update");
}

// --- 16. 过期但被覆盖 set：相当于复活 ---
{
  const c = new Cache(2, 10);
  c.set("a", 1, 0); // 过期 @10
  c.set("a", 2, 20); // 即便逻辑上已过期，再 set 覆盖
  eq(c.get("a", 25), 2, "re-set revives after expiry");
  eq(c.get("a", 30), undefined, "and expires again @30");
}

// --- 17. key 类型多样（数字、字符串区分）---
{
  const c = new Cache(3, 1000);
  c.set(1, "num", 0);
  c.set("1", "str", 0);
  eq(c.get(1, 1), "num", "numeric key");
  eq(c.get("1", 1), "str", "string key distinct from numeric");
}

// --- 18. 容量 1 的极端情况 ---
{
  const c = new Cache(1, 1000);
  c.set("a", 1, 0);
  c.set("b", 2, 0); // 淘汰 a
  eq(c.get("a", 1), undefined, "cap1 a evicted");
  eq(c.get("b", 1), 2, "cap1 b alive");
}

// --- 19. get 过期后腾出空间，后续 set 不应再淘汰活跃项 ---
{
  const c = new Cache(2, 10);
  c.set("a", 1, 0); // 过期 @10
  c.set("b", 2, 0, 1000); // 长命
  eq(c.get("a", 10), undefined, "a expired on get");
  // 现在 size=1，插入 c 不应淘汰 b
  c.set("c", 3, 10);
  eq(c.get("b", 10), 2, "b survives, room freed by expiry get");
  eq(c.get("c", 10), 3, "c alive");
}

// --- 20. 大量数据 + 顺序稳定性 ---
{
  const N = 5000;
  const c = new Cache(N, 1_000_000);
  for (let i = 0; i < N; i++) c.set(i, i * 2, 0);
  // 触碰前半段，使其变为最近使用
  for (let i = 0; i < N / 2; i++) eq(c.get(i, 1), i * 2, `large get ${i}`);
  // 现在再插入 N/2 个新 key，应淘汰后半段（最久未用）
  for (let i = N; i < N + N / 2; i++) c.set(i, i, 2);
  // 前半段仍在
  eq(c.get(0, 3), 0, "front half survives");
  eq(c.get(N / 2 - 1, 3), (N / 2 - 1) * 2, "front half last survives");
  // 后半段被淘汰
  eq(c.get(N / 2, 3), undefined, "back half evicted");
  eq(c.get(N - 1, 3), undefined, "back half last evicted");
  eq(c.size, N, "size at capacity");
}

// --- 21. unicode key ---
{
  const c = new Cache(2, 1000);
  c.set("café☕", "x", 0);
  c.set("日本語🎌", "y", 0);
  eq(c.get("café☕", 1), "x", "unicode key 1");
  eq(c.get("日本語🎌", 1), "y", "unicode key 2");
}

console.log(`OK lru-ttl (${n} assertions)`);
process.exit(0);
