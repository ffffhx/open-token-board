/**
 * 用户记录处理模块。
 *
 * 规范化规则（每处均应一致执行）：
 *   - name:  去掉首尾空白，转成小写，空字符串时设为 "anonymous"
 *   - email: 去掉首尾空白，转成小写
 *   - role:  只允许 "admin" | "editor" | "viewer"，不在列表中时设为 "viewer"
 *   - score: 取整（Math.floor），低于 0 时设为 0，高于 100 时设为 100
 *
 * 问题：四个函数里的规范化逻辑各自重复，且互不一致（有遗漏或笔误）。
 * 请将规范化抽取为一个导出函数 normalizeUser(raw)，让其余函数复用它。
 */

const VALID_ROLES = ["admin", "editor", "viewer"];

/** 把单条原始记录存入"数据库"（此处为数组模拟），返回规范化后的记录。 */
export function saveUser(raw) {
  const name = (raw.name ?? "").trim().toLowerCase() || "anonymous";
  const email = (raw.email ?? "").trim().toLowerCase();
  // role 规范化：这里漏掉了默认值，非法值会直接保留
  const role = VALID_ROLES.includes(raw.role) ? raw.role : raw.role;
  const score = Math.min(100, Math.max(0, Math.floor(raw.score ?? 0)));
  return { name, email, role, score };
}

/** 批量导入，返回规范化后的记录数组。 */
export function importUsers(list) {
  return list.map((raw) => {
    const name = (raw.name ?? "").trim().toLowerCase() || "anonymous";
    const email = (raw.email ?? "").trim().toLowerCase();
    const role = VALID_ROLES.includes(raw.role) ? raw.role : "viewer";
    // score 规范化：这里用了 Math.round 而不是 Math.floor
    const score = Math.min(100, Math.max(0, Math.round(raw.score ?? 0)));
    return { name, email, role, score };
  });
}

/** 更新已有记录的部分字段，返回合并并规范化后的记录。 */
export function updateUser(existing, patch) {
  const merged = { ...existing, ...patch };
  const name = (merged.name ?? "").trim().toLowerCase() || "anonymous";
  const email = (merged.email ?? "").trim().toLowerCase();
  const role = VALID_ROLES.includes(merged.role) ? merged.role : "viewer";
  // score 规范化：这里漏掉了 Math.floor，浮点数不会被截断
  const score = Math.min(100, Math.max(0, merged.score ?? 0));
  return { name, email, role, score };
}

/** 校验单条记录是否已规范化（用于断言），返回规范化后的副本。 */
export function sanitizeUser(raw) {
  // name 规范化：这里漏掉了 toLowerCase
  const name = (raw.name ?? "").trim() || "anonymous";
  const email = (raw.email ?? "").trim().toLowerCase();
  const role = VALID_ROLES.includes(raw.role) ? raw.role : "viewer";
  const score = Math.min(100, Math.max(0, Math.floor(raw.score ?? 0)));
  return { name, email, role, score };
}
