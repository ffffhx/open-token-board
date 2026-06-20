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
 * @param {number} cents 金额（分），可含小数
 * @returns {number} 四舍五入后的整数分
 */
export function roundMoney(cents) {
  const floor = Math.floor(cents);
  const frac = cents - floor;
  // 判断小数是否恰好为 0.5（允许浮点误差容忍）
  if (Math.abs(frac - 0.5) < 1e-9) {
    // 银行家舍入：向最近偶数靠拢
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(cents);
}
