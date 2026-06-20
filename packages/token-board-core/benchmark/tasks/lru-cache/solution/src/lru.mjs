/**
 * LRU（最近最少使用）缓存
 *
 * 内部使用 Map（插入有序）模拟双向链表顺序：
 *   - Map 中最早插入（且未被刷新）的键即为"最久未使用"的条目。
 *   - 每次 get/put 命中时，先删除再重新插入，使其排到末尾（最近使用）。
 *   - 容量满时，删除 Map 的第一个键（最久未使用）。
 */
export default class LRU {
  constructor(capacity) {
    this._cap = capacity;
    this._map = new Map(); // key -> value，按访问时间排序（末尾最新）
  }

  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    // 刷新位置：删除后重新插入，使其成为最近使用
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }

  put(key, value) {
    if (this._map.has(key)) {
      // 已存在：删除旧记录，后面统一插入到末尾
      this._map.delete(key);
    } else if (this._map.size >= this._cap) {
      // 容量已满：淘汰最久未使用（Map 第一个条目）
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, value);
  }
}
