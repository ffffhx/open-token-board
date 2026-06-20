// runPool(tasks, limit)：受限并发地执行一组异步任务。
//
// 契约见 prompt / verify。
export function runPool(tasks, limit) {
  // 入参类型校验放在同步阶段，直接抛出（不是 reject）。
  if (!Array.isArray(tasks)) {
    throw new TypeError("tasks must be an array");
  }
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    throw new TypeError("limit must be an integer");
  }

  return new Promise((resolve, reject) => {
    const n = tasks.length;

    // 空数组：无论 limit 为何值都直接 resolve 成 []。
    if (n === 0) {
      resolve([]);
      return;
    }

    // 非空但 limit <= 0：无法启动任何任务，属于非法用法。
    if (limit <= 0) {
      reject(new RangeError("limit must be a positive integer when tasks is non-empty"));
      return;
    }

    const results = new Array(n);
    let nextIndex = 0; // 下一个要启动的任务下标
    let running = 0; // 当前运行中的任务数
    let settledCount = 0; // 已结算（完成或失败）的任务数

    // 第一个错误：按输入下标取最小者。Infinity 表示尚无错误。
    let firstErrorIndex = Infinity;
    let firstError = undefined;
    let outcomeDelivered = false; // 是否已经对外 resolve/reject

    const finalize = () => {
      if (outcomeDelivered) return;
      // 只有当所有已启动的任务都结算完毕才能收尾：
      // - 错误模式：所有在飞任务结算后 reject（让已启动任务自然 settle）。
      // - 正常模式：所有任务完成后 resolve。
      if (running !== 0) return;
      if (firstErrorIndex !== Infinity) {
        outcomeDelivered = true;
        reject(firstError);
        return;
      }
      if (settledCount === n) {
        outcomeDelivered = true;
        resolve(results);
      }
    };

    const launchMore = () => {
      // 一旦进入错误模式，就不再启动新任务。
      while (firstErrorIndex === Infinity && running < limit && nextIndex < n) {
        const i = nextIndex++;
        running++;
        const thunk = tasks[i];

        // 同步保护：thunk 不是函数 / 调用即抛出，都算作该下标的失败，
        // 但不能让整个 runPool 同步抛出，要走错误传播路径。
        let p;
        try {
          if (typeof thunk !== "function") {
            throw new TypeError(`tasks[${i}] is not a function`);
          }
          p = Promise.resolve(thunk());
        } catch (err) {
          p = Promise.reject(err);
        }

        p.then(
          (value) => {
            results[i] = value;
            running--;
            settledCount++;
            launchMore();
            finalize();
          },
          (err) => {
            running--;
            settledCount++;
            if (i < firstErrorIndex) {
              firstErrorIndex = i;
              firstError = err;
            }
            finalize();
          },
        );
      }
    };

    launchMore();
  });
}
