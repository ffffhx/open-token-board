/**
 * topoSort — 对有向图执行拓扑排序（Kahn 算法，升序 ID 打破平局）。
 *
 * @param {string[]} nodes  — 图中全部节点 ID（不重复）
 * @param {[string, string][]} edges — 有向边列表，每个元素为 [from, to]
 * @returns {string[] | null}
 *   - 无环：返回合法拓扑序（同入度为 0 时按节点 ID 字典升序打破平局）
 *   - 有环：返回 null
 */
export function topoSort(nodes, edges) {
  // Build adjacency list and in-degree map
  const inDegree = new Map();
  const adj = new Map();

  for (const n of nodes) {
    inDegree.set(n, 0);
    adj.set(n, []);
  }

  for (const [from, to] of edges) {
    adj.get(from).push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // Collect all zero-in-degree nodes, sorted ascending for determinism
  const queue = nodes.filter((n) => inDegree.get(n) === 0).sort();

  const result = [];

  while (queue.length > 0) {
    // Take the lexicographically smallest available node
    const node = queue.shift();
    result.push(node);

    // Reduce in-degree of neighbors; add to queue if now zero
    const newZero = [];
    for (const neighbor of adj.get(node)) {
      const deg = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        newZero.push(neighbor);
      }
    }

    // Insert new zero-degree nodes in sorted position to maintain order
    if (newZero.length > 0) {
      newZero.sort();
      // Merge into queue (queue is always sorted)
      for (const n of newZero) {
        // Binary insert to keep queue sorted
        let lo = 0, hi = queue.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (queue[mid] < n) lo = mid + 1;
          else hi = mid;
        }
        queue.splice(lo, 0, n);
      }
    }
  }

  // If not all nodes processed, there's a cycle
  if (result.length !== nodes.length) {
    return null;
  }

  return result;
}
