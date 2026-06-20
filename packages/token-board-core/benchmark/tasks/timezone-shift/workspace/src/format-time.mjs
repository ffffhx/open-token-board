/**
 * 把 UTC 毫秒数转换成本地时间字符串（HH:MM 格式）。
 *
 * @param {number} utcMs        - UTC 时间戳（毫秒）
 * @param {number} offsetMinutes - 时区偏移分钟数（东八区=480，西五区=-300）
 * @returns {string}            - 格式 "HH:MM"
 */
export function formatTime(utcMs, offsetMinutes) {
  // BUG: 偏移符号用反了，应该是加法而不是减法
  const localMs = utcMs - offsetMinutes * 60 * 1000;
  const date = new Date(localMs);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
