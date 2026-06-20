import { generateTextReport, generateJsonReport, checkBudget } from "../src/report.mjs";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// 测试数据集
const datasets = [
  [
    { model: "gpt-4o", inputTokens: 100, outputTokens: 200, requests: 5 },
    { model: "gpt-4", inputTokens: 300, outputTokens: 400, requests: 10 },
  ],
  [
    { model: "claude-3", inputTokens: 50, outputTokens: 75, requests: 2 },
  ],
  [
    { model: "a", inputTokens: 1000, outputTokens: 2000, requests: 1 },
    { model: "b", inputTokens: 500, outputTokens: 500, requests: 3 },
    { model: "c", inputTokens: 0, outputTokens: 0, requests: 0 },
  ],
  [
    { model: "x", inputTokens: 10, outputTokens: 20, requests: 7 },
    { model: "y", inputTokens: 30, outputTokens: 40, requests: 8 },
    { model: "z", inputTokens: 60, outputTokens: 80, requests: 9 },
  ],
];

// 验证 generateJsonReport 的 totalRequests 与各记录 requests 之和一致
for (const records of datasets) {
  const report = generateJsonReport(records);
  const expectedRequests = records.reduce((s, r) => s + r.requests, 0);
  if (report.summary.totalRequests !== expectedRequests) {
    fail(
      `generateJsonReport totalRequests 错误: 期望 ${expectedRequests}, 实际 ${report.summary.totalRequests} (records=${JSON.stringify(records.map(r => r.requests))})`
    );
  }
  const expectedInput = records.reduce((s, r) => s + r.inputTokens, 0);
  if (report.summary.totalInput !== expectedInput) {
    fail(`generateJsonReport totalInput 错误: 期望 ${expectedInput}, 实际 ${report.summary.totalInput}`);
  }
  const expectedOutput = records.reduce((s, r) => s + r.outputTokens, 0);
  if (report.summary.totalOutput !== expectedOutput) {
    fail(`generateJsonReport totalOutput 错误: 期望 ${expectedOutput}, 实际 ${report.summary.totalOutput}`);
  }
  const expectedTokens = expectedInput + expectedOutput;
  if (report.summary.totalTokens !== expectedTokens) {
    fail(`generateJsonReport totalTokens 错误: 期望 ${expectedTokens}, 实际 ${report.summary.totalTokens}`);
  }
}

// 验证 generateTextReport 包含正确的总量字符串
for (const records of datasets) {
  const text = generateTextReport(records);
  const expectedInput = records.reduce((s, r) => s + r.inputTokens, 0);
  const expectedOutput = records.reduce((s, r) => s + r.outputTokens, 0);
  const expectedRequests = records.reduce((s, r) => s + r.requests, 0);
  const expectedTokens = expectedInput + expectedOutput;

  if (!text.includes(`输入=${expectedInput}`)) {
    fail(`generateTextReport 缺少 输入=${expectedInput}, 实际:\n${text}`);
  }
  if (!text.includes(`输出=${expectedOutput}`)) {
    fail(`generateTextReport 缺少 输出=${expectedOutput}, 实际:\n${text}`);
  }
  if (!text.includes(`请求=${expectedRequests}`)) {
    fail(`generateTextReport 缺少 请求=${expectedRequests}, 实际:\n${text}`);
  }
  if (!text.includes(`tokens=${expectedTokens}`)) {
    fail(`generateTextReport 缺少 tokens=${expectedTokens}, 实际:\n${text}`);
  }
}

// 验证 checkBudget 的 totalTokens 与 exceeded 逻辑
const budgetCases = [
  { records: datasets[0], budget: 1000, expectedTokens: 1000, expectedExceeded: false },
  { records: datasets[0], budget: 999, expectedTokens: 1000, expectedExceeded: true },
  { records: datasets[2], budget: 4000, expectedTokens: 4000, expectedExceeded: false },
  { records: datasets[2], budget: 3999, expectedTokens: 4000, expectedExceeded: true },
  { records: datasets[3], budget: 240, expectedTokens: 240, expectedExceeded: false },
  { records: datasets[3], budget: 239, expectedTokens: 240, expectedExceeded: true },
];

for (const { records, budget, expectedTokens, expectedExceeded } of budgetCases) {
  const result = checkBudget(records, budget);
  if (result.totalTokens !== expectedTokens) {
    fail(`checkBudget totalTokens 错误: 期望 ${expectedTokens}, 实际 ${result.totalTokens}`);
  }
  if (result.exceeded !== expectedExceeded) {
    fail(`checkBudget exceeded 错误: 期望 ${expectedExceeded}, 实际 ${result.exceeded} (totalTokens=${result.totalTokens}, budget=${budget})`);
  }
  if (result.budget !== budget) {
    fail(`checkBudget budget 字段错误: 期望 ${budget}, 实际 ${result.budget}`);
  }
}

// 验证三个函数对同一数据给出一致的 totalTokens
for (const records of datasets) {
  const jsonReport = generateJsonReport(records);
  const budgetResult = checkBudget(records, 0);
  const textReport = generateTextReport(records);

  const tokensFromJson = jsonReport.summary.totalTokens;
  const tokensFromBudget = budgetResult.totalTokens;
  const expectedTokens = records.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

  if (tokensFromJson !== expectedTokens) {
    fail(`generateJsonReport 与预期 totalTokens 不一致: ${tokensFromJson} vs ${expectedTokens}`);
  }
  if (tokensFromBudget !== expectedTokens) {
    fail(`checkBudget 与预期 totalTokens 不一致: ${tokensFromBudget} vs ${expectedTokens}`);
  }
  if (!textReport.includes(`tokens=${expectedTokens}`)) {
    fail(`generateTextReport tokens 不一致: 期望 tokens=${expectedTokens}`);
  }
}

console.log("OK extract-dup-logic");
process.exit(0);
