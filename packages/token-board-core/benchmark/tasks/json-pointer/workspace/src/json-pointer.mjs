// RFC6901 JSON Pointer 实现：get / set。
// 见 prompt 中的契约说明。当前实现存在多处缺陷，请按 prompt 修正。

function unescapeToken(token) {
  // 注意：转义顺序可能有问题。
  return token.replace(/~0/g, "~").replace(/~1/g, "/");
}

function parsePointer(pointer) {
  if (pointer === "") return [];
  return pointer.split("/").slice(1).map(unescapeToken);
}

export function get(doc, pointer) {
  const tokens = parsePointer(pointer);
  let cur = doc;
  for (const token of tokens) {
    cur = cur[token];
  }
  return cur;
}

export function set(doc, pointer, value) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;
  // 直接在输入上原地修改（错误：破坏了不可变性）。
  let cur = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (cur[t] == null) cur[t] = {};
    cur = cur[t];
  }
  cur[tokens[tokens.length - 1]] = value;
  return doc;
}

export default { get, set };
