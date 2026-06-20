/**
 * 分页工具函数
 *
 * getPageItems(items, page, pageSize)
 *   返回第 page 页（从 1 开始）的元素数组。
 *   例如 getPageItems([1,2,3,4,5], 1, 2) => [1, 2]
 *        getPageItems([1,2,3,4,5], 2, 2) => [3, 4]
 *
 * pageCount(total, pageSize)
 *   返回总页数。
 *   例如 pageCount(5, 2) => 3
 *        pageCount(4, 2) => 2
 *        pageCount(0, 10) => 0
 */

/**
 * @param {any[]} items
 * @param {number} page  - 从 1 开始
 * @param {number} pageSize
 * @returns {any[]}
 */
export function getPageItems(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = page * pageSize;
  return items.slice(start, end);
}

/**
 * @param {number} total
 * @param {number} pageSize
 * @returns {number}
 */
export function pageCount(total, pageSize) {
  if (total === 0) return 0;
  return Math.ceil(total / pageSize);
}
