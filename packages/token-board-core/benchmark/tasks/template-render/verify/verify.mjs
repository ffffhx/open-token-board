import { render } from "../src/template.mjs";

let failed = null;
function fail(msg) {
  if (failed === null) failed = msg;
}

// 期望相等
function eq(label, tpl, data, expected) {
  let got;
  try {
    got = render(tpl, data);
  } catch (e) {
    fail(`${label}: threw ${e && e.message} (expected ${JSON.stringify(expected)})`);
    return;
  }
  if (got !== expected) {
    fail(`${label}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
  }
}

// 期望抛错
function throws(label, tpl, data) {
  let threw = false;
  try {
    render(tpl, data);
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}: expected throw but returned normally`);
}

// ---- 基础插值 ----
eq("plain text", "hello world", {}, "hello world");
eq("simple var", "Hi {{name}}!", { name: "Ann" }, "Hi Ann!");
eq("var with spaces", "{{   name   }}", { name: "Bob" }, "Bob");
eq("dotted path", "{{a.b.c}}", { a: { b: { c: "deep" } } }, "deep");
eq("number value", "n={{n}}", { n: 0 }, "n=0");
eq("number value 42", "{{n}}", { n: 42 }, "42");
eq("boolean false renders", "{{b}}", { b: false }, "false");
eq("boolean true renders", "{{b}}", { b: true }, "true");

// ---- 缺失路径 => 空串 ----
eq("missing top", "[{{nope}}]", {}, "[]");
eq("missing deep", "[{{a.b.c}}]", { a: { b: {} } }, "[]");
eq("missing through null", "[{{a.b}}]", { a: null }, "[]");
eq("missing through primitive", "[{{a.b}}]", { a: 5 }, "[]");
eq("null value empty", "[{{x}}]", { x: null }, "[]");
eq("undefined value empty", "[{{x}}]", { x: undefined }, "[]");
eq("empty interpolation", "[{{}}]", { x: 1 }, "[]");

// ---- HTML 转义（默认） ----
eq("escape all", "{{x}}", { x: "<a&b>\"q'z" }, "&lt;a&amp;b&gt;&quot;q&#39;z");
eq("escape amp only", "{{x}}", { x: "Tom & Jerry" }, "Tom &amp; Jerry");
eq("escape angle", "{{x}}", { x: "<script>" }, "&lt;script&gt;");
eq("escape quote double", "{{x}}", { x: 'say "hi"' }, "say &quot;hi&quot;");
eq("escape apostrophe", "{{x}}", { x: "it's" }, "it&#39;s");
eq("escape ampersand-first ordering", "{{x}}", { x: "&lt;" }, "&amp;lt;");

// ---- 原样插值 {{{ }}} ----
eq("raw no escape", "{{{x}}}", { x: "<b>&</b>" }, "<b>&</b>");
eq("raw with spaces", "{{{  x  }}}", { x: "<i>" }, "<i>");
eq("raw missing empty", "[{{{nope}}}]", {}, "[]");
eq("raw dotted", "{{{a.b}}}", { a: { b: "<x>" } }, "<x>");
eq("raw number", "{{{n}}}", { n: 7 }, "7");

// ---- 字面量花括号 ----
eq("single brace literal", "a { b } c", {}, "a { b } c");
eq("json-ish literal", '{ "k": {{v}} }', { v: 1 }, '{ "k": 1 }');

// ---- if 区块 ----
eq("if true", "{{#if ok}}YES{{/if}}", { ok: true }, "YES");
eq("if false", "A{{#if ok}}YES{{/if}}B", { ok: false }, "AB");
eq("if missing", "A{{#if ok}}YES{{/if}}B", {}, "AB");
eq("if zero falsy", "{{#if n}}x{{/if}}", { n: 0 }, "");
eq("if empty string falsy", "{{#if s}}x{{/if}}", { s: "" }, "");
eq("if nonempty string truthy", "{{#if s}}x{{/if}}", { s: "a" }, "x");
eq("if empty array falsy", "{{#if xs}}x{{/if}}", { xs: [] }, "");
eq("if nonempty array truthy", "{{#if xs}}x{{/if}}", { xs: [0] }, "x");
eq("if object truthy", "{{#if o}}x{{/if}}", { o: {} }, "x");
eq("if number positive truthy", "{{#if n}}x{{/if}}", { n: 3 }, "x");
eq("if dotted path", "{{#if a.b}}x{{/if}}", { a: { b: 1 } }, "x");
eq("if interpolation inside", "{{#if u}}Hi {{u.name}}{{/if}}", { u: { name: "Ann" } }, "Hi Ann");
eq("if escapes inside", "{{#if u}}{{u}}{{/if}}", { u: "<b>" }, "&lt;b&gt;");

// ---- each 区块 ----
eq("each basic", "{{#each xs}}[{{.}}]{{/each}}", { xs: ["a", "b", "c"] }, "[a][b][c]");
eq("each index", "{{#each xs}}{{@index}}:{{.}};{{/each}}", { xs: ["x", "y"] }, "0:x;1:y;");
eq("each empty array", "A{{#each xs}}x{{/each}}B", { xs: [] }, "AB");
eq("each missing", "A{{#each xs}}x{{/each}}B", {}, "AB");
eq("each non-array", "A{{#each xs}}x{{/each}}B", { xs: 5 }, "AB");
eq("each of objects field", "{{#each xs}}{{name}},{{/each}}", { xs: [{ name: "a" }, { name: "b" }] }, "a,b,");
eq("each dot field", "{{#each xs}}{{.id}}|{{/each}}", { xs: [{ id: 1 }, { id: 2 }] }, "1|2|");
eq("each escapes item", "{{#each xs}}{{.}}{{/each}}", { xs: ["<a>", "&"] }, "&lt;a&gt;&amp;");
eq("each raw item", "{{#each xs}}{{{.}}}{{/each}}", { xs: ["<a>", "&"] }, "<a>&");

// ---- 嵌套 ----
eq("nested if in each", "{{#each xs}}{{#if .}}<{{.}}>{{/if}}{{/each}}", { xs: ["a", "", "b"] }, "<a><b>");
eq("nested each in each", "{{#each rows}}{{#each .}}({{.}}){{/each}}|{{/each}}", { rows: [[1, 2], [3]] }, "(1)(2)|(3)|");
eq("nested if in if", "{{#if a}}{{#if b}}AB{{/if}}{{/if}}", { a: 1, b: 1 }, "AB");
eq("nested if in if inner false", "{{#if a}}X{{#if b}}AB{{/if}}Y{{/if}}", { a: 1, b: 0 }, "XY");
eq("each then index after nested", "{{#each xs}}{{@index}}={{#each .tags}}{{.}}{{/each}};{{/each}}",
  { xs: [{ tags: ["p", "q"] }, { tags: ["r"] }] }, "0=pq;1=r;");

// ---- 非法模板：抛错 ----
throws("unclosed if", "{{#if a}}x", { a: 1 });
throws("unclosed each", "{{#each a}}x", { a: [] });
throws("stray close if", "{{/if}}", {});
throws("stray close each", "{{/each}}", {});
throws("mismatch if/each", "{{#if a}}{{/each}}", { a: 1 });
throws("mismatch each/if", "{{#each a}}{{/if}}", { a: [] });
throws("extra close after valid", "{{#if a}}x{{/if}}{{/if}}", { a: 1 });
throws("non-string template", 12345, {});

if (failed !== null) {
  console.error(`FAIL ${failed}`);
  process.exit(1);
}
console.log("OK template-render");
process.exit(0);
