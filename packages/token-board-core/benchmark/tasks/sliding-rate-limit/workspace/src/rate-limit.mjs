// 纯滑动窗口限流器。
// decide(events, limit, windowMs) -> boolean[]
// events: 升序的整数毫秒时间戳数组（请求到达时刻）。
// 对每个请求 t，统计"此前被允许、且仍落在窗口 (t-windowMs, t] 内"的请求数；
// 若 这些已允许请求数 + 当前请求 <= limit，则当前请求被允许（true），否则拒绝（false）。
// 被拒绝的请求不计入窗口。窗口左开右闭：时间 s 计入当且仅当 s > t-windowMs 且 s <= t。
export function decide(events, limit, windowMs) {
  const result = [];
  // 记录所有请求的时间戳（用来判断是否还在窗口内）。
  const seen = [];

  for (let i = 0; i < events.length; i++) {
    const t = events[i];
    // 统计窗口内的请求数量：窗口为 [t-windowMs, t]
    let count = 0;
    for (let j = 0; j < seen.length; j++) {
      if (seen[j] >= t - windowMs) {
        count++;
      }
    }
    if (count < limit) {
      result.push(true);
      seen.push(t);
    } else {
      result.push(false);
      seen.push(t);
    }
  }

  return result;
}
