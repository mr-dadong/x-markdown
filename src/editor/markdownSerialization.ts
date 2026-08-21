export type TableAlignment = "left" | "center" | "right" | null;

/** 把 HTML 表格单元格中的对齐样式转换为 Markdown 可保存的有限取值。 */
export const parseTableAlignment = (value: string | null): TableAlignment => {
  const alignment = value?.trim().toLowerCase();
  return alignment === "left" || alignment === "center" || alignment === "right"
    ? alignment
    : null;
};

/** 根据单元格对齐方式生成 GFM 表格分隔行。 */
export const createTableDelimiter = (alignment: TableAlignment): string => {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
};

/**
 * 表格中的裸竖线会被 Markdown 解析器当成下一列的起点。
 * 已转义的竖线保持不变，其余竖线统一补上反斜杠。
 */
export const escapeTablePipes = (value: string): string => {
  let result = "";
  let consecutiveBackslashes = 0;

  for (const character of value) {
    if (character === "|") {
      if (consecutiveBackslashes % 2 === 0) result += "\\";
      result += character;
      consecutiveBackslashes = 0;
      continue;
    }

    result += character;
    consecutiveBackslashes = character === "\\" ? consecutiveBackslashes + 1 : 0;
  }

  return result;
};

/** 选择比代码内容中连续反引号更长的围栏，避免内容提前关闭代码块。 */
export const createCodeFence = (value: string): string => {
  const longestBackticks = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longestBackticks + 1));
};

/** 代码内容已有多少尾随换行就保留多少，只补关闭围栏所必需的一个换行。 */
export const serializeFencedCodeBlock = (content: string, language: string): string => {
  const fence = createCodeFence(content);
  const closingNewline = content.endsWith("\n") ? "" : "\n";
  return `${fence}${language}\n${content}${closingNewline}${fence}`;
};
