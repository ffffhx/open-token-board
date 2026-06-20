import { renderInline } from "../src/md.mjs";

let n = 0;
function fail(msg) {
  console.error(`FAIL[#${n}] ${msg}`);
  process.exit(1);
}
function eq(input, want, label) {
  n++;
  let got;
  try {
    got = renderInline(input);
  } catch (e) {
    fail(`${label}: threw ${e && e.message}`);
    return;
  }
  if (got !== want) {
    fail(`${label}: in=${JSON.stringify(input)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
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

// --- 0. 类型校验：非字符串必须抛错 ---
throws(() => renderInline(123), "number throws");
throws(() => renderInline(null), "null throws");
throws(() => renderInline(undefined), "undefined throws");
throws(() => renderInline({}), "object throws");

// --- 1. 纯文本（无标记）---
eq("", "", "empty string");
eq("hello world", "hello world", "plain");
eq("a b   c", "a b   c", "spaces preserved");

// --- 2. HTML 转义，& 必须先转 ---
eq("a & b", "a &amp; b", "ampersand");
eq("a < b > c", "a &lt; b &gt; c", "lt gt");
eq("<script>", "&lt;script&gt;", "tag escaped");
eq("&amp;", "&amp;amp;", "ampersand-first: existing entity re-escaped");
eq("a&b&c", "a&amp;b&amp;c", "multiple ampersands");
eq("&<>", "&amp;&lt;&gt;", "all three specials");

// --- 3. 粗体 / 斜体 ---
eq("**bold**", "<strong>bold</strong>", "double star bold");
eq("__bold__", "<strong>bold</strong>", "double underscore bold");
eq("*italic*", "<em>italic</em>", "single star em");
eq("_italic_", "<em>italic</em>", "single underscore em");
eq("**bold** and *italic*", "<strong>bold</strong> and <em>italic</em>", "mixed");
eq("a**b**c", "a<strong>b</strong>c", "bold mid-word");

// --- 4. 嵌套 ---
eq("**a *b* c**", "<strong>a <em>b</em> c</strong>", "bold containing em");
eq("*a `b` c*", "<em>a <code>b</code> c</em>", "em containing code");
eq("__a _b_ c__", "<strong>a <em>b</em> c</strong>", "double-underscore containing single (skips single when matching double)");

// --- 5. 代码段：内部不解析 markdown，仅 HTML 转义 ---
eq("`code`", "<code>code</code>", "basic code");
eq("`*not bold*`", "<code>*not bold*</code>", "no markdown in code");
eq("`a & b < c > d`", "<code>a &amp; b &lt; c &gt; d</code>", "html-escape in code");
eq("`[x](y)`", "<code>[x](y)</code>", "no link in code");
eq("a `b` `c` d", "a <code>b</code> <code>c</code> d", "two code spans");
eq("`\\n`", "<code>\\n</code>", "no backslash processing inside code");

// --- 6. 链接 ---
eq("[text](http://x.com)", '<a href="http://x.com">text</a>', "basic link");
eq("[a & b](http://x?y=1&z=2)", '<a href="http://x?y=1&amp;z=2">a &amp; b</a>', "escape text and url");
eq("[**bold**](u)", '<a href="u"><strong>bold</strong></a>', "markdown inside link text");
eq('[x](a"b)', '<a href="a&quot;b">x</a>', "quote in url escaped");
eq("[<y>](<z>)", '<a href="&lt;z&gt;">&lt;y&gt;</a>', "lt gt in text and url");
eq("[](u)", '<a href="u"></a>', "empty text");
eq("[t]()", '<a href="">t</a>', "empty url");
eq("[a](b(c)d)", '<a href="b(c)d">a</a>', "balanced parens in url");
eq("[outer [inner] x](u)", '<a href="u">outer [inner] x</a>', "balanced brackets in text");
eq("[x](u) [y](v)", '<a href="u">x</a> <a href="v">y</a>', "two links");

// --- 7. 反斜杠转义 ---
eq("\\*not italic\\*", "*not italic*", "escaped stars literal");
eq("\\_a\\_", "_a_", "escaped underscores literal");
eq("\\`code\\`", "`code`", "escaped backticks literal");
eq("\\[x\\](y)", "[x](y)", "escaped brackets -> not a link");
eq("\\\\", "\\", "escaped backslash");
eq("a\\b", "a\\b", "backslash before normal char stays literal");
eq("100% \\* off", "100% * off", "escaped star in text");
eq("\\&", "\\&amp;", "backslash before & : backslash literal, & escaped");

// --- 8. 不匹配 / 不平衡标记 -> 字面量 ---
eq("unmatched * star", "unmatched * star", "lone star literal");
eq("unmatched ** stars", "unmatched ** stars", "lone double-star literal");
eq("unmatched ` tick", "unmatched ` tick", "lone backtick literal");
eq("**unclosed bold", "**unclosed bold", "unclosed bold literal");
eq("*unclosed", "*unclosed", "unclosed em literal");
eq("[notlink", "[notlink", "unclosed bracket literal");
eq("[text]no paren", "[text]no paren", "bracket without paren literal");
eq("a*b", "a*b", "single star no close");
eq("`unclosed", "`unclosed", "unclosed code literal");

// --- 9. 多个标记 / 确定性 ---
eq("**a**b**c**", "<strong>a</strong>b<strong>c</strong>", "two bold spans");
eq("*a*b*c*", "<em>a</em>b<em>c</em>", "two em spans");
eq("[a](u1) and **b**", '<a href="u1">a</a> and <strong>b</strong>', "link then bold");

// --- 10. unicode / emoji ---
eq("café ☕ 日本語", "café ☕ 日本語", "unicode passthrough");
eq("**日本語**", "<strong>日本語</strong>", "bold unicode");
eq("[☕](http://x/☕)", '<a href="http://x/☕">☕</a>', "emoji in link");

// --- 11. 组合 ---
eq(
  "Use `git commit` & **push** to [repo](https://x?a=1&b=2)",
  'Use <code>git commit</code> &amp; <strong>push</strong> to <a href="https://x?a=1&amp;b=2">repo</a>',
  "combined"
);
eq("*em with [l](u) in*", '<em>em with <a href="u">l</a> in</em>', "link inside em");
eq("**bold with `c`**", "<strong>bold with <code>c</code></strong>", "code inside bold");

// --- 12. 大输入（性能 + 正确）---
{
  const N = 20000;
  const inA = "**x**".repeat(N);
  const wantA = "<strong>x</strong>".repeat(N);
  eq(inA, wantA, "large repeated bold");
  const inB = "a & b ".repeat(N);
  const wantB = "a &amp; b ".repeat(N);
  eq(inB, wantB, "large repeated escape");
}

console.log(`OK markdown-inline (${n} assertions)`);
process.exit(0);
