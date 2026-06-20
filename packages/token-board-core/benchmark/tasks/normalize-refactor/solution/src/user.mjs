/**
 * 用户记录处理模块。
 *
 * 规范化规则（每处均应一致执行）：
 *   - name:  去掉首尾空白，转成小写，空字符串时设为 "anonymous"
 *   - email: 去掉首尾空白，转成小写
 *   - role:  只允许 "admin" | "editor" | "viewer"，不在列表中时设为 "viewer"
 *   - score: 取整（Math.floor），低于 0 时设为 0，高于 100 时设为 100
 */

const VALID_ROLES = ["admin", "editor", "viewer"];

/** 将原始用户对象规范化，返回规范化后的副本。 */
export function normalizeUser(raw) {
  const name = (raw.name ?? "").trim().toLowerCase() || "anonymous";
  const email = (raw.email ?? "").trim().toLowerCase();
  const role = VALID_ROLES.includes(raw.role) ? raw.role : "viewer";
  const score = Math.min(100, Math.max(0, Math.floor(raw.score ?? 0)));
  return { name, email, role, score };
}

/** 把单条原始记录存入"数据库"（此处为数组模拟），返回规范化后的记录。 */
export function saveUser(raw) {
  return normalizeUser(raw);
}

/** 批量导入，返回规范化后的记录数组。 */
export function importUsers(list) {
  return list.map(normalizeUser);
}

/** 更新已有记录的部分字段，返回合并并规范化后的记录。 */
export function updateUser(existing, patch) {
  return normalizeUser({ ...existing, ...patch });
}

/** 校验单条记录是否已规范化（用于断言），返回规范化后的副本。 */
export function sanitizeUser(raw) {
  return normalizeUser(raw);
}
