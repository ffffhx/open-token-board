// RFC6901 JSON Pointer 实现：get / set。
// 见 prompt 中的完整契约说明。

function isInteger(token) {
  return /^(0|[1-9][0-9]*)$/.test(token);
}

function unescapeToken(token) {
  // 顺序重要：先 ~1 => "/"，再 ~0 => "~"。
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePointer(pointer) {
  if (typeof pointer !== "string") {
    throw new Error("pointer must be a string");
  }
  if (pointer === "") return [];
  if (pointer[0] !== "/") {
    throw new Error(`invalid JSON pointer: ${pointer}`);
  }
  return pointer
    .split("/")
    .slice(1)
    .map(unescapeToken);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function get(doc, pointer) {
  const tokens = parsePointer(pointer);
  let cur = doc;
  for (const token of tokens) {
    if (Array.isArray(cur)) {
      if (!isInteger(token)) {
        throw new Error(`invalid array index: ${token}`);
      }
      const idx = Number(token);
      if (idx < 0 || idx >= cur.length) {
        throw new Error(`array index out of range: ${token}`);
      }
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      if (!Object.prototype.hasOwnProperty.call(cur, token)) {
        throw new Error(`missing key: ${token}`);
      }
      cur = cur[token];
    } else {
      throw new Error(`cannot descend into non-container at token: ${token}`);
    }
  }
  return cur;
}

function shallowCopy(node) {
  if (Array.isArray(node)) return node.slice();
  if (isPlainObject(node)) return { ...node };
  return node;
}

export function set(doc, pointer, value) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    // 整文档替换
    return value;
  }

  // 决定根容器类型：若第一个 token 是整数或 "-"，且原 doc 是数组，则数组；
  // 否则若原 doc 是对象则对象；若原 doc 不是容器则按 token 类型新建。
  function build(node, index) {
    const token = tokens[index];
    const isLast = index === tokens.length - 1;

    // 判定本层应为数组还是对象
    const wantArray =
      token === "-" || isInteger(token)
        ? // token 看起来像数组用法。但若现有 node 是对象（非空 plain object），
          // 仍按对象处理（对象的数字键合法）。
          !isPlainObject(node)
        : false;

    if (token === "-") {
      // "-" 只能用于数组追加
      const arr = Array.isArray(node) ? node.slice() : [];
      if (isLast) {
        arr.push(value);
        return arr;
      }
      const child = build(undefined, index + 1);
      arr.push(child);
      return arr;
    }

    if (wantArray) {
      const arr = Array.isArray(node) ? node.slice() : [];
      const idx = Number(token);
      if (idx < 0) {
        throw new Error(`invalid array index: ${token}`);
      }
      // 允许 idx === arr.length（追加），不允许 idx > arr.length 出现空洞？
      // RFC 对 set 未严格定义；本实现：idx 必须 <= arr.length。
      if (idx > arr.length) {
        throw new Error(`array index out of range for set: ${token}`);
      }
      if (isLast) {
        arr[idx] = value;
        return arr;
      }
      const child = build(arr[idx], index + 1);
      arr[idx] = child;
      return arr;
    }

    // 对象路径
    const obj = isPlainObject(node) ? { ...node } : {};
    if (isLast) {
      obj[token] = value;
      return obj;
    }
    const existing = Object.prototype.hasOwnProperty.call(obj, token)
      ? obj[token]
      : undefined;
    obj[token] = build(existing, index + 1);
    return obj;
  }

  return build(doc, 0);
}

export default { get, set };
