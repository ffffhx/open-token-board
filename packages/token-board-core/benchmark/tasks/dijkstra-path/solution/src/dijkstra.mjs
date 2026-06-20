/**
 * 单源最短路径（Dijkstra），在等价最短路径中返回字典序最小的路径。
 *
 * 节点为 0..n-1；edges 为有向边数组 [u, v, w]，w 为非负整数，允许重边与自环。
 * 若 dst 从 src 不可达返回 null，否则返回 { dist, path }。
 * 路径用节点编号序列表示，按字典序比较取最小者。
 * 非法输入（边权为负、节点越界、参数类型不合法）抛出异常。
 */

// 比较两条路径（节点编号数组）的字典序：返回 <0 / 0 / >0
function comparePath(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// 比较状态 (dist, path)：先比 dist，再比路径字典序。
function compareState(da, pa, db, pb) {
  if (da !== db) return da < db ? -1 : 1;
  return comparePath(pa, pb);
}

class MinHeap {
  constructor() {
    this._a = [];
  }
  get size() {
    return this._a.length;
  }
  push(item) {
    const a = this._a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (compareState(a[i].dist, a[i].path, a[p].dist, a[p].path) < 0) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this._a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const len = a.length;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < len && compareState(a[l].dist, a[l].path, a[smallest].dist, a[smallest].path) < 0) smallest = l;
        if (r < len && compareState(a[r].dist, a[r].path, a[smallest].dist, a[smallest].path) < 0) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
}

export function shortestPath(n, edges, src, dst) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("n must be a positive integer");
  }
  if (!Array.isArray(edges)) {
    throw new Error("edges must be an array");
  }
  if (!Number.isInteger(src) || src < 0 || src >= n) {
    throw new Error("src out of range");
  }
  if (!Number.isInteger(dst) || dst < 0 || dst >= n) {
    throw new Error("dst out of range");
  }

  // 构建邻接表，同时校验每条边。
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 3) {
      throw new Error("edge must be [u, v, w]");
    }
    const [u, v, w] = e;
    if (!Number.isInteger(u) || u < 0 || u >= n) {
      throw new Error("edge endpoint u out of range");
    }
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new Error("edge endpoint v out of range");
    }
    if (!Number.isInteger(w) || w < 0) {
      throw new Error("edge weight must be a non-negative integer");
    }
    adj[u].push([v, w]);
  }

  // src === dst：路径为 [src]，距离 0。
  if (src === dst) {
    return { dist: 0, path: [src] };
  }

  const bestDist = new Array(n).fill(Infinity);
  const bestPath = new Array(n).fill(null);
  const finalized = new Array(n).fill(false);

  bestDist[src] = 0;
  bestPath[src] = [src];

  const heap = new MinHeap();
  heap.push({ node: src, dist: 0, path: [src] });

  while (heap.size > 0) {
    const cur = heap.pop();
    const u = cur.node;
    if (finalized[u]) continue;
    // 只有当弹出的状态与该节点当前最优状态一致时才确定它。
    if (cur.dist !== bestDist[u] || comparePath(cur.path, bestPath[u]) !== 0) {
      continue;
    }
    finalized[u] = true;

    for (const [v, w] of adj[u]) {
      if (finalized[v]) continue;
      const nd = cur.dist + w;
      // 候选路径 = 当前节点最优路径 + v
      const np = cur.path.concat(v);
      if (
        nd < bestDist[v] ||
        (nd === bestDist[v] && comparePath(np, bestPath[v]) < 0)
      ) {
        bestDist[v] = nd;
        bestPath[v] = np;
        heap.push({ node: v, dist: nd, path: np });
      }
    }
  }

  if (bestPath[dst] === null) {
    return null;
  }
  return { dist: bestDist[dst], path: bestPath[dst] };
}

export default shortestPath;
