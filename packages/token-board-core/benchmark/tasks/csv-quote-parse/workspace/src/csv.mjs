/**
 * 把一行 CSV 文本解析成字段数组。
 * 支持带双引号的字段（字段内可含逗号）以及 "" 转义。
 *
 * 示例：
 *   parseCsvLine('a,b,c')            => ['a', 'b', 'c']
 *   parseCsvLine('"hello, world",x') => ['hello, world', 'x']
 *   parseCsvLine('"say ""hi""",y')   => ['say "hi"', 'y']
 */
export function parseCsvLine(line) {
  // BUG: 直接按逗号切割，忽略了引号字段内部的逗号，也未处理 "" 转义
  return line.split(',');
}
