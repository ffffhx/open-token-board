/**
 * report.mjs — 模型用量报告生成工具
 *
 * 注意：下面三个函数内部都重复了相同的"计算总量"逻辑，请重构以消除重复。
 * 由于代码重复，其中一处出现了复制粘贴引入的细微 bug，请在重构时一并修正。
 */

/**
 * 生成文本摘要报告。
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, requests: number}>} records
 * @returns {string}
 */
export function generateTextReport(records) {
  // 总量计算逻辑 (copy 1) — 正确
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;
  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalRequests += r.requests;
  }
  const totalTokens = totalInput + totalOutput;

  const lines = ["=== 用量报告 ==="];
  for (const r of records) {
    lines.push(`${r.model}: 输入=${r.inputTokens} 输出=${r.outputTokens} 请求=${r.requests}`);
  }
  lines.push(`合计: 输入=${totalInput} 输出=${totalOutput} 请求=${totalRequests} tokens=${totalTokens}`);
  return lines.join("\n");
}

/**
 * 生成 JSON 格式报告。
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, requests: number}>} records
 * @returns {object}
 */
export function generateJsonReport(records) {
  // 总量计算逻辑 (copy 2) — BUG: totalRequests 累加写错成了 totalOutput
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;
  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalRequests += r.outputTokens;  // BUG: 应为 r.requests
  }
  const totalTokens = totalInput + totalOutput;

  return {
    records,
    summary: {
      totalInput,
      totalOutput,
      totalRequests,
      totalTokens,
    },
  };
}

/**
 * 判断用量是否超过给定预算（以 token 总数衡量）。
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, requests: number}>} records
 * @param {number} budget
 * @returns {{ exceeded: boolean, totalTokens: number, budget: number }}
 */
export function checkBudget(records, budget) {
  // 总量计算逻辑 (copy 3) — 正确
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;
  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalRequests += r.requests;
  }
  const totalTokens = totalInput + totalOutput;

  return {
    exceeded: totalTokens > budget,
    totalTokens,
    budget,
  };
}
