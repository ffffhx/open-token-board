import { decide } from "../src/rate-limit.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function eqArr(got, want, label) {
  n++;
  if (!Array.isArray(got)) fail(`${label}: not an array, got ${JSON.stringify(got)}`);
  if (got.length !== want.length || got.some((v, i) => v !== want[i])) {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function allBool(got, label) {
  n++;
  if (!Array.isArray(got) || got.some((v) => typeof v !== "boolean")) {
    fail(`${label}: result must be boolean[], got ${JSON.stringify(got)}`);
  }
}

// --- 1. 空输入 ---
eqArr(decide([], 5, 10), [], "empty events -> empty");
eqArr(decide([], 0, 10), [], "empty events limit 0");

// --- 2. limit = 0：任何请求都被拒 ---
eqArr(decide([0, 1, 2], 0, 10), [false, false, false], "limit 0 denies all");
eqArr(decide([0], 0, 1), [false], "limit 0 single");
allBool(decide([0, 1, 2], 0, 10), "limit 0 returns booleans");

// --- 3. limit 充足：全部允许 ---
eqArr(decide([0, 1, 2, 3], 10, 5), [true, true, true, true], "ample limit allows all");

// --- 4. 单请求 ---
eqArr(decide([100], 1, 50), [true], "single request allowed");
eqArr(decide([100], 0, 50), [false], "single request limit 0 denied");

// --- 5. 窗口左端开区间：t-windowMs 处的请求恰好滑出 ---
// t=10, windowMs=10 -> 窗口 (0, 10]；时间戳 0 不在窗口内。
eqArr(decide([0, 10], 1, 10), [true, true], "left edge is exclusive: ts at t-windowMs slides out");
// 对比：右端闭区间，t=10 的请求自身在窗口内。
// t=0 与 t=9 在 t=10 的窗口 (0,10] 内的只有 9（0 被排除）。
eqArr(decide([0, 9, 10], 1, 10), [true, false, true], "left-open right-closed boundary");

// --- 6. 窗口右端闭区间：同一时刻多请求互相计入 ---
// 三个请求都在 t=5，limit=2：前两个允许，第三个被拒。
eqArr(decide([5, 5, 5], 2, 10), [true, true, false], "same timestamp counts within window");
// windowMs 边界：t1=0,t2=10 间隔正好 windowMs；t=10 的窗口排除 t=0。
eqArr(decide([0, 5, 10], 2, 10), [true, true, true], "exactly-windowMs gap drops oldest");

// --- 7. 被拒请求不计入窗口 ---
// limit=1：t=0 允许；t=1 在窗口内已有 1 个已允许 -> 拒；t=1 被拒不占额度，
// 但 t=0 仍占用，故后续仍受 t=0 制约。
eqArr(decide([0, 1, 2], 1, 10), [true, false, false], "denied do not free capacity while allowed still in window");
// limit=2，连续紧密请求：被拒的不计数。
eqArr(decide([0, 1, 2, 3, 4], 2, 3), [true, true, false, true, true], "denied requests excluded from count");

// --- 8. 滑动窗口随时间释放额度 ---
// limit=1, windowMs=10。t=0 允许；t=10 时窗口 (0,10]，t=0 已滑出 -> 允许。
eqArr(decide([0, 10, 20], 1, 10), [true, true, true], "window slides, capacity recovers");
// t=0 允许，t=5 被拒（0 仍在窗口），t=11 允许（0 滑出，5 被拒未计）。
eqArr(decide([0, 5, 11], 1, 10), [true, false, true], "recover after oldest allowed exits");

// --- 9. 大 limit 与稀疏时间戳 ---
eqArr(
  decide([0, 100, 200, 300], 2, 50),
  [true, true, true, true],
  "sparse timestamps never overlap window",
);

// --- 10. 较复杂的连续场景 ---
// limit=3, windowMs=5. timestamps 0..9
// 逐步推演（窗口 (t-5, t]，仅计已允许）：
//  t0=0: in=0 -> allow            allowed{0}
//  t1=1: in{0}=1 -> allow         allowed{0,1}
//  t2=2: in{0,1}=2 -> allow       allowed{0,1,2}
//  t3=3: in{0,1,2}=3 -> 3+1=4>3 deny
//  t4=4: in{0,1,2}=3 -> deny
//  t5=5: 窗口(0,5]，已允许{1,2}(0 排除)=2 -> allow  allowed{...,5}
//  t6=6: 窗口(1,6]，{2,5}=2 -> allow               allowed{...,6}
//  t7=7: 窗口(2,7]，{5,6}=2 -> allow               allowed{...,7}
//  t8=8: 窗口(3,8]，{5,6,7}=3 -> deny
//  t9=9: 窗口(4,9]，{5,6,7}=3 -> deny
eqArr(
  decide([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 5),
  [true, true, true, false, false, true, true, true, false, false],
  "complex sliding scenario",
);

// --- 11. 重复时间戳成片 ---
// 全部 t=0，limit=4，windowMs=1000：前 4 个允许，其余拒。
{
  const events = new Array(10).fill(0);
  const want = events.map((_, i) => i < 4);
  eqArr(decide(events, 4, 1000), want, "burst at same timestamp respects limit");
}

// --- 12. windowMs = 1 的极端 ---
// 窗口 (t-1, t]。相邻整数时刻互不重叠（除非同刻）。
eqArr(decide([0, 1, 2, 3], 1, 1), [true, true, true, true], "windowMs 1 non-overlapping ints");
eqArr(decide([0, 0, 1, 1], 1, 1), [true, false, true, false], "windowMs 1 same-instant pairs");

// --- 13. 返回类型必须是 boolean[] ---
allBool(decide([0, 1, 2, 3, 4], 2, 3), "result is boolean[]");

// --- 14. 性能/规模：单调时间戳，不应超时或栈溢出 ---
{
  const N = 20000;
  const events = new Array(N);
  for (let i = 0; i < N; i++) events[i] = i; // 0..N-1
  const limit = 5;
  const windowMs = 10;
  const res = decide(events, limit, windowMs);
  n++;
  if (res.length !== N) fail(`large: length ${res.length} != ${N}`);
  // 参考实现（O(n) 滑窗，仅计已允许）独立复算
  const ref = new Array(N);
  const allowed = [];
  let head = 0;
  for (let i = 0; i < N; i++) {
    const t = events[i];
    const lo = t - windowMs;
    while (head < allowed.length && allowed[head] <= lo) head++;
    if (allowed.length - head + 1 <= limit) {
      ref[i] = true;
      allowed.push(t);
    } else {
      ref[i] = false;
    }
  }
  n++;
  for (let i = 0; i < N; i++) {
    if (res[i] !== ref[i]) fail(`large: mismatch at i=${i} got ${res[i]} want ${ref[i]}`);
  }
}

// --- 15. 随机对拍：与独立参考实现一致 ---
{
  // 简单可复现 PRNG（mulberry32）。
  let s = 0x9e3779b9 >>> 0;
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let trial = 0; trial < 200; trial++) {
    const len = Math.floor(rnd() * 30);
    const events = [];
    let cur = Math.floor(rnd() * 5);
    for (let i = 0; i < len; i++) {
      cur += Math.floor(rnd() * 4); // 升序，可能相等
      events.push(cur);
    }
    const limit = Math.floor(rnd() * 4); // 0..3
    const windowMs = 1 + Math.floor(rnd() * 8); // 1..8
    const got = decide(events, limit, windowMs);
    // 参考实现
    const ref = new Array(events.length);
    const allowed = [];
    let head = 0;
    for (let i = 0; i < events.length; i++) {
      const t = events[i];
      const lo = t - windowMs;
      while (head < allowed.length && allowed[head] <= lo) head++;
      if (allowed.length - head + 1 <= limit) {
        ref[i] = true;
        allowed.push(t);
      } else {
        ref[i] = false;
      }
    }
    eqArr(got, ref, `random trial ${trial} (lim=${limit},win=${windowMs},ev=${JSON.stringify(events)})`);
  }
}

console.log(`OK sliding-rate-limit (${n} assertions)`);
process.exit(0);
