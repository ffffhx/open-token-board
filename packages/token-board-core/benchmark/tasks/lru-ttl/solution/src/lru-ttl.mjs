/**
 * 带 TTL 的 LRU 缓存（逻辑时钟版）。
 *
 * 内部用 Map（保持插入顺序）模拟「最近使用」队列：
 *   - Map 末尾 = 最近使用，Map 头部 = 最久未使用。
 *   - 每个条目存 { value, expireAt }，expireAt = insertedAt + ttl。
 *
 * 过期判定：now >= expireAt 即过期。过期条目在被 get 命中时视为不存在并删除。
 * 淘汰策略：容量溢出时优先淘汰「已过期」条目（按 Map 顺序，最久未使用的过期项先删），
 *           若无过期条目则淘汰最久未使用（Map 头部）条目。
 */
export default class Cache {
  constructor(capacity, defaultTtl) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    if (!Number.isInteger(defaultTtl) || defaultTtl <= 0) {
      throw new Error("defaultTtl must be a positive integer");
    }
    this._cap = capacity;
    this._defaultTtl = defaultTtl;
    this._map = new Map(); // key -> { value, expireAt }
  }

  get size() {
    return this._map.size;
  }

  get(key, now) {
    const entry = this._map.get(key);
    if (entry === undefined) return undefined;
    if (now >= entry.expireAt) {
      // 过期：视为不存在并删除
      this._map.delete(key);
      return undefined;
    }
    // 命中：刷新最近使用顺序（删除后重新插入到末尾）
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  set(key, value, now, ttl) {
    const effectiveTtl = ttl === undefined ? this._defaultTtl : ttl;
    if (!Number.isInteger(effectiveTtl) || effectiveTtl <= 0) {
      throw new Error("ttl must be a positive integer");
    }
    const entry = { value, expireAt: now + effectiveTtl };

    if (this._map.has(key)) {
      // 更新：删除旧位置，稍后插入到末尾（刷新最近使用 + 重置 insertedAt）
      this._map.delete(key);
      this._map.set(key, entry);
      return;
    }

    // 新键：若已满需先淘汰
    if (this._map.size >= this._cap) {
      this._evict(now);
    }
    this._map.set(key, entry);
  }

  _evict(now) {
    // 优先淘汰已过期条目（按 Map 顺序选第一个过期的）
    for (const [k, e] of this._map) {
      if (now >= e.expireAt) {
        this._map.delete(k);
        return;
      }
    }
    // 无过期条目：淘汰最久未使用（Map 头部）
    const oldest = this._map.keys().next().value;
    this._map.delete(oldest);
  }
}
