/**
 * roundMoney(cents) — 将以"分"为单位的浮点金额四舍五入到最近整分。
 *
 * 要求使用银行家舍入（Banker's Rounding / Round Half to Even）：
 *   - 当小数部分恰好为 0.5 时，向最近的"偶数"整数靠拢，而非一律进位。
 *   - 其余情况与普通四舍五入相同（< 0.5 舍，> 0.5 入）。
 *
 * 示例（单位：分）:
 *   roundMoney(0.5)  => 0  （最近偶数为 0）
 *   roundMoney(1.5)  => 2  （最近偶数为 2）
 *   roundMoney(2.5)  => 2  （最近偶数为 2）
 *   roundMoney(3.5)  => 4  （最近偶数为 4）
 *
 * BUG: 当前实现对 x.5 一律向上取整，与银行家舍入不符。
 *
 * @param {number} cents 金额（分），可含小数
 * @returns {number} 四舍五入后的整数分
 */
export function roundMoney(cents) {
  // BUG: Math.round 对 0.5 总是向正无穷方向进位，不符合银行家舍入规则
  return Math.round(cents);
}
