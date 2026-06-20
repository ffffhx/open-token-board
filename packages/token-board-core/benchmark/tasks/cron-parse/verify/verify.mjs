import { nextRun } from "../src/cron.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}

// UTC epoch seconds helper
function U(y, mo, d, h = 0, mi = 0, s = 0) {
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
}

// 断言 nextRun(expr, from) === 期望的 UTC 时刻
function expect(expr, from, want, label) {
  n++;
  let got;
  try {
    got = nextRun(expr, from);
  } catch (e) {
    fail(`${label}: threw unexpectedly: ${e && e.message}`);
    return;
  }
  if (got !== want) {
    const g = typeof got === "number" ? new Date(got * 1000).toISOString() : String(got);
    fail(`${label}: got ${g} (${got}) want ${new Date(want * 1000).toISOString()} (${want})`);
  }
}

function throws(expr, from, label) {
  n++;
  let threw = false;
  try {
    nextRun(expr, from);
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}: expected throw for "${expr}"`);
}

// ===================== 基本与边界 =====================

// 1. 每分钟：严格大于 from，且对齐到整分钟
expect("* * * * *", U(2021, 1, 1, 0, 0, 30), U(2021, 1, 1, 0, 1), "every-minute strict-after w/ seconds");
// 2. from 正好在整分钟边界 -> 仍然必须严格大于
expect("* * * * *", U(2021, 1, 1, 0, 0, 0), U(2021, 1, 1, 0, 1), "every-minute strict-after exact");
// 3. 午夜
expect("0 0 * * *", U(2021, 1, 1, 0, 0, 0), U(2021, 1, 2, 0, 0), "midnight next day (strict)");
// 4. 单值 min+hour
expect("30 5 * * *", U(2021, 6, 15, 5, 29, 59), U(2021, 6, 15, 5, 30), "05:30 same day");
expect("30 5 * * *", U(2021, 6, 15, 5, 30, 0), U(2021, 6, 16, 5, 30), "05:30 next day after match");

// ===================== 步长 step =====================

// 6. */15 分钟
expect("*/15 * * * *", U(2021, 1, 1, 0, 7), U(2021, 1, 1, 0, 15), "*/15 mid");
expect("*/15 * * * *", U(2021, 1, 1, 0, 45), U(2021, 1, 1, 1, 0), "*/15 wrap hour to :00");
// 8. */20 -> 0,20,40
expect("*/20 * * * *", U(2021, 1, 1, 0, 41), U(2021, 1, 1, 1, 0), "*/20 wrap");
// 9. a-b/n on hours: 0-23/6 -> 0,6,12,18
expect("0 0-23/6 * * *", U(2021, 1, 1, 1, 0), U(2021, 1, 1, 6, 0), "hour range step 6");
expect("0 0-23/6 * * *", U(2021, 1, 1, 18, 0, 1), U(2021, 1, 2, 0, 0), "hour range step 6 wrap day");
// 11. a/n 形式（a 到 max，步长 n）：5/10 分钟 -> 5,15,25,35,45,55
expect("5/10 * * * *", U(2021, 1, 1, 0, 6), U(2021, 1, 1, 0, 15), "a/n minute");
expect("5/10 * * * *", U(2021, 1, 1, 0, 56), U(2021, 1, 1, 1, 5), "a/n minute wrap");
// 13. step over single field with range a-b/n where n>span
expect("0-10/100 * * * *", U(2021, 1, 1, 0, 1), U(2021, 1, 1, 1, 0), "range step bigger than span -> only lo");

// ===================== 范围 range =====================

// 14. 9-17 小时
expect("0 9-17 * * *", U(2021, 1, 1, 20, 0), U(2021, 1, 2, 9, 0), "hour range next day");
expect("0 9-17 * * *", U(2021, 1, 1, 8, 30), U(2021, 1, 1, 9, 0), "hour range same day");
expect("0 9-17 * * *", U(2021, 1, 1, 17, 0, 1), U(2021, 1, 2, 9, 0), "hour range past end");

// ===================== 逗号列表 =====================

// 17. 分钟列表
expect("0,30 * * * *", U(2021, 1, 1, 0, 0, 1), U(2021, 1, 1, 0, 30), "minute list :30");
expect("0,30 * * * *", U(2021, 1, 1, 0, 31), U(2021, 1, 1, 1, 0), "minute list wrap to :00");
// 19. 混合：列表 + 范围 + 步长
expect("0 0,12 1,15 * *", U(2021, 1, 1, 0, 0, 1), U(2021, 1, 1, 12, 0), "list hour same day");
expect("0 0,12 1,15 * *", U(2021, 1, 1, 12, 0, 1), U(2021, 1, 15, 0, 0), "list dom jump to 15");
// 21. dow 列表（周一/周三/周五）, 2021-01-01 是周五
expect("0 0 * * 1,3,5", U(2021, 1, 1, 0, 0, 0), U(2021, 1, 4, 0, 0), "dow list Fri->Mon");

// ===================== dom/dow OR 规则 =====================

// 22. 都限制 -> OR：每月 15 号 或 每周一，从 2021-01-01(Fri) 起，最近的是 1/4(Mon)
expect("0 0 15 * 1", U(2021, 1, 1, 0, 0, 0), U(2021, 1, 4, 0, 0), "dom OR dow: Monday first");
// 23. 都限制 -> OR：15 号比下一个周一更近时取 15 号；从 1/11(Mon已过) 这里造一个 15 号更近的场景
//     从 2021-01-12(Tue) 起：下一个周一是 1/18，15 号是 1/15 -> 取 1/15
expect("0 0 15 * 1", U(2021, 1, 12, 0, 0, 0), U(2021, 1, 15, 0, 0), "dom OR dow: 15th sooner");
// 24. 仅 dom 限制（dow=*）-> 只看 dom
expect("0 0 13 * *", U(2021, 1, 1, 0, 0), U(2021, 1, 13, 0, 0), "dom only");
// 25. 仅 dow 限制（dom=*）-> 只看 dow（周日=0），2021-01-01 周五，下一个周日 1/3
expect("0 0 * * 0", U(2021, 1, 1, 0, 0), U(2021, 1, 3, 0, 0), "dow only Sunday");
// 26. dow=7 不允许（范围 0-6）-> 抛错
throws("0 0 * * 7", U(2021, 1, 1, 0, 0), "dow 7 out of range");
// 27. dom=* dow=* + 特定月：每天 0 点
expect("0 0 * * *", U(2021, 2, 28, 0, 0, 0), U(2021, 3, 1, 0, 0), "feb28 -> mar1 (2021 not leap)");

// ===================== 月/日 翻转 =====================

// 28. 闰年 2/29
expect("0 0 29 2 *", U(2024, 1, 1, 0, 0), U(2024, 2, 29, 0, 0), "leap day 2024");
// 29. 非闰年时 2/29 跳到下一个闰年
expect("0 0 29 2 *", U(2021, 1, 1, 0, 0), U(2024, 2, 29, 0, 0), "feb29 skips to 2024");
// 30. 31 号：从 2021-04-15 起，4 月没有 31 号 -> 5/31
expect("0 0 31 * *", U(2021, 4, 15, 0, 0), U(2021, 5, 31, 0, 0), "dom31 skips april");
// 31. 月份限制：只在 6 月
expect("0 0 1 6 *", U(2021, 7, 1, 0, 0), U(2022, 6, 1, 0, 0), "month june next year");
// 32. 月份范围 3-5
expect("0 0 1 3-5 *", U(2021, 6, 1, 0, 0), U(2022, 3, 1, 0, 0), "month range wrap year");

// ===================== 年边界 =====================

// 33. 跨年
expect("0 0 1 1 *", U(2021, 12, 31, 23, 59, 30), U(2022, 1, 1, 0, 0), "year boundary new year");
// 34. 12/31 -> 跨年到 1/1 每天 0 点
expect("0 0 * * *", U(2021, 12, 31, 12, 0), U(2022, 1, 1, 0, 0), "daily across year");
// 35. 最后一分钟
expect("59 23 * * *", U(2021, 12, 31, 23, 0), U(2021, 12, 31, 23, 59), "last minute of year");
expect("59 23 * * *", U(2021, 12, 31, 23, 59, 0), U(2022, 1, 1, 23, 59), "23:59 next day across year");

// ===================== 复杂组合 =====================

// 37. 每个工作日的 9:30（周一到周五）
expect("30 9 * * 1-5", U(2021, 1, 1, 9, 30, 0), U(2021, 1, 4, 9, 30), "weekday 9:30 Fri->Mon");
// 38. 每 5 分钟，仅在 8-10 点，仅 1 号
expect("*/5 8-10 1 * *", U(2021, 1, 31, 23, 59), U(2021, 2, 1, 8, 0), "complex combo");
expect("*/5 8-10 1 * *", U(2021, 2, 1, 8, 3), U(2021, 2, 1, 8, 5), "complex combo step");
expect("*/5 8-10 1 * *", U(2021, 2, 1, 10, 55, 1), U(2021, 3, 1, 8, 0), "complex combo end of window");

// 41. 单值越界保护：min=60 非法
throws("60 0 * * *", U(2021, 1, 1, 0, 0), "minute 60 out of range");
// 42. dom=0 非法（dom 最小 1）
throws("0 0 0 * *", U(2021, 1, 1, 0, 0), "dom 0 out of range");
// 43. month=13 非法
throws("0 0 1 13 *", U(2021, 1, 1, 0, 0), "month 13 out of range");

// ===================== 各种 malformed throws =====================

// 44. 字段数量不对
throws("* * * *", U(2021, 1, 1, 0, 0), "only 4 fields");
throws("* * * * * *", U(2021, 1, 1, 0, 0), "6 fields");
// 46. 空表达式
throws("", U(2021, 1, 1, 0, 0), "empty expr");
throws("   ", U(2021, 1, 1, 0, 0), "whitespace expr");
// 48. 非数字 token
throws("a * * * *", U(2021, 1, 1, 0, 0), "letter field");
// 49. 步长为 0
throws("*/0 * * * *", U(2021, 1, 1, 0, 0), "step zero");
// 50. 反向范围
throws("30-10 * * * *", U(2021, 1, 1, 0, 0), "reversed range");
// 51. 范围越界（上界 60）
throws("0-60 * * * *", U(2021, 1, 1, 0, 0), "range upper out of range");
// 52. 空列表项
throws("0,,30 * * * *", U(2021, 1, 1, 0, 0), "empty list item");
// 53. 负数
throws("-5 * * * *", U(2021, 1, 1, 0, 0), "negative value");
// 54. 多个斜杠
throws("*/2/3 * * * *", U(2021, 1, 1, 0, 0), "double slash");
// 55. 步长非整数 / 非数字
throws("*/x * * * *", U(2021, 1, 1, 0, 0), "non-numeric step");
// 56. 小数
throws("1.5 * * * *", U(2021, 1, 1, 0, 0), "decimal value");
// 57. 范围缺一端
throws("5- * * * *", U(2021, 1, 1, 0, 0), "open-ended range");
throws("-5 * * * *", U(2021, 1, 1, 0, 0), "leading dash");

// ===================== 确定性 / 重复调用一致 =====================
{
  const a = nextRun("*/7 3-5 * * 1,4", U(2021, 9, 1, 0, 0));
  const b = nextRun("*/7 3-5 * * 1,4", U(2021, 9, 1, 0, 0));
  n++;
  if (a !== b) fail("determinism: repeated calls differ");
}

// 链式：把上一次结果作为下一次的 from，得到严格递增序列且都匹配
{
  let t = U(2021, 3, 1, 0, 0);
  let prev = t;
  for (let i = 0; i < 50; i++) {
    n++;
    const next = nextRun("*/13 * * * *", prev);
    if (next <= prev) fail(`chain ${i}: not strictly increasing`);
    const d = new Date(next * 1000);
    if (next % 60 !== 0) fail(`chain ${i}: seconds not zero`);
    if (d.getUTCMinutes() % 13 !== 0) fail(`chain ${i}: minute ${d.getUTCMinutes()} not multiple of 13`);
    prev = next;
  }
}

console.log(`OK cron-parse (${n} assertions)`);
process.exit(0);
