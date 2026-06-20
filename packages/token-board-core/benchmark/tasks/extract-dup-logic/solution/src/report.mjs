/**
 * report.mjs — 模型用量报告生成工具
 */

/**
 * 提取的共享辅助函数：汇总所有记录的 token 总量。
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, requests: number}>} records
 * @returns {{ totalInput: number, totalOutput: number, totalRequests: number, totalTokens: number }}
 */
function computeTotals(records) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;
  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalRequests += r.requests;
  }
  return { totalInput, totalOutput, totalRequests, totalTokens: totalInput + totalOutput };
}

/**
 * 生成文本摘要报告。
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, requests: number}>} records
 * @returns {string}
 */
export function generateTextReport(records) {
  const { totalInput, totalOutput, totalRequests, totalTokens } = computeTotals(records);

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
  const { totalInput, totalOutput, totalRequests, totalTokens } = computeTotals(records);

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
  const { totalTokens } = computeTotals(records);

  return {
    exceeded: totalTokens > budget,
    totalTokens,
    budget,
  };
}
