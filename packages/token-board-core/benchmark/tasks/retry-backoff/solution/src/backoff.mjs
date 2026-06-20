/**
 * 计算指数退避等待时间（毫秒）。
 *
 * 公式：min(baseMs * 2^(attempt - 1), capMs)
 *
 * @param {number} attempt  - 当前重试次数，从 1 开始（第 1 次重试 => attempt=1）
 * @param {number} baseMs   - 基础等待时间（毫秒）
 * @param {number} capMs    - 最大等待时间上限（毫秒）
 * @returns {number}        - 本次应等待的毫秒数
 */
export function computeBackoffMs(attempt, baseMs, capMs) {
  return Math.min(baseMs * Math.pow(2, attempt - 1), capMs);
}
