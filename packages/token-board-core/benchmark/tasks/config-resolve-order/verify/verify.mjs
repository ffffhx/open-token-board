import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const answerPath = resolve(__dirname, "../ANSWER.txt");

let raw;
try {
  raw = readFileSync(answerPath, "utf-8").trim();
} catch {
  console.error("FAIL: 找不到 ANSWER.txt，请将答案写入该文件。");
  process.exit(1);
}

if (!raw) {
  console.error("FAIL: ANSWER.txt 为空，请填写答案。");
  process.exit(1);
}

let answer;
try {
  answer = JSON.parse(raw);
} catch {
  console.error("FAIL: ANSWER.txt 内容不是合法的 JSON，请检查格式。");
  process.exit(1);
}

/**
 * 期望的解析结果（根据 defaults / env / userOverrides 三层合并逻辑）：
 *
 * maxRetries  : defaults=3, env=7(number)             → 7
 * enableCache : defaults=true, env="false"→false       → false
 * cacheSize   : defaults=128, userOverrides=256        → 256
 * port        : defaults=3000, env="8080"→8080         → 8080
 * host        : defaults="localhost", userOverrides     → "prod.example.com"
 */
const expected = {
  maxRetries: 7,
  enableCache: false,
  cacheSize: 256,
  port: 8080,
  host: "prod.example.com",
};

for (const [key, val] of Object.entries(expected)) {
  if (!(key in answer)) {
    console.error(`FAIL: 答案缺少键 "${key}"。`);
    process.exit(1);
  }
  if (answer[key] !== val) {
    console.error(
      `FAIL: 键 "${key}" 期望 ${JSON.stringify(val)}，实际得到 ${JSON.stringify(answer[key])}。`
    );
    process.exit(1);
  }
}

console.log("OK config-resolve-order");
process.exit(0);
