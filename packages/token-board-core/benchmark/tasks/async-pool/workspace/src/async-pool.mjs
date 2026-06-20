// runPool(tasks, limit)：受限并发地执行一组异步任务。
//
// - tasks 是一个"thunk 数组"，每个元素是一个无参函数，调用后返回一个 Promise
//   （也可能直接返回非 Promise 的同步值）。
// - limit 是允许同时处于"运行中"状态的任务数上限。
// - runPool 返回一个 Promise，resolve 成一个与输入 **顺序一致** 的结果数组
//   （即 results[i] 对应 tasks[i] 的返回值，而不是按完成先后排列）。
// - 任意时刻并发数不得超过 limit。
//
// 详细契约见 prompt。下面是一个未实现的占位实现。
export async function runPool(tasks, limit) {
  throw new Error("not implemented");
}
