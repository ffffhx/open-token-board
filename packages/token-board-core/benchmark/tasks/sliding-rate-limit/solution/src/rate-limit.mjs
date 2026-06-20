// 纯滑动窗口限流器。
// decide(events, limit, windowMs) -> boolean[]
// events: 升序的整数毫秒时间戳数组（请求到达时刻）。
// 对每个请求 t，统计"此前被允许、且仍落在窗口 (t-windowMs, t] 内"的请求数；
// 若 这些已允许请求数 + 当前请求 <= limit，则当前请求被允许（true），否则拒绝（false）。
// 被拒绝的请求不计入窗口。窗口左开右闭：时间 s 计入当且仅当 s > t-windowMs 且 s <= t。
export function decide(events, limit, windowMs) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative integer");
  }
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new RangeError("windowMs must be a positive integer");
  }

  for (let i = 0; i < events.length; i++) {
    const t = events[i];
    if (!Number.isInteger(t)) {
      throw new TypeError("events must contain only integer timestamps");
    }
    if (i > 0 && t < events[i - 1]) {
      throw new RangeError("events must be in ascending order");
    }
  }

  const result = new Array(events.length);
  // 仅保存"已允许"请求的时间戳。
  const allowed = [];
  let head = 0; // allowed 中第一个仍可能在窗口内的下标

  for (let i = 0; i < events.length; i++) {
    const t = events[i];
    const lowerExclusive = t - windowMs;
    // 移除所有 <= t-windowMs 的已允许请求（窗口左端是开区间）。
    while (head < allowed.length && allowed[head] <= lowerExclusive) {
      head++;
    }
    const inWindow = allowed.length - head;
    if (inWindow + 1 <= limit) {
      result[i] = true;
      allowed.push(t);
    } else {
      result[i] = false;
    }
  }

  return result;
}
