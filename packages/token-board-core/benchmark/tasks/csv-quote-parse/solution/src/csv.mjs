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
  const fields = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma produced an empty last field — already pushed above; break
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            // Escaped quote ""
            field += '"';
            i += 2;
          } else {
            // Closing quote
            i++;
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      // Skip the comma separator (or we're at end of string)
      if (line[i] === ',') i++;
    } else {
      // Unquoted field — read until next comma
      const start = i;
      while (i < line.length && line[i] !== ',') {
        i++;
      }
      fields.push(line.slice(start, i));
      if (line[i] === ',') i++;
    }
  }

  return fields;
}
