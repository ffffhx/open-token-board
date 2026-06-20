/**
 * topoSort — 对有向图执行拓扑排序。
 *
 * @param {string[]} nodes  — 图中全部节点 ID（不重复）
 * @param {[string, string][]} edges — 有向边列表，每个元素为 [from, to]
 * @returns {string[] | null}
 *   - 无环：返回合法拓扑序（同入度为 0 时按节点 ID 字典升序打破平局）
 *   - 有环：返回 null
 */
export function topoSort(nodes, edges) {
  throw new Error("not implemented");
}
