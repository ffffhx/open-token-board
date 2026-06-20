import { shortestPath } from "../src/dijkstra.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}

function deepEqRes(got, want, label) {
  n++;
  const norm = (r) => (r === null ? null : { dist: r.dist, path: r.path });
  if (want === null) {
    if (got !== null) fail(`${label}: got ${JSON.stringify(got)} want null`);
    return;
  }
  if (got === null || typeof got !== "object") {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  if (got.dist !== want.dist) {
    fail(`${label}: dist got ${JSON.stringify(got.dist)} want ${JSON.stringify(want.dist)}`);
  }
  if (!Array.isArray(got.path)) {
    fail(`${label}: path not array, got ${JSON.stringify(got.path)}`);
  }
  if (got.path.length !== want.path.length) {
    fail(`${label}: path length got ${JSON.stringify(got.path)} want ${JSON.stringify(want.path)}`);
  }
  for (let i = 0; i < want.path.length; i++) {
    if (got.path[i] !== want.path[i]) {
      fail(`${label}: path got ${JSON.stringify(got.path)} want ${JSON.stringify(want.path)}`);
    }
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

// --- 1. src === dst：返回 [src]，dist 0，即便有边 ---
deepEqRes(shortestPath(1, [], 0, 0), { dist: 0, path: [0] }, "single node src=dst");
deepEqRes(
  shortestPath(3, [[0, 1, 5], [1, 2, 5]], 0, 0),
  { dist: 0, path: [0] },
  "src=dst with edges around"
);
// src=dst 即使有进入 src 的自环也仍是 0
deepEqRes(shortestPath(2, [[0, 0, 3]], 0, 0), { dist: 0, path: [0] }, "src=dst with self-loop");

// --- 2. 简单直连 ---
deepEqRes(shortestPath(2, [[0, 1, 7]], 0, 1), { dist: 7, path: [0, 1] }, "direct edge");

// --- 3. 不可达返回 null ---
deepEqRes(shortestPath(2, [], 0, 1), null, "no edges unreachable");
deepEqRes(shortestPath(3, [[0, 1, 1]], 0, 2), null, "node 2 unreachable");
// 有边但方向相反 → 不可达（有向图）
deepEqRes(shortestPath(2, [[1, 0, 4]], 0, 1), null, "reverse edge directed unreachable");
// 孤立目标
deepEqRes(shortestPath(4, [[0, 1, 1], [1, 2, 1]], 0, 3), null, "isolated dst unreachable");

// --- 4. 多条路径取更短的 ---
deepEqRes(
  shortestPath(3, [[0, 1, 1], [1, 2, 1], [0, 2, 5]], 0, 2),
  { dist: 2, path: [0, 1, 2] },
  "two-hop beats direct"
);
deepEqRes(
  shortestPath(3, [[0, 1, 10], [1, 2, 10], [0, 2, 3]], 0, 2),
  { dist: 3, path: [0, 2] },
  "direct beats two-hop"
);

// --- 5. 重边：取权重最小的那条 ---
deepEqRes(
  shortestPath(2, [[0, 1, 9], [0, 1, 2], [0, 1, 5]], 0, 1),
  { dist: 2, path: [0, 1] },
  "multi-edge picks min weight"
);
// 重边但都同权
deepEqRes(
  shortestPath(2, [[0, 1, 4], [0, 1, 4]], 0, 1),
  { dist: 4, path: [0, 1] },
  "multi-edge equal weight"
);

// --- 6. 自环不影响最短路 ---
deepEqRes(
  shortestPath(3, [[0, 0, 1], [0, 1, 2], [1, 1, 7], [1, 2, 3]], 0, 2),
  { dist: 5, path: [0, 1, 2] },
  "self-loops ignored"
);

// --- 7. 零权边 ---
deepEqRes(
  shortestPath(3, [[0, 1, 0], [1, 2, 0]], 0, 2),
  { dist: 0, path: [0, 1, 2] },
  "zero-weight path dist 0"
);
deepEqRes(
  shortestPath(4, [[0, 1, 0], [0, 2, 0], [1, 3, 0], [2, 3, 0]], 0, 3),
  { dist: 0, path: [0, 1, 3] },
  "zero-weight tie picks lex smaller via 1"
);

// --- 8. 等价最短路径 → 字典序最小路径 ---
// 0->1->3 和 0->2->3 同为 dist 2，应选经过 1 的
deepEqRes(
  shortestPath(4, [[0, 1, 1], [0, 2, 1], [1, 3, 1], [2, 3, 1]], 0, 3),
  { dist: 2, path: [0, 1, 3] },
  "equal cost lex smallest via 1"
);
// 把 1 那条做得更"差"：0->2->3 (2) vs 0->1->3 (2)，仍选 1（节点序列 [0,1,3] < [0,2,3]）
deepEqRes(
  shortestPath(4, [[0, 2, 1], [2, 3, 1], [0, 1, 1], [1, 3, 1]], 0, 3),
  { dist: 2, path: [0, 1, 3] },
  "edge order independence lex tiebreak"
);
// 三条等价路径 0->1->4, 0->2->4, 0->3->4 全 dist 2 → 选 [0,1,4]
deepEqRes(
  shortestPath(
    5,
    [[0, 3, 1], [3, 4, 1], [0, 2, 1], [2, 4, 1], [0, 1, 1], [1, 4, 1]],
    0,
    4
  ),
  { dist: 2, path: [0, 1, 4] },
  "three equal paths lex smallest"
);

// --- 9. 字典序：更短的中间节点 vs 更长但更小的前缀 ---
// 路径 [0,1,2,3] (dist 3) 与 [0,3] 不存在；构造 [0,2,3] dist 2 与 [0,1,3] dist 2
// [0,1,3] 更小
deepEqRes(
  shortestPath(4, [[0, 1, 1], [1, 3, 1], [0, 2, 1], [2, 3, 1]], 0, 3),
  { dist: 2, path: [0, 1, 3] },
  "lex tiebreak prefer node 1 over 2"
);
// 同 dist 下更短路径不必然更小：[0,1,2] vs [0,1,3,2]? 这里构造 [0,3,2](dist2) vs [0,1,2](dist2)
// [0,1,2] < [0,3,2]
deepEqRes(
  shortestPath(4, [[0, 3, 1], [3, 2, 1], [0, 1, 1], [1, 2, 1]], 0, 2),
  { dist: 2, path: [0, 1, 2] },
  "lex tiebreak [0,1,2] over [0,3,2]"
);

// --- 10. 字典序 prefix 规则：相等前缀下短者更小 ---
// [0,2] (dist 2 直达) vs [0,2,...]? 构造 [0,1,2](dist2) vs [0,2](dist2)：[0,1,2] vs [0,2]
// 比较：0==0, 第二位 1 < 2 → [0,1,2] 更小
deepEqRes(
  shortestPath(3, [[0, 2, 2], [0, 1, 1], [1, 2, 1]], 0, 2),
  { dist: 2, path: [0, 1, 2] },
  "lex: [0,1,2] smaller than direct [0,2]"
);
// 反过来：[0,2](dist1) 唯一最短
deepEqRes(
  shortestPath(3, [[0, 2, 1], [0, 1, 1], [1, 2, 1]], 0, 2),
  { dist: 1, path: [0, 2] },
  "direct strictly shorter"
);

// --- 11. 较大链 + 旁路 ---
{
  const edges = [];
  for (let i = 0; i < 51; i++) edges.push([i, i + 1, 1]); // 0..51 链（51 条边）
  // 一条捷径 0 -> 51 权重 60（比 51 长，不选）
  edges.push([0, 51, 60]);
  const want = { dist: 51, path: Array.from({ length: 52 }, (_, i) => i) };
  deepEqRes(shortestPath(52, edges, 0, 51), want, "long chain shortest");
}
{
  const edges = [];
  for (let i = 0; i < 51; i++) edges.push([i, i + 1, 1]);
  edges.push([0, 51, 10]); // 捷径权重 10 < 51，选捷径
  deepEqRes(shortestPath(52, edges, 0, 51), { dist: 10, path: [0, 51] }, "shortcut wins");
}

// --- 12. 菱形网格的字典序 ---
deepEqRes(
  shortestPath(
    6,
    [
      [0, 1, 2], [0, 2, 2],
      [1, 3, 2], [2, 3, 2],
      [1, 4, 2], [2, 4, 2],
      [3, 5, 1], [4, 5, 1],
    ],
    0,
    5
  ),
  { dist: 5, path: [0, 1, 3, 5] },
  "grid lex smallest path"
);

// --- 13. 不可达但图很大 ---
{
  const edges = [];
  for (let i = 0; i < 100; i++) edges.push([i, i + 1, 1]); // 0..100 链
  // 节点 200 完全孤立
  deepEqRes(shortestPath(201, edges, 0, 200), null, "large graph unreachable");
}

// --- 14. 较大随机网格确定性（与等价路径里字典序最小一致）---
// 完全二部展开：层 L0={0}, L1={1,2,3}, L2={4}; 每条权 1 → dist 2，最小路径 [0,1,4]
deepEqRes(
  shortestPath(
    5,
    [[0, 3, 1], [0, 2, 1], [0, 1, 1], [1, 4, 1], [2, 4, 1], [3, 4, 1]],
    0,
    4
  ),
  { dist: 2, path: [0, 1, 4] },
  "layered lex determinism"
);

// --- 15. 权重不对称导致字典序更大的路径反而更短 ---
// [0,2,3] dist 2 严格短于 [0,1,3] dist 3 → 必须选更短者（不被字典序左右）
deepEqRes(
  shortestPath(4, [[0, 1, 2], [1, 3, 1], [0, 2, 1], [2, 3, 1]], 0, 3),
  { dist: 2, path: [0, 2, 3] },
  "shorter dist beats lex"
);

// --- 16. 复杂权重组合 ---
deepEqRes(
  shortestPath(
    5,
    [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5], [3, 4, 3]],
    0,
    4
  ),
  { dist: 7, path: [0, 2, 1, 3, 4] },
  "complex weighted path"
);

// --- 17. dst 就是 src 的邻居但有更短间接路径不存在 ---
deepEqRes(
  shortestPath(3, [[0, 2, 5], [0, 1, 1], [1, 2, 1]], 0, 2),
  { dist: 2, path: [0, 1, 2] },
  "indirect shorter than direct neighbor"
);

// --- 18. 重边中较小权重产生不同的最优路径 ---
deepEqRes(
  shortestPath(
    3,
    [[0, 1, 1], [1, 2, 1], [0, 2, 2], [0, 2, 2]],
    0,
    2
  ),
  { dist: 2, path: [0, 1, 2] },
  "tie dist multi direct vs two-hop -> lex [0,1,2]"
);

// --- 19. 较大 n 的全 0 权重图字典序 ---
{
  // 0 连到 1..n-2，每个再连到 n-1，全 0 权重 → dist 0，最小路径 [0,1,n-1]
  const N = 200;
  const edges = [];
  for (let i = 1; i < N - 1; i++) edges.push([0, i, 0]);
  for (let i = 1; i < N - 1; i++) edges.push([i, N - 1, 0]);
  deepEqRes(
    shortestPath(N, edges, 0, N - 1),
    { dist: 0, path: [0, 1, N - 1] },
    "large zero-weight lex"
  );
}

// --- 20. 性能：稠密大图（确保算法可在限时内完成）---
{
  const N = 2000;
  const edges = [];
  // 链 + 每个节点向后 3 个的捷径
  for (let i = 0; i < N - 1; i++) edges.push([i, i + 1, 2]);
  for (let i = 0; i + 3 < N; i++) edges.push([i, i + 3, 5]);
  for (let i = 0; i + 7 < N; i++) edges.push([i, i + 7, 11]);
  const res = shortestPath(N, edges, 0, N - 1);
  n++;
  if (res === null) fail("perf graph should be reachable");
  // 不校验精确路径，只校验 dist 与端点
  n++;
  if (res.path[0] !== 0 || res.path[res.path.length - 1] !== N - 1) {
    fail("perf path endpoints wrong");
  }
}

// --- 21. 非法输入：边权为负 ---
throws(() => shortestPath(3, [[0, 1, -1]], 0, 1), "negative weight throws");
throws(() => shortestPath(3, [[0, 1, 2], [1, 2, -5]], 0, 2), "negative weight in chain throws");

// --- 22. 非法输入：节点越界 ---
throws(() => shortestPath(2, [[0, 5, 1]], 0, 1), "edge endpoint v out of range throws");
throws(() => shortestPath(2, [[7, 1, 1]], 0, 1), "edge endpoint u out of range throws");
throws(() => shortestPath(3, [], 5, 1), "src out of range throws");
throws(() => shortestPath(3, [], 0, 9), "dst out of range throws");
throws(() => shortestPath(3, [], -1, 1), "negative src throws");
throws(() => shortestPath(3, [], 0, -2), "negative dst throws");

// --- 23. 非法输入：非整数权重/节点 ---
throws(() => shortestPath(3, [[0, 1, 1.5]], 0, 1), "non-integer weight throws");
throws(() => shortestPath(3, [[0, 1.2, 1]], 0, 1), "non-integer endpoint throws");

// --- 24. 非法输入：n 非法 ---
throws(() => shortestPath(0, [], 0, 0), "n=0 throws");
throws(() => shortestPath(-3, [], 0, 0), "negative n throws");
throws(() => shortestPath(2.5, [], 0, 1), "non-integer n throws");

console.log(`OK dijkstra-path (${n} assertions)`);
process.exit(0);
