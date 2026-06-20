import { isMatch } from "../src/regex.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function ok(pattern, text) {
  n++;
  let got;
  try {
    got = isMatch(pattern, text);
  } catch (e) {
    fail(`isMatch(${JSON.stringify(pattern)}, ${JSON.stringify(text)}) threw: ${e && e.message}`);
  }
  if (got !== true) {
    fail(`isMatch(${JSON.stringify(pattern)}, ${JSON.stringify(text)}) => ${JSON.stringify(got)}, want true`);
  }
}
function no(pattern, text) {
  n++;
  let got;
  try {
    got = isMatch(pattern, text);
  } catch (e) {
    fail(`isMatch(${JSON.stringify(pattern)}, ${JSON.stringify(text)}) threw: ${e && e.message}`);
  }
  if (got !== false) {
    fail(`isMatch(${JSON.stringify(pattern)}, ${JSON.stringify(text)}) => ${JSON.stringify(got)}, want false`);
  }
}
function bad(pattern) {
  n++;
  let threw = false;
  try {
    // text 任意，重点是 pattern 非法应抛错
    isMatch(pattern, "anything");
  } catch {
    threw = true;
  }
  if (!threw) fail(`malformed pattern ${JSON.stringify(pattern)}: expected throw`);
}

// === 1. 空模式 / 空文本 ===
ok("", "");
no("", "a");
no("a", "");
ok("a", "a");

// === 2. 纯字面量与完整匹配锚定 ===
ok("abc", "abc");
no("abc", "ab");
no("abc", "abcd");
no("abc", "xabc");
no("ab", "abc");

// === 3. "." 匹配任意单字符（但不匹配空）===
ok(".", "a");
ok(".", "Z");
ok(".", "7");
ok(".", " ");
no(".", "");
no(".", "ab");
ok("...", "xyz");
no("...", "xy");
ok("a.c", "abc");
ok("a.c", "axc");
no("a.c", "ac");

// === 4. "*"：零或多，贪婪回溯 ===
ok("a*", "");
ok("a*", "a");
ok("a*", "aaaa");
no("a*", "b");
no("a*", "aaab");
ok("a*a", "a"); // 经典回溯：* 让出一个给末尾的 a
ok("a*a", "aa");
ok("a*a", "aaaaa");
no("a*a", "");
ok("a*b*c*", "");
ok("a*b*c*", "aaabbc");
ok(".*", "anything goes 123 ☕");
ok(".*", "");
ok("a.*z", "az");
ok("a.*z", "a-----z");
no("a.*z", "a-----y");

// === 5. "+"：一或多 ===
ok("a+", "a");
ok("a+", "aaa");
no("a+", "");
no("a+", "b");
ok("a+b+", "aabbb");
ok("a+b+", "aabb");
no("a+b+", "aa");
no("a+b+", "bb");
ok(".+", "x");
no(".+", "");
ok("ab+c", "abbbc");
no("ab+c", "ac");

// === 6. "?"：零或一 ===
ok("a?", "");
ok("a?", "a");
no("a?", "aa");
ok("ab?c", "abc");
ok("ab?c", "ac");
no("ab?c", "abbc");
ok("colou?r", "color");
ok("colou?r", "colour");
no("colou?r", "colouur");

// === 7. 字符类：列举 / 范围 / 否定 ===
ok("[abc]", "a");
ok("[abc]", "b");
ok("[abc]", "c");
no("[abc]", "d");
no("[abc]", "");
no("[abc]", "ab");
ok("[a-z]", "m");
no("[a-z]", "A");
no("[a-z]", "0");
ok("[A-Za-z0-9]", "G");
ok("[A-Za-z0-9]", "g");
ok("[A-Za-z0-9]", "5");
no("[A-Za-z0-9]", "-");
ok("[^abc]", "d");
ok("[^abc]", "Z");
no("[^abc]", "a");
no("[^a-z]", "q");
ok("[^a-z]", "Q");
ok("[^a-z]", "5");

// 类内的 '-' 字面量（首/尾位置）
ok("[-a]", "-");
ok("[-a]", "a");
ok("[a-]", "-");
ok("[a-]", "a");
no("[a-]", "b");

// === 8. 类 + 量词组合 ===
ok("[a-z]*", "");
ok("[a-z]*", "hello");
no("[a-z]*", "hello!");
ok("[a-z]+", "abc");
no("[a-z]+", "");
ok("[0-9]+", "2024");
no("[0-9]+", "20a4");
ok("[abc]?", "");
ok("[abc]?", "a");
no("[abc]?", "aa");
ok("[^ ]+", "nospace");
no("[^ ]+", "has space");
// 否定类 + * 贪婪回溯定位
ok("[^@]+@[^@]+", "user@host");
no("[^@]+@[^@]+", "userhost");
no("[^@]+@[^@]+", "a@b@c");

// === 9. 组合 / 贪婪交互 ===
ok("a.*b.*c", "axxbyyc");
ok("a.*b.*c", "abc");
no("a.*b.*c", "ab");
ok("[a-z]+[0-9]*", "abc");
ok("[a-z]+[0-9]*", "abc123");
no("[a-z]+[0-9]*", "123");
ok(".*a.*", "xxxax");
no(".*a.*", "xxxxx");
// "." 是任意而非字面量点；字面量点用普通字符位置体现
ok("a.b", "a.b");
ok("a.b", "axb");
ok("3.14", "3014"); // "." 匹配 '0'
ok("3.14", "3.14");

// === 10. unicode / emoji 单字符 ===
ok(".", "☕");
ok("..", "日本");
ok("[^x]", "☕");
ok("[a-z]+", "abc"); // 基础保活
ok(".*", "🎌🎌🎌");
no(".", "🎌🎌"); // 两个码点

// === 11. 非法 pattern 必须抛错（>= 8 个）===
bad("*"); // 量词无前导元素
bad("+");
bad("?");
bad("**");
bad("a**");
bad("a*+");
bad("?abc");
bad("[abc"); // 未闭合类
bad("[a-z"); // 未闭合类
bad("["); // 未闭合
bad("[]"); // 空类
bad("[^]"); // 空否定类
bad("]"); // 落单的 ']'
bad("[z-a]"); // 范围逆序
bad("a[b"); // 末尾未闭合

console.log(`OK mini-regex (${n} assertions)`);
process.exit(0);
