/**
 * 纯函数版防抖调度器：给定一批事件时间戳，返回哪些时间戳会真正触发回调。
 *
 * @param {number[]} events  - 已排序（升序）的事件时间戳数组（毫秒）
 * @param {number}   waitMs  - 防抖等待时长（毫秒）
 * @param {object}   options
 * @param {boolean}  options.leading - true = 前沿触发，false = 后沿触发（默认 false）
 * @returns {number[]} 会实际触发回调的时间戳列表（升序）
 *
 * 规则：
 *   - 把时间轴上相邻间隔 < waitMs 的事件分为同一个"爆发组"。
 *   - leading=false（后沿）：每组最后一个事件触发。
 *   - leading=true （前沿）：每组第一个事件触发。
 */
export function shouldFire(events, waitMs, { leading = false } = {}) {
  if (events.length === 0) return [];

  const fired = [];

  if (!leading) {
    // 后沿模式：当下一个事件距当前事件 >= waitMs 时（或已是最后一个），触发当前事件
    for (let i = 0; i < events.length; i++) {
      const isLast = i === events.length - 1;
      const gap = isLast ? Infinity : events[i + 1] - events[i];
      if (gap >= waitMs) {
        fired.push(events[i]);
      }
    }
  } else {
    // 前沿模式（BUG）：错误地使用了后沿逻辑，在每组最后一个事件触发，而非第一个
    for (let i = 0; i < events.length; i++) {
      const isLast = i === events.length - 1;
      const gap = isLast ? Infinity : events[i + 1] - events[i];
      if (gap >= waitMs) {
        fired.push(events[i]);
      }
    }
  }

  return fired;
}
