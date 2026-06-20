/**
 * 模拟环境变量层。
 * 在真实系统中这些值来自 process.env；此处用静态 Map 模拟，方便测试。
 *
 * 注意：所有环境变量值均为字符串，resolve.mjs 负责类型转换。
 *
 * 优先级高于 defaults，低于 userOverrides（见 resolve.mjs）。
 */
export const envVars = new Map([
  ["APP_PORT", "8080"],
  ["APP_MAX_RETRIES", "7"],
  ["APP_LOG_LEVEL", "warn"],
  ["APP_ENABLE_CACHE", "false"],
  ["APP_REGION", "ap-southeast-1"],
]);

/**
 * 环境变量 key → 配置 key 的映射，以及类型转换函数。
 * 类型：
 *   "string"  → 原样使用
 *   "number"  → parseInt(value, 10)
 *   "boolean" → value === "true"
 */
export const envMapping = [
  { envKey: "APP_PORT",         configKey: "port",        type: "number"  },
  { envKey: "APP_MAX_RETRIES",  configKey: "maxRetries",  type: "number"  },
  { envKey: "APP_LOG_LEVEL",    configKey: "logLevel",    type: "string"  },
  { envKey: "APP_ENABLE_CACHE", configKey: "enableCache", type: "boolean" },
  { envKey: "APP_REGION",       configKey: "region",      type: "string"  },
];
