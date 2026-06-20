import { add, mul } from "../src/decimal.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function eq(got, want, label) {
  n++;
  if (got !== want) {
    fail(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function throws(fn, label) {
  n++;
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}: expected throw`);
}

// 一个与被测实现独立的参考实现（用于随机/大数交叉校验）。
function refFixed(s) {
  // 仅在测试已知合法输入上调用
  let neg = false;
  let i = 0;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    i = 1;
  }
  let intp = "";
  let fracp = "";
  let dot = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === ".") {
      dot = true;
      continue;
    }
    if (dot) fracp += ch;
    else intp += ch;
  }
  const scale = fracp.length;
  const digits = intp + fracp;
  let value = digits.length ? BigInt(digits) : 0n;
  if (value === 0n) neg = false;
  return { neg, value, scale };
}
function refFormat(neg, value, scale) {
  if (value === 0n) return "0";
  let digits = value.toString();
  if (scale > 0 && digits.length <= scale) {
    digits = "0".repeat(scale - digits.length + 1) + digits;
  }
  let intStr = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  let fracStr = scale === 0 ? "" : digits.slice(digits.length - scale);
  intStr = intStr.replace(/^0+/, "") || "0";
  fracStr = fracStr.replace(/0+$/, "");
  const sign = neg ? "-" : "";
  return fracStr === "" ? sign + intStr : sign + intStr + "." + fracStr;
}
function refAdd(a, b) {
  const x = refFixed(a);
  const y = refFixed(b);
  const scale = Math.max(x.scale, y.scale);
  let av = x.value * 10n ** BigInt(scale - x.scale);
  let bv = y.value * 10n ** BigInt(scale - y.scale);
  if (x.neg) av = -av;
  if (y.neg) bv = -bv;
  const sum = av + bv;
  const neg = sum < 0n;
  const mag = neg ? -sum : sum;
  return refFormat(neg, mag, scale);
}
function refMul(a, b) {
  const x = refFixed(a);
  const y = refFixed(b);
  const scale = x.scale + y.scale;
  const mag = x.value * y.value;
  const neg = mag === 0n ? false : x.neg !== y.neg;
  return refFormat(neg, mag, scale);
}

// ============ add 基本 ============
eq(add("1", "2"), "3", "add 1+2");
eq(add("0", "0"), "0", "add 0+0");
eq(add("12.5", "0.5"), "13", "add frac->int trailing strip");
eq(add("0.1", "0.2"), "0.3", "add 0.1+0.2 exact");
eq(add("0.10", "0.20"), "0.3", "add trailing zeros normalize");
eq(add("100", "1"), "101", "add 100+1");
eq(add("999", "1"), "1000", "add carry chain");
eq(add("9.99", "0.01"), "10", "add frac carry to int + strip");

// ============ add 符号组合 ============
eq(add("-12.5", "12.5"), "0", "add cancel to zero -> 0 not -0");
eq(add("-12.5", "2.5"), "-10", "add neg dominates");
eq(add("2.5", "-12.5"), "-10", "add neg dominates 2");
eq(add("-1", "-2"), "-3", "add both neg");
eq(add("-0.0", "0"), "0", "add -0.0 normalized");
eq(add("-0", "-0"), "0", "add -0 + -0 = 0");
eq(add("5", "-5"), "0", "add 5-5=0");
eq(add("-5", "5"), "0", "add -5+5=0");
eq(add("-3.14", "1.14"), "-2", "add neg frac strip");
eq(add("100", "-1"), "99", "add borrow");
eq(add("1000", "-1"), "999", "add borrow chain");
eq(add("-1000", "1"), "-999", "add neg borrow chain");

// ============ add 前导/尾随零 与对齐 ============
eq(add("007", "003"), "10", "add leading zeros input");
eq(add("0.0001", "0.0009"), "0.001", "add small frac align");
eq(add("1.005", "2.995"), "4", "add frac carry strip");
eq(add("00.00", "00.00"), "0", "add zero forms");
eq(add("+5", "+5"), "10", "add explicit plus sign");
eq(add("-0.5", "0.5"), "0", "add to zero with frac");
eq(add("123.456", "0"), "123.456", "add identity preserves frac");
eq(add("0", "-0.500"), "-0.5", "add zero + neg trailing zero frac");

// ============ mul 基本 ============
eq(mul("2", "3"), "6", "mul 2*3");
eq(mul("0", "12345"), "0", "mul by zero");
eq(mul("-0", "5"), "0", "mul -0 * 5 = 0");
eq(mul("0.5", "0.5"), "0.25", "mul frac");
eq(mul("0.1", "0.1"), "0.01", "mul 0.1*0.1");
eq(mul("1.5", "2"), "3", "mul strip trailing");
eq(mul("-2", "3"), "-6", "mul sign");
eq(mul("-2", "-3"), "6", "mul neg*neg");
eq(mul("2", "-3"), "-6", "mul pos*neg");
eq(mul("12.5", "0.4"), "5", "mul exact -> int strip");
eq(mul("0.25", "4"), "1", "mul to one");
eq(mul("1.001", "1000"), "1001", "mul shift");
eq(mul("-0.5", "0"), "0", "mul neg * zero = 0");
eq(mul("100", "0.001"), "0.1", "mul scale balance");
eq(mul("0.000", "0.000"), "0", "mul zeros");

// ============ mul 前导零/符号/规范化 ============
eq(mul("007", "008"), "56", "mul leading zeros");
eq(mul("-0.0", "-0.0"), "0", "mul -0*-0 = 0");
eq(mul("3.14", "0"), "0", "mul frac * 0");
eq(mul("11", "11"), "121", "mul 11*11");

// ============ 大数 ============
{
  const big = "9".repeat(200);
  eq(add(big, "1"), "1" + "0".repeat(200), "add huge carry");
  const sq = (10n ** 200n - 1n) ** 2n;
  eq(mul(big, big), sq.toString(), "mul huge square");
}
{
  // 大的小数对齐
  const a = "1." + "0".repeat(150) + "1"; // 1.000...01
  const b = "0." + "0".repeat(150) + "9"; // 0.000...09
  eq(add(a, b), "1." + "0".repeat(149) + "1", "add huge frac align");
}

// ============ 交叉随机校验（确定性种子）============
{
  let seed = 0x2545f491n;
  function rnd() {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number((seed >> 33n) & 0xffffffffn);
  }
  function randDec() {
    const negSign = rnd() % 2 === 0 ? "-" : "";
    const ilen = (rnd() % 6) + 1;
    const flen = rnd() % 5;
    let int = "";
    for (let i = 0; i < ilen; i++) int += String(rnd() % 10);
    let frac = "";
    for (let i = 0; i < flen; i++) frac += String(rnd() % 10);
    let s = negSign + int + (frac ? "." + frac : "");
    return s;
  }
  for (let t = 0; t < 400; t++) {
    const a = randDec();
    const b = randDec();
    eq(add(a, b), refAdd(a, b), `random add ${a}+${b}`);
    eq(mul(a, b), refMul(a, b), `random mul ${a}*${b}`);
  }
}

// ============ malformed 抛错 ============
throws(() => add("", "1"), "empty string throws");
throws(() => add("1", ""), "empty string b throws");
throws(() => add("1.2.3", "1"), "multiple dots throws");
throws(() => add("1a", "1"), "non-digit throws");
throws(() => add("-", "1"), "lone minus throws");
throws(() => mul("+", "1"), "lone plus throws");
throws(() => add("1 2", "1"), "space throws");
throws(() => mul("abc", "1"), "letters throw");
throws(() => add("1", "."), "lone dot throws");
throws(() => mul("0x10", "1"), "hex throws");
throws(() => add("1,000", "1"), "comma throws");
throws(() => add("1e3", "1"), "exponent notation throws");
throws(() => mul("--1", "1"), "double sign throws");
throws(() => add(null, "1"), "null input throws");
throws(() => add("1", undefined), "undefined input throws");

console.log(`OK decimal-string (${n} assertions)`);
process.exit(0);
