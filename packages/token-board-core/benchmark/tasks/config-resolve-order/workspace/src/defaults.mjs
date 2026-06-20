/**
 * 默认配置：所有配置项的基础值。
 * 优先级最低，会被 env.mjs 和 userOverrides 覆盖。
 */
export const defaults = {
  host: "localhost",
  port: 3000,
  maxRetries: 3,
  timeout: 5000,
  logLevel: "info",
  enableCache: true,
  cacheSize: 128,
  region: "us-east-1",
};
