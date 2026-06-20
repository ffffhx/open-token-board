import { formatTime } from "../src/format-time.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- 1. 验证 format-time.mjs 的正确行为 ----

// utcMs 对应 2024-01-15 12:00:00 UTC
const BASE_UTC = Date.UTC(2024, 0, 15, 12, 0, 0);

const cases = [
  // [utcMs, offsetMinutes, expected]
  // 东八区 UTC+8: 12:00 UTC => 20:00 local
  [BASE_UTC, 480, "20:00"],
  // 西五区 UTC-5: 12:00 UTC => 07:00 local
  [BASE_UTC, -300, "07:00"],
  // UTC+0: 12:00 UTC => 12:00 local
  [BASE_UTC, 0, "12:00"],
  // UTC+5:30 (印度): 12:00 UTC => 17:30 local
  [BASE_UTC, 330, "17:30"],
  // UTC+9 (日本): 23:00 UTC => 08:00 次日 local (只验证 HH:MM 部分)
  [Date.UTC(2024, 0, 15, 23, 0, 0), 540, "08:00"],
  // 分钟带偏移: UTC+5:45 (尼泊尔): 12:00 UTC => 17:45 local
  [BASE_UTC, 345, "17:45"],
  // 西区带分钟: UTC-3:30 (纽芬兰): 12:00 UTC => 08:30 local
  [BASE_UTC, -210, "08:30"],
];

for (const [utcMs, offsetMinutes, expected] of cases) {
  const got = formatTime(utcMs, offsetMinutes);
  if (got !== expected) {
    console.error(
      `FAIL formatTime(utcMs, ${offsetMinutes}) => "${got}", expected "${expected}"`
    );
    process.exit(1);
  }
}

// ---- 2. 验证 format-date.mjs 未被修改（范围控制）----
// 比较 format-date.mjs 内容中不应含有符号错误（不检查内容细节，只确认文件存在且可正确导入）
// 这里使用功能性测试：如果有人把 format-date.mjs 也改了，该测试可能报错
const { formatDate } = await import("../src/format-date.mjs");

// 2024-01-15 12:00:00 UTC, UTC+8 => 2024-01-15 20:00 => 日期仍是 2024-01-15
const dateResult = formatDate(BASE_UTC, 480);
if (dateResult !== "2024-01-15") {
  console.error(
    `FAIL formatDate(BASE_UTC, 480) => "${dateResult}", expected "2024-01-15" — format-date.mjs 可能被错误修改`
  );
  process.exit(1);
}

// 2024-01-15 22:00:00 UTC, UTC+8 => 2024-01-16 06:00 => 日期是 2024-01-16
const dateResult2 = formatDate(Date.UTC(2024, 0, 15, 22, 0, 0), 480);
if (dateResult2 !== "2024-01-16") {
  console.error(
    `FAIL formatDate(Date.UTC(2024,0,15,22,0,0), 480) => "${dateResult2}", expected "2024-01-16" — format-date.mjs 可能被错误修改`
  );
  process.exit(1);
}

console.log("OK timezone-shift");
process.exit(0);
