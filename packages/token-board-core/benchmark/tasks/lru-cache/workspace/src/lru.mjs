/**
 * LRU（最近最少使用）缓存
 *
 * 用法：
 *   const cache = new LRU(capacity);
 *   cache.put(key, value);   // 写入；满时淘汰最久未使用的条目
 *   cache.get(key);          // 读取；不存在返回 undefined；命中则标记为最近使用
 */
export default class LRU {
  constructor(capacity) {
    throw new Error("not implemented");
  }

  get(key) {
    throw new Error("not implemented");
  }

  put(key, value) {
    throw new Error("not implemented");
  }
}
