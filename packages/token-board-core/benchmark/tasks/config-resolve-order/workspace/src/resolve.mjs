import { defaults } from "./defaults.mjs";
import { envVars, envMapping } from "./env.mjs";

/**
 * 用户级覆盖（优先级最高）。
 * 这些值直接以正确类型存储，无需转换。
 */
const userOverrides = {
  cacheSize: 256,
  host: "prod.example.com",
  timeout: 10000,
};

/**
 * 从 envVars + envMapping 构建环境变量配置层。
 */
function buildEnvLayer() {
  const layer = {};
  for (const { envKey, configKey, type } of envMapping) {
    if (envVars.has(envKey)) {
      const raw = envVars.get(envKey);
      if (type === "number")  layer[configKey] = parseInt(raw, 10);
      else if (type === "boolean") layer[configKey] = raw === "true";
      else layer[configKey] = raw;
    }
  }
  return layer;
}

/**
 * 解析最终配置。
 *
 * 合并顺序（优先级从低到高）：
 *   1. defaults       — 兜底默认值
 *   2. env layer      — 环境变量覆盖
 *   3. userOverrides  — 用户显式配置（最高优先级）
 *
 * @returns {object} 合并后的最终配置对象
 */
export function resolveConfig() {
  const envLayer = buildEnvLayer();
  return { ...defaults, ...envLayer, ...userOverrides };
}

/**
 * 获取单个配置项的最终值。
 *
 * @param {string} key
 * @returns {*}
 */
export function getConfig(key) {
  return resolveConfig()[key];
}
