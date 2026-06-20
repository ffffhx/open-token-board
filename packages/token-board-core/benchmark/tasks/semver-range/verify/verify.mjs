import { satisfies } from "../src/semver.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function ok(version, range, want, label) {
  n++;
  let got;
  try {
    got = satisfies(version, range);
  } catch (e) {
    fail(`${label}: satisfies(${JSON.stringify(version)}, ${JSON.stringify(range)}) threw ${e && e.message}`);
    return;
  }
  if (got !== want) {
    fail(`${label}: satisfies(${JSON.stringify(version)}, ${JSON.stringify(range)}) => ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function throws(version, range, label) {
  n++;
  let threw = false;
  try {
    satisfies(version, range);
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}: satisfies(${JSON.stringify(version)}, ${JSON.stringify(range)}) expected throw`);
}

// --- 1. 精确匹配 ---
ok("1.2.3", "1.2.3", true, "exact match true");
ok("1.2.4", "1.2.3", false, "exact match false");
ok("0.0.0", "0.0.0", true, "exact zero");
ok("10.20.30", "10.20.30", true, "exact multi-digit");
ok("1.2.3", "  1.2.3  ", true, "exact trimmed");

// --- 2. 比较符 ---
ok("1.2.0", ">=1.2.0", true, ">= equal");
ok("1.3.0", ">=1.2.0", true, ">= greater");
ok("1.1.9", ">=1.2.0", false, ">= less");
ok("1.0.1", ">1.0.0", true, "> greater");
ok("1.0.0", ">1.0.0", false, "> equal not greater");
ok("1.9.9", "<2.0.0", true, "< less");
ok("2.0.0", "<2.0.0", false, "< equal not less");
ok("1.2.3", "<=1.2.3", true, "<= equal");
ok("1.2.2", "<=1.2.3", true, "<= less");
ok("1.2.4", "<=1.2.3", false, "<= greater");
ok("1.2.3", "=1.2.3", true, "= equal");
ok("1.2.4", "=1.2.3", false, "= not equal");

// --- 2b. 数值比较而非字符串比较 ---
ok("1.10.0", ">1.9.0", true, "numeric minor 10 > 9");
ok("2.0.0", ">10.0.0", false, "numeric major 2 < 10");
ok("1.0.10", ">1.0.9", true, "numeric patch 10 > 9");

// --- 2c. >= 与 <= 双字符不能被误判 ---
ok("1.2.0", ">=1.2.0", true, ">= two-char not '>' + '=1.2.0'");
ok("1.2.0", "<=1.2.0", true, "<= two-char");

// --- 3. caret ---
ok("1.2.3", "^1.2.3", true, "^1.2.3 lower bound");
ok("1.9.9", "^1.2.3", true, "^1.2.3 within major 1");
ok("2.0.0", "^1.2.3", false, "^1.2.3 excludes 2.0.0");
ok("1.2.2", "^1.2.3", false, "^1.2.3 below lower");
ok("0.2.3", "^0.2.3", true, "^0.2.3 lower");
ok("0.2.9", "^0.2.3", true, "^0.2.3 within minor 2");
ok("0.3.0", "^0.2.3", false, "^0.2.3 excludes 0.3.0");
ok("0.0.3", "^0.0.3", true, "^0.0.3 exact lower");
ok("0.0.4", "^0.0.3", false, "^0.0.3 excludes 0.0.4");
ok("0.0.0", "^0.0.0", true, "^0.0.0 lower");
ok("0.0.1", "^0.0.0", false, "^0.0.0 excludes 0.0.1");
ok("1.0.0", "^1.0.0", true, "^1.0.0 lower");
ok("1.5.7", "^1.0.0", true, "^1.0.0 within major 1");
ok("2.0.0", "^1.0.0", false, "^1.0.0 excludes 2.0.0");

// --- 4. tilde ---
ok("1.2.3", "~1.2.3", true, "~1.2.3 lower");
ok("1.2.9", "~1.2.3", true, "~1.2.3 within patch");
ok("1.3.0", "~1.2.3", false, "~1.2.3 excludes 1.3.0");
ok("1.2.2", "~1.2.3", false, "~1.2.3 below lower");
ok("0.2.3", "~0.2.3", true, "~0.2.3 lower");
ok("0.3.0", "~0.2.3", false, "~0.2.3 excludes 0.3.0");
ok("1.0.0", "~1.0.0", true, "~1.0.0 lower");
ok("1.0.5", "~1.0.0", true, "~1.0.0 within patch");
ok("1.1.0", "~1.0.0", false, "~1.0.0 excludes 1.1.0");

// --- 5. 空格分隔 AND ---
ok("1.2.0", ">=1.2.0 <1.5.0", true, "AND lower boundary");
ok("1.4.9", ">=1.2.0 <1.5.0", true, "AND within");
ok("1.5.0", ">=1.2.0 <1.5.0", false, "AND upper excluded");
ok("1.1.9", ">=1.2.0 <1.5.0", false, "AND below lower");
ok("1.3.0", ">=1.2.0 <1.5.0 >1.2.9", true, "AND three clauses true");
ok("1.2.5", ">=1.2.0 <1.5.0 >1.2.9", false, "AND three clauses false");
ok("1.3.0", ">=1.2.0    <1.5.0", true, "AND multiple spaces");

// --- 6. 非法 version ---
throws("1.2", "1.2.0", "version too few segments");
throws("1.2.3.4", "1.2.3.4", "version too many segments");
throws("01.2.3", "0.0.0", "version leading zero");
throws("1.02.3", "0.0.0", "version leading zero minor");
throws("v1.2.3", "0.0.0", "version v-prefix");
throws("1.2.3-beta", "0.0.0", "version prerelease");
throws("1.2.3+build", "0.0.0", "version build metadata");
throws(" 1.2.3", "0.0.0", "version leading space");
throws("1.2.3 ", "0.0.0", "version trailing space");
throws("1.2.x", "0.0.0", "version non-numeric segment");
throws("1.-2.3", "0.0.0", "version negative segment");
throws("", "0.0.0", "version empty");
throws(123, "0.0.0", "version not a string");
throws(null, "0.0.0", "version null");

// --- 7. 非法 range ---
throws("1.2.3", "", "range empty");
throws("1.2.3", "   ", "range only whitespace");
throws("1.2.3", ">= 1.2.0", "range space between op and version");
throws("1.2.3", ">>1.2.0", "range bad op");
throws("1.2.3", "~~1.2.3", "range double tilde");
throws("1.2.3", "^1.2", "range caret bad version");
throws("1.2.3", "~1.2", "range tilde bad version");
throws("1.2.3", ">=1.2", "range comparator bad version");
throws("1.2.3", "1.2.3 1.2.4", "range exact AND combination");
throws("1.2.3", "^1.2.3 <2.0.0", "range caret AND combination");
throws("1.2.3", "~1.2.3 <2.0.0", "range tilde AND combination");
throws("1.2.3", ">=1.2.0 ^1.0.0", "range AND with caret clause");
throws("1.2.3", "abc", "range garbage");
throws("1.2.3", 123, "range not a string");
throws("1.2.3", null, "range null");

console.log(`OK semver-range (${n} assertions)`);
process.exit(0);
