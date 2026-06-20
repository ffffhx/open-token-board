import { shouldFire } from "../src/debounce.mjs";

// 工具函数：深度比较数组
function arrEq(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

const cases = [
  // [events, waitMs, options, expected, description]

  // ── 后沿模式（trailing）────────────────────────────────────────────────
  // 单个事件，直接触发
  [[100], 50, { leading: false }, [100], "trailing: 单个事件应触发"],

  // 两个事件间隔 < waitMs，只有最后一个触发
  [[100, 130], 50, { leading: false }, [130], "trailing: 同一爆发组，只触发最后一个"],

  // 两组爆发，各触发最后一个
  [[100, 130, 300, 320], 50, { leading: false }, [130, 320],
    "trailing: 两组爆发各自触发最后一个"],

  // 间隔恰好等于 waitMs，视为新组（gap >= waitMs 则截断）
  [[100, 150], 50, { leading: false }, [100, 150],
    "trailing: 间隔恰好等于 waitMs，各自独立触发"],

  // ── 前沿模式（leading）────────────────────────────────────────────────
  // 单个事件，直接触发
  [[200], 50, { leading: true }, [200], "leading: 单个事件应触发"],

  // 两个事件间隔 < waitMs，只有第一个触发
  [[200, 230], 50, { leading: true }, [200], "leading: 同一爆发组，只触发第一个"],

  // 三次爆发，各触发第一个事件
  [[10, 20, 30, 200, 210, 500], 50, { leading: true }, [10, 200, 500],
    "leading: 三组爆发各自触发第一个"],

  // 间隔恰好等于 waitMs，视为新组
  [[100, 150], 50, { leading: true }, [100, 150],
    "leading: 间隔恰好等于 waitMs，各自独立触发"],

  // 空数组
  [[], 50, { leading: true }, [], "leading: 空数组返回空"],
  [[], 50, { leading: false }, [], "trailing: 空数组返回空"],
];

let failed = false;
for (const [events, waitMs, opts, expected, desc] of cases) {
  const got = shouldFire(events, waitMs, opts);
  if (!arrEq(got, expected)) {
    console.error(
      `FAIL [${desc}]: shouldFire(${JSON.stringify(events)}, ${waitMs}, ${JSON.stringify(opts)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("OK debounce-leading");
process.exit(0);
