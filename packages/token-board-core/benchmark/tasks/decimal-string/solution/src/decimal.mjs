/**
 * 任意精度十进制字符串运算。
 *
 * 导出 add(a, b) 与 mul(a, b)：输入为十进制字符串，输出为规范化的十进制字符串。
 */

/**
 * 解析并校验一个十进制字符串。
 * 返回 { neg, intDigits, fracDigits }，其中 intDigits/fracDigits 为原始数字串（未去零）。
 * 非法输入抛出异常。
 */
function parse(s) {
  if (typeof s !== "string") throw new Error("input must be a string");
  if (s.length === 0) throw new Error("empty input");

  let i = 0;
  let neg = false;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    i = 1;
  }
  // 符号后必须还有内容
  if (i >= s.length) throw new Error("lone sign");

  let intPart = "";
  let fracPart = "";
  let seenDot = false;
  let seenDigit = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === ".") {
      if (seenDot) throw new Error("multiple dots");
      seenDot = true;
      continue;
    }
    if (ch < "0" || ch > "9") throw new Error("invalid character");
    seenDigit = true;
    if (seenDot) fracPart += ch;
    else intPart += ch;
  }
  if (!seenDigit) throw new Error("no digits");

  return { neg, intPart, fracPart };
}

/**
 * 把解析结果转换为定点表示：返回 { neg, value: BigInt, scale }，
 * 其中真实数值 = (neg ? -1 : 1) * value / 10^scale。
 * value 为非负 BigInt。
 */
function toFixed(p) {
  const scale = p.fracPart.length;
  const digits = p.intPart + p.fracPart;
  // digits 可能为空（不会，因为至少一个数字），但可能全 0
  const value = digits.length ? BigInt(digits) : 0n;
  let neg = p.neg;
  if (value === 0n) neg = false; // -0 归一
  return { neg, value, scale };
}

/**
 * 把定点表示规范化为十进制字符串。
 * value 为非负 BigInt，scale >= 0，neg 表示符号。
 */
function format(neg, value, scale) {
  if (value === 0n) return "0";

  let digits = value.toString();
  // 保证至少有 scale+1 位，便于切出整数/小数
  if (scale > 0) {
    if (digits.length <= scale) {
      digits = "0".repeat(scale - digits.length + 1) + digits;
    }
  }

  let intStr;
  let fracStr;
  if (scale === 0) {
    intStr = digits;
    fracStr = "";
  } else {
    intStr = digits.slice(0, digits.length - scale);
    fracStr = digits.slice(digits.length - scale);
  }

  // 去掉整数部分前导零
  intStr = intStr.replace(/^0+/, "");
  if (intStr === "") intStr = "0";

  // 去掉小数部分尾随零
  fracStr = fracStr.replace(/0+$/, "");

  const sign = neg ? "-" : "";
  if (fracStr === "") return sign + intStr;
  return sign + intStr + "." + fracStr;
}

/** 把两个定点数对齐到同一 scale，返回 { a, b, scale }（带符号的 BigInt）。 */
function align(x, y) {
  const scale = Math.max(x.scale, y.scale);
  let av = x.value * 10n ** BigInt(scale - x.scale);
  let bv = y.value * 10n ** BigInt(scale - y.scale);
  if (x.neg) av = -av;
  if (y.neg) bv = -bv;
  return { a: av, b: bv, scale };
}

export function add(a, b) {
  const x = toFixed(parse(a));
  const y = toFixed(parse(b));
  const { a: av, b: bv, scale } = align(x, y);
  const sum = av + bv;
  const neg = sum < 0n;
  const mag = neg ? -sum : sum;
  return format(neg, mag, scale);
}

export function mul(a, b) {
  const x = toFixed(parse(a));
  const y = toFixed(parse(b));
  const scale = x.scale + y.scale;
  const mag = x.value * y.value;
  const neg = mag === 0n ? false : x.neg !== y.neg;
  return format(neg, mag, scale);
}
