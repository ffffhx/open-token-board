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

    // BUG 1: 应当先 trim 再判断 required，但这里直接用原始 value
    if (required && value === "") {
      errors.push({ field: name, code: "required" });
      continue;
    }

    const trimmed = value.trim();

    // BUG 2: minLength 校验符号用反了，应该是 < 而非 >
    if (minLength != null && trimmed.length > minLength) {
      errors.push({ field: name, code: "minLength" });
    }

    // BUG 3: maxLength 校验符号正确，但 required 逻辑被提前 continue，
    //         此处逻辑是正确的，保留作为干扰
    if (maxLength != null && trimmed.length > maxLength) {
      errors.push({ field: name, code: "maxLength" });
    }

    // BUG 4: pattern 校验逻辑反了，应该是 !pattern.test(trimmed)
    if (pattern != null && pattern.test(trimmed)) {
      errors.push({ field: name, code: "pattern" });
    }
  }

  return errors;
}
