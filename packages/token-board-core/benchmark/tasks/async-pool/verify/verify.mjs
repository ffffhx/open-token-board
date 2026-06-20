import { runPool } from "../src/async-pool.mjs";

let n = 0;
let unhandled = null;
process.on("unhandledRejection", (reason) => {
  unhandled = reason;
});

function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function eq(got, want, label) {
  n++;
  if (got !== want) {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function deepEq(got, want, label) {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function ok(cond, label) {
  n++;
  if (!cond) fail(label);
}

// 受控的 deferred：手动决定何时 resolve/reject，便于精确观测并发。
function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- 1. 基本：结果按输入顺序，即便完成顺序相反 ---
  {
    const order = [];
    const tasks = [
      () => sleep(40).then(() => { order.push("a"); return "a"; }),
      () => sleep(10).then(() => { order.push("b"); return "b"; }),
      () => sleep(20).then(() => { order.push("c"); return "c"; }),
    ];
    const res = await runPool(tasks, 3);
    deepEq(res, ["a", "b", "c"], "results in input order");
    deepEq(order, ["b", "c", "a"], "completion order differs from input order");
  }

  // --- 2. 空数组：resolve 成 [] ---
  {
    const res = await runPool([], 3);
    deepEq(res, [], "empty array -> []");
  }
  {
    const res = await runPool([], 0);
    deepEq(res, [], "empty array with limit 0 -> []");
  }

  // --- 3. 同步返回值（thunk 不返回 promise）也被支持 ---
  {
    const res = await runPool([() => 1, () => 2, () => 3], 1);
    deepEq(res, [1, 2, 3], "sync thunk values");
  }

  // --- 4. 并发上限被严格遵守：limit=2，5 个任务 ---
  {
    let running = 0;
    let maxRunning = 0;
    const mk = (val) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(15);
      running--;
      return val;
    };
    const res = await runPool([mk(0), mk(1), mk(2), mk(3), mk(4)], 2);
    deepEq(res, [0, 1, 2, 3, 4], "limit2 results");
    ok(maxRunning <= 2, `concurrency never exceeded limit (maxRunning=${maxRunning})`);
    ok(maxRunning === 2, `concurrency actually reached limit (maxRunning=${maxRunning})`);
  }

  // --- 5. limit 大于任务数：全部并发，仍按序返回 ---
  {
    let running = 0;
    let maxRunning = 0;
    const mk = (val, ms) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(ms);
      running--;
      return val;
    };
    const res = await runPool([mk("x", 30), mk("y", 5), mk("z", 15)], 100);
    deepEq(res, ["x", "y", "z"], "limit>n results order");
    ok(maxRunning === 3, `all 3 ran concurrently (maxRunning=${maxRunning})`);
  }

  // --- 6. limit=1：严格串行 ---
  {
    let running = 0;
    let maxRunning = 0;
    const seq = [];
    const mk = (val) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(8);
      seq.push(val);
      running--;
      return val;
    };
    const res = await runPool([mk(1), mk(2), mk(3)], 1);
    deepEq(res, [1, 2, 3], "serial results");
    deepEq(seq, [1, 2, 3], "serial execution order");
    ok(maxRunning === 1, `limit1 strictly serial (maxRunning=${maxRunning})`);
  }

  // --- 7. 非空数组 + limit<=0：必须 reject（无法启动任务） ---
  {
    let rejected = false;
    try {
      await runPool([() => 1], 0);
    } catch {
      rejected = true;
    }
    ok(rejected, "non-empty tasks with limit 0 rejects");
  }
  {
    let rejected = false;
    try {
      await runPool([() => 1, () => 2], -1);
    } catch {
      rejected = true;
    }
    ok(rejected, "non-empty tasks with negative limit rejects");
  }

  // --- 8. 失败：以输入下标最小者作为 firstError 拒绝 ---
  // 让较晚下标先 reject、较早下标后 reject，确保不是按完成顺序取。
  {
    const errEarly = new Error("err@1");
    const errLate = new Error("err@3");
    const tasks = [
      () => sleep(30).then(() => "ok0"),
      () => sleep(40).then(() => Promise.reject(errEarly)), // index 1，较慢
      () => sleep(50).then(() => "ok2"),
      () => sleep(5).then(() => Promise.reject(errLate)), // index 3，较快先 reject
    ];
    let caught = null;
    try {
      await runPool(tasks, 4);
    } catch (e) {
      caught = e;
    }
    ok(caught === errEarly, `rejects with FIRST error by input index (got ${caught && caught.message})`);
  }

  // --- 9. 多个错误中取下标最小，即使它最后才 settle ---
  {
    const e0 = new Error("e0");
    const e2 = new Error("e2");
    const tasks = [
      () => sleep(60).then(() => Promise.reject(e0)), // 最小下标、最慢
      () => sleep(10).then(() => "ok"),
      () => sleep(5).then(() => Promise.reject(e2)), // 较大下标、最快
    ];
    let caught = null;
    try {
      await runPool(tasks, 3);
    } catch (e) {
      caught = e;
    }
    ok(caught === e0, `lowest-index error wins even if slowest (got ${caught && caught.message})`);
  }

  // --- 10. 失败后让已启动的任务自然 settle，无 unhandledRejection ---
  // limit=2：启动 t0,t1；t0 立即 reject，t1 稍后也 reject；不应有未处理拒绝。
  {
    const e0 = new Error("boom0");
    const e1 = new Error("boom1");
    let t1Settled = false;
    const tasks = [
      () => sleep(5).then(() => Promise.reject(e0)),
      () => sleep(40).then(() => {
        t1Settled = true;
        return Promise.reject(e1);
      }),
      () => sleep(5).then(() => "never-started-as-fresh"), // 进入错误模式后不应启动
    ];
    let caught = null;
    try {
      await runPool(tasks, 2);
    } catch (e) {
      caught = e;
    }
    ok(caught === e0, "rejects with e0");
    // 等待足够长让 t1 settle，并让微/宏任务跑完，检测 unhandledRejection。
    await sleep(80);
    await new Promise((r) => setImmediate(r));
    ok(t1Settled, "already-started task allowed to settle");
    ok(unhandled === null, `no unhandledRejection (saw ${unhandled && unhandled.message})`);
  }

  // --- 11. 错误模式下不再启动未开始的新任务 ---
  {
    const e0 = new Error("fail0");
    let startedLate = false;
    const tasks = [
      () => sleep(5).then(() => Promise.reject(e0)), // index0 先失败
      () => sleep(5).then(() => "ok1"),
      () => { startedLate = true; return sleep(5).then(() => "ok2"); }, // 不应被启动
      () => { startedLate = true; return sleep(5).then(() => "ok3"); },
    ];
    let caught = null;
    try {
      await runPool(tasks, 1); // 串行：t0 失败后不再启动后续
    } catch (e) {
      caught = e;
    }
    ok(caught === e0, "serial first failure rejects");
    await sleep(30);
    ok(startedLate === false, "no new tasks launched after entering error mode");
  }

  // --- 12. thunk 同步抛出被当作该任务失败（不让 runPool 同步抛出） ---
  {
    const e = new Error("sync-throw");
    let caught = null;
    let synchronousThrow = false;
    try {
      const p = runPool([() => { throw e; }, () => "ok"], 2);
      // 到这里说明没有同步抛出
      try {
        await p;
      } catch (err) {
        caught = err;
      }
    } catch {
      synchronousThrow = true;
    }
    ok(synchronousThrow === false, "runPool does not throw synchronously for throwing thunk");
    ok(caught === e, "throwing thunk treated as task rejection");
  }

  // --- 13. 大规模：1000 个任务、limit=8，顺序与并发都正确 ---
  {
    const N = 1000;
    let running = 0;
    let maxRunning = 0;
    const tasks = [];
    for (let i = 0; i < N; i++) {
      tasks.push(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await sleep(i % 3); // 0,1,2 ms 抖动
        running--;
        return i * 2;
      });
    }
    const res = await runPool(tasks, 8);
    n++;
    for (let i = 0; i < N; i++) {
      if (res[i] !== i * 2) fail(`large: res[${i}] = ${res[i]} want ${i * 2}`);
    }
    ok(res.length === N, "large result length");
    ok(maxRunning <= 8, `large concurrency capped at 8 (maxRunning=${maxRunning})`);
    ok(maxRunning === 8, `large concurrency reached 8 (maxRunning=${maxRunning})`);
  }

  // --- 14. 顺序结果不含空洞且与输入一一对应（混合时延） ---
  {
    const tasks = [
      () => sleep(25).then(() => "p"),
      () => Promise.resolve("q"),
      () => sleep(10).then(() => "r"),
      () => "s",
    ];
    const res = await runPool(tasks, 2);
    deepEq(res, ["p", "q", "r", "s"], "mixed-latency input order");
  }

  if (unhandled !== null) {
    fail(`unhandledRejection detected at end: ${unhandled && unhandled.message}`);
  }
  console.log(`OK async-pool (${n} assertions)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`FAIL[#${n}] unexpected throw: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
