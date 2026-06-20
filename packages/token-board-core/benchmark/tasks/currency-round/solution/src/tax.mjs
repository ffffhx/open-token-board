/**
 * 税费计算工具（与金额舍入无关，请勿修改此文件）。
 */
import { roundMoney } from "./money.mjs";

/**
 * calcTax(subtotalCents, ratePct) — 计算含税金额（整分，使用银行家舍入）。
 *
 * @param {number} subtotalCents 税前金额（整分）
 * @param {number} ratePct       税率（百分比，例如 6 表示 6%）
 * @returns {number} 税额（整分）
 */
export function calcTax(subtotalCents, ratePct) {
  const rawTax = subtotalCents * (ratePct / 100);
  return roundMoney(rawTax);
}
