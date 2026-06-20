/**
 * validateForm — 表单字段校验器
 *
 * @param {Array<{name: string, value: string, required?: boolean, minLength?: number, maxLength?: number, pattern?: RegExp}>} fields
 * @returns {Array<{field: string, code: string}>}  错误列表，无错误时返回空数组
 *
 * 错误码说明：
 *   "required"   — 必填字段为空（trim 后为空字符串）
 *   "minLength"  — 值的长度（trim 后）小于 minLength
 *   "maxLength"  — 值的长度（trim 后）大于 maxLength
 *   "pattern"    — 值不匹配 pattern
 */
export function validateForm(fields) {
  const errors = [];

  for (const field of fields) {
    const { name, value, required, minLength, maxLength, pattern } = field;

    const trimmed = value.trim();

    // required: trim 后为空字符串才算必填错误
    if (required && trimmed === "") {
      errors.push({ field: name, code: "required" });
      continue;
    }

    // minLength: 长度严格小于 minLength 才报错
    if (minLength != null && trimmed.length < minLength) {
      errors.push({ field: name, code: "minLength" });
    }

    // maxLength: 长度严格大于 maxLength 才报错
    if (maxLength != null && trimmed.length > maxLength) {
      errors.push({ field: name, code: "maxLength" });
    }

    // pattern: 不匹配 pattern 才报错
    if (pattern != null && !pattern.test(trimmed)) {
      errors.push({ field: name, code: "pattern" });
    }
  }

  return errors;
}
