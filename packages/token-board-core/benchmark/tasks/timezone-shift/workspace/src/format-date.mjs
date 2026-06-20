/**
 * 把 UTC 毫秒数转换成本地日期字符串（YYYY-MM-DD 格式）。
 *
 * 注意：此文件与 format-time.mjs 的 bug 无关，请勿修改。
 *
 * @param {number} utcMs        - UTC 时间戳（毫秒）
 * @param {number} offsetMinutes - 时区偏移分钟数（东八区=480，西五区=-300）
 * @returns {string}            - 格式 "YYYY-MM-DD"
 */
export function formatDate(utcMs, offsetMinutes) {
  const localMs = utcMs + offsetMinutes * 60 * 1000;
  const date = new Date(localMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
