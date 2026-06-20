import { computeEditScript } from "../src/edit-script.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function check(cond, label) {
  n++;
  if (!cond) fail(label);
}

// ---- 独立参考实现（与被测实现解耦，用作判分 oracle）----
// LCS 长度表（前向 DP）。
function lcsTable(a, b) {
  const p = a.length;
  const q = b.length;
  const dp = Array.from({ length: p + 1 }, () => new Array(q + 1).fill(0));
  for (let i = 1; i <= p; i++) {
    for (let j = 1; j <= q; j++) {
      if (Object.is(a[i - 1], b[j - 1])) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
    }
  }
  return dp;
}
function lcsLen(a, b) {
  return lcsTable(a, b)[a.length][b.length];
}

// 唯一确定的「金标准」脚本：在每个不匹配处，若删除路径不劣于插入路径则删除，
// 从而保证同位置 del 排在 ins 之前；keep 数恰为 LCS。
function refScript(a, b) {
  const p = a.length;
  const q = b.length;
  // 后缀 LCS 表，便于从前往后贪心。
  const suf = Array.from({ length: p + 1 }, () => new Array(q + 1).fill(0));
  for (let i = p - 1; i >= 0; i--) {
    for (let j = q - 1; j >= 0; j--) {
      if (Object.is(a[i], b[j])) suf[i][j] = suf[i + 1][j + 1] + 1;
      else suf[i][j] = suf[i + 1][j] >= suf[i][j + 1] ? suf[i + 1][j] : suf[i][j + 1];
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < p && j < q) {
    if (Object.is(a[i], b[j])) {
      out.push({ type: "keep", value: a[i] });
      i++;
      j++;
    } else if (suf[i + 1][j] >= suf[i][j + 1]) {
      out.push({ type: "del", value: a[i] });
      i++;
    } else {
      out.push({ type: "ins", value: b[j] });
      j++;
    }
  }
  while (i < p) out.push({ type: "del", value: a[i++] });
  while (j < q) out.push({ type: "ins", value: b[j++] });
  return out;
}

// 把脚本应用到 a，返回结果数组；遇到非法操作抛错。
function applyScript(a, script) {
  const out = [];
  let i = 0;
  for (const op of script) {
    if (!op || typeof op !== "object") throw new Error("op 不是对象");
    if (op.type === "keep") {
      if (i >= a.length || !Object.is(a[i], op.value)) throw new Error("keep 与 a 不符");
      out.push(a[i]);
      i++;
    } else if (op.type === "del") {
      if (i >= a.length || !Object.is(a[i], op.value)) throw new Error("del 与 a 不符");
      i++;
    } else if (op.type === "ins") {
      out.push(op.value);
    } else {
      throw new Error(`未知 op.type: ${op.type}`);
    }
  }
  if (i !== a.length) throw new Error("脚本未消费完 a");
  return out;
}

function arrEq(x, y) {
  if (x.length !== y.length) return false;
  for (let k = 0; k < x.length; k++) if (!Object.is(x[k], y[k])) return false;
  return true;
}
function opEq(x, y) {
  if (x.length !== y.length) return false;
  for (let k = 0; k < x.length; k++) {
    if (x[k].type !== y[k].type || !Object.is(x[k].value, y[k].value)) return false;
  }
  return true;
}

// 校验同一位置 del 必须排在 ins 之前：把脚本按「位置段」切分，
// 每个 ins 之后不允许再出现属于同一未消费位置的 del。等价地：
// 不允许出现紧邻的 [ins, del] 序列（中间无 keep）。这样的相邻对可互换且互换后
// del 在前，违反 tie-break。
function tieBreakOk(script) {
  for (let k = 0; k + 1 < script.length; k++) {
    if (script[k].type === "ins" && script[k + 1].type === "del") return false;
  }
  return true;
}

function verifyOne(a, b, label) {
  const script = computeEditScript(a, b);
  check(Array.isArray(script), `${label}: 返回值必须是数组`);

  // 1) 应用正确性。
  let applied;
  try {
    applied = applyScript(a, script);
  } catch (e) {
    fail(`${label}: 应用脚本出错 ${e.message}`);
  }
  check(arrEq(applied, b), `${label}: 应用脚本后未得到 b`);

  // 2) 最短性：keep 数 == LCS，del+ins == 编辑距离。
  const keeps = script.filter((o) => o.type === "keep").length;
  const L = lcsLen(a, b);
  check(keeps === L, `${label}: keep 数(${keeps}) != LCS(${L})，脚本非最短`);
  const edits = script.length - keeps;
  check(
    edits === a.length + b.length - 2 * L,
    `${label}: del+ins(${edits}) != 编辑距离(${a.length + b.length - 2 * L})`,
  );

  // 3) tie-break：同位置删除排在插入之前。
  check(tieBreakOk(script), `${label}: tie-break 违例（ins 紧邻在 del 之前）`);

  // 4) 确定性：与唯一金标准逐项相等。
  check(opEq(script, refScript(a, b)), `${label}: 与金标准脚本不一致（tie-break/确定性错误）`);
}

// ---- 定向用例 ----
verifyOne([], [], "empty/empty");
verifyOne([1, 2, 3], [], "all-del");
verifyOne([], [1, 2, 3], "all-ins");
verifyOne([1, 2, 3], [1, 2, 3], "identical");
verifyOne([1], [2], "single replace -> del before ins");
verifyOne([1, 2], [2, 1], "swap");
verifyOne(["a", "b"], ["b", "a"], "string swap");
verifyOne([1, 2, 3, 4, 5], [2, 4, 6], "subsequence-ish");
verifyOne(
  ["k", "i", "t", "t", "e", "n"],
  ["s", "i", "t", "t", "i", "n", "g"],
  "kitten->sitting",
);
verifyOne([1, 1, 1], [1, 1], "dup shrink");
verifyOne([1, 1], [1, 1, 1], "dup grow");
verifyOne([0, -0], [-0, 0], "Object.is 区分 +0/-0"); // Object.is(0,-0) === false
verifyOne([NaN, 1], [1, NaN], "NaN 用 Object.is 视为相等");

// 显式 tie-break 用例：无公共元素时，删除整体排在插入之前（del 永不劣于 ins）。
{
  const s = computeEditScript([1, 3], [2, 4]);
  check(
    opEq(s, [
      { type: "del", value: 1 },
      { type: "del", value: 3 },
      { type: "ins", value: 2 },
      { type: "ins", value: 4 },
    ]),
    "tie-break: del-before-ins when no common element",
  );
  // 任何情况下都不应出现 ins 紧邻其后是 del（可互换且 del 应在前）。
  check(tieBreakOk(s), "interleaved no ins-then-del");
}

// ---- 随机 property 测试 ----
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
{
  const rand = rng(0x9e3779b1);
  for (let t = 0; t < 3000; t++) {
    const na = Math.floor(rand() * 9);
    const nb = Math.floor(rand() * 9);
    const alpha = 1 + Math.floor(rand() * 4); // 小字母表 -> 更多重复/分支
    const a = Array.from({ length: na }, () => Math.floor(rand() * alpha));
    const b = Array.from({ length: nb }, () => Math.floor(rand() * alpha));
    verifyOne(a, b, `random#${t} a=[${a}] b=[${b}]`);
  }
}

// 较大规模一例，确保非指数级实现。
{
  const a = Array.from({ length: 400 }, (_, i) => i % 7);
  const b = Array.from({ length: 400 }, (_, i) => (i + 3) % 7);
  verifyOne(a, b, "large 400x400");
}

console.log(`OK min-edit-script (${n} assertions)`);
process.exit(0);
