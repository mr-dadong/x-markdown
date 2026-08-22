import type MarkdownIt from "markdown-it";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

export type TableAlignment = "left" | "center" | "right" | null;

interface TableMarkdownParserState {
  src: string;
  xmdOriginalMarkdown?: string;
  tokens: Array<{
    type: string;
    map: [number, number] | null;
    attrSet: (name: string, value: string) => void;
  }>;
}

const configuredTableMarkdownParsers = new WeakSet<object>();

type TableSerializerState = MarkdownSerializerState & {
  inTable: boolean;
  out: string;
};

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

interface MarkdownRange {
  from: number;
  to: number;
}

/** 找出已经闭合的行内代码范围，未闭合反引号保持原文语义。 */
const findInlineCodeRanges = (value: string): MarkdownRange[] => {
  const ranges: MarkdownRange[] = [];
  const backtickRuns = Array.from(value.matchAll(/`+/gu), (match) => {
    const from = match.index ?? 0;
    return {
      from,
      to: from + match[0].length,
      length: match[0].length,
    };
  });

  for (let runIndex = 0; runIndex < backtickRuns.length; runIndex += 1) {
    const opening = backtickRuns[runIndex];
    const closingIndex = backtickRuns.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > runIndex && candidate.length === opening.length,
    );
    if (closingIndex < 0) continue;

    const closing = backtickRuns[closingIndex];
    ranges.push({ from: opening.to, to: closing.from });
    runIndex = closingIndex;
  }

  return ranges;
};

export interface MarkdownTableCell {
  content: string;
  alignment: TableAlignment;
}

/** 中文等宽字符占两列，按显示宽度排版才能得到与 Typora 一致的表格列。 */
const getMarkdownDisplayWidth = (value: string): number =>
  Array.from(value).reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

/**
 * 按 TipTap 官方 Markdown 表格渲染方式先计算整列宽度，再一次性输出表格。
 * 这避免逐个单元格直接写入共享序列化状态造成标记串列或内容重复。
 */
export const renderMarkdownTable = (rows: readonly MarkdownTableCell[][]): string => {
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  if (columnCount === 0) return "";

  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      3,
      ...rows.map((row) => getMarkdownDisplayWidth(row[columnIndex]?.content ?? "")),
    )
  );
  const alignments = Array.from({ length: columnCount }, (_, columnIndex) =>
    rows.find((row) => row[columnIndex]?.alignment)?.[columnIndex]?.alignment ?? null
  );
  const padCell = (content: string, columnIndex: number): string =>
    content + " ".repeat(
      Math.max(0, columnWidths[columnIndex] - getMarkdownDisplayWidth(content)),
    );
  const renderRow = (row: readonly MarkdownTableCell[]): string =>
    `| ${Array.from({ length: columnCount }, (_, columnIndex) =>
      padCell(row[columnIndex]?.content ?? "", columnIndex)
    ).join(" | ")} |`;
  const renderDelimiter = (alignment: TableAlignment, columnIndex: number): string => {
    const width = columnWidths[columnIndex];
    if (alignment === "left") return `:${"-".repeat(width)}`;
    if (alignment === "right") return `${"-".repeat(width)}:`;
    if (alignment === "center") return `:${"-".repeat(width)}:`;
    return "-".repeat(width);
  };

  const lines = [
    renderRow(rows[0] ?? []),
    `| ${alignments.map(renderDelimiter).join(" | ")} |`,
    ...rows.slice(1).map(renderRow),
  ];
  return lines.join("\n");
};

/** 判断当前位置是否在已经闭合的行内代码中。 */
const isInsideRanges = (index: number, ranges: readonly MarkdownRange[]): boolean =>
  ranges.some((range) => index >= range.from && index < range.to);

/**
 * 表格普通文本中的裸竖线需要转义，避免被识别成下一列。
 * Typora 允许行内代码直接保留竖线，因此代码范围不写入额外反斜杠。
 */
export const escapeTablePipes = (
  value: string,
  escapeCodePipes = false,
): string => {
  let result = "";
  let consecutiveBackslashes = 0;
  const codeRanges = findInlineCodeRanges(value);

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "|") {
      if (
        (!isInsideRanges(index, codeRanges) || escapeCodePipes) &&
        consecutiveBackslashes % 2 === 0
      ) {
        result += "\\";
      }
      result += character;
      consecutiveBackslashes = 0;
      continue;
    }

    result += character;
    consecutiveBackslashes = character === "\\" ? consecutiveBackslashes + 1 : 0;
  }

  return result;
};

/** 判断原始表格是否明确使用了行内代码竖线转义。 */
export const hasEscapedCodePipes = (markdown: string): boolean =>
  markdown.split("\n").some((line) => {
    const codeRanges = findInlineCodeRanges(line);
    return codeRanges.some((range) => {
      for (let index = range.from; index < range.to; index += 1) {
        if (line[index] !== "|") continue;
        let backslashCount = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
          backslashCount += 1;
        }
        if (backslashCount % 2 === 1) return true;
      }
      return false;
    });
  });

/** 按 Typora 的代码范围规则拆分一行，记录每个单元格是否使用了 `\|`。 */
const getTableRowCodePipeStyles = (line: string): boolean[] => {
  const codeRanges = findInlineCodeRanges(line);
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    let backslashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
      backslashCount += 1;
    }
    const isSeparator =
      character === "|" &&
      !isInsideRanges(index, codeRanges) &&
      backslashCount % 2 === 0;
    if (isSeparator) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);

  if (line.trimStart().startsWith("|")) cells.shift();
  if (line.trimEnd().endsWith("|")) cells.pop();
  return cells.map(hasEscapedCodePipes);
};

/** 分隔行不属于内容节点，返回表头和所有正文行的单元格转义风格。 */
export const getTableCodePipeStyles = (markdown: string): boolean[][] => {
  const lines = markdown.split("\n");
  return lines
    .filter((_, lineIndex) => lineIndex !== 1)
    .map(getTableRowCodePipeStyles);
};

/**
 * ProseMirror 会给普通文本反引号补转义。孤立反引号不会形成 Markdown 代码，
 * 可以按 Typora 风格去掉转义；成对反引号必须保留，否则普通文本会被误存成行内代码。
 */
export const restoreTableBackticks = (value: string): string => {
  const normalized = value.replace(/\\(?=`)/gu, "");
  const backtickRuns = Array.from(normalized.matchAll(/`+/gu), (match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
    length: match[0].length,
  }));
  const pairedBackticks = new Set<number>();

  for (let runIndex = 0; runIndex < backtickRuns.length; runIndex += 1) {
    const opening = backtickRuns[runIndex];
    const closingIndex = backtickRuns.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > runIndex && candidate.length === opening.length,
    );
    if (closingIndex < 0) continue;

    const closing = backtickRuns[closingIndex];
    for (let index = opening.from; index < opening.to; index += 1) {
      pairedBackticks.add(index);
    }
    for (let index = closing.from; index < closing.to; index += 1) {
      pairedBackticks.add(index);
    }
    runIndex = closingIndex;
  }

  let result = "";
  let normalizedIndex = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "`") {
      if (pairedBackticks.has(normalizedIndex)) result += character;
      continue;
    }
    result += character;
    normalizedIndex += 1;
  }
  return result;
};

/**
 * 只在解析用的内存文本中保护行内代码竖线，禁止把这些反斜杠保存到文件。
 * Markdown-it 先切分表格列，再识别反引号；Typora 则允许代码中直接使用竖线。
 */
export const protectTableCodePipesForParsing = (markdown: string): string => {
  let fencedCodeMarker: string | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (fencedCodeMarker === null) fencedCodeMarker = marker;
        else if (marker[0] === fencedCodeMarker[0] && marker.length >= fencedCodeMarker.length) {
          fencedCodeMarker = null;
        }
        return line;
      }
      if (fencedCodeMarker !== null || !line.trimStart().startsWith("|")) return line;

      const codeRanges = findInlineCodeRanges(line);

      // 未闭合的反引号语义不明确，保持原文，避免把后续列分隔符写成反斜杠。
      if (codeRanges.length === 0) return line;

      let result = "";
      let consecutiveBackslashes = 0;

      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        const isInsideCode = isInsideRanges(index, codeRanges);
        if (
          character === "|" &&
          isInsideCode &&
          consecutiveBackslashes % 2 === 0
        ) {
          result += "\\";
        }
        result += character;
        consecutiveBackslashes =
          character === "\\" ? consecutiveBackslashes + 1 : 0;
      }

      return result;
    })
    .join("\n");
};

/**
 * 为 Markdown-it 增加 Typora 表格兼容，仅在解析内存中保护代码范围内的竖线。
 */
export const configureTyporaTableParsing = (markdown: MarkdownIt): void => {
  if (configuredTableMarkdownParsers.has(markdown)) return;
  configuredTableMarkdownParsers.add(markdown);

  markdown.core.ruler.before(
    "block",
    "xmd_protect_table_code_pipes",
    (state: TableMarkdownParserState) => {
      state.xmdOriginalMarkdown = state.src;
      state.src = protectTableCodePipesForParsing(state.src);
    },
  );
  markdown.core.ruler.after(
    "block",
    "xmd_remember_table_pipe_style",
    (state: TableMarkdownParserState) => {
      const originalMarkdown = state.xmdOriginalMarkdown;
      if (originalMarkdown === undefined) return;
      const originalLines = originalMarkdown.split("\n");

      state.tokens.forEach((token) => {
        if (token.type !== "table_open" || token.map === null) return;
        const [fromLine, toLine] = token.map;
        const tableMarkdown = originalLines.slice(fromLine, toLine).join("\n");
        const codePipeStyles = getTableCodePipeStyles(tableMarkdown);
        token.attrSet(
          "data-xmd-code-pipe-styles",
          encodeURIComponent(JSON.stringify(codePipeStyles)),
        );
      });
    },
  );
};

/** 使用真实 ProseMirror 行内序列化规则收集单元格，再交给整表渲染器统一输出。 */
export const serializeMarkdownTableNode = (
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
): void => {
  const tableState = state as TableSerializerState;
  /*
   * 标题、段落等前一个块可能仍处于待关闭状态。必须先把它的换行正式写入，
   * 否则临时收集首个单元格时会消费该状态，回退临时文本后表格就会粘到标题末尾。
   */
  state.write();
  tableState.inTable = true;
  const rows: MarkdownTableCell[][] = [];
  const codePipeStyles = node.attrs.codePipeStyles as boolean[][];

  node.forEach((row, _rowOffset, rowIndex) => {
    const cells: MarkdownTableCell[] = [];
    row.forEach((cell, _cellOffset, cellIndex) => {
      const cellContent = cell.firstChild;
      let content = "";
      if (cellContent && cellContent.content.size > 0) {
        const contentStart = tableState.out.length;
        state.renderInline(cellContent);
        content = escapeTablePipes(
          restoreTableBackticks(tableState.out.slice(contentStart)),
          codePipeStyles[rowIndex]?.[cellIndex] === true,
        );
        tableState.out = tableState.out.slice(0, contentStart);
      }
      cells.push({
        content,
        alignment: cell.attrs.alignment as TableAlignment,
      });
    });
    rows.push(cells);
  });

  state.write(renderMarkdownTable(rows));
  state.closeBlock(node);
  tableState.inTable = false;
};

/** 选择比代码内容中连续反引号更长的围栏，避免内容提前关闭代码块。 */
export const createCodeFence = (value: string): string => {
  const longestBackticks = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longestBackticks + 1));
};

/** 保留代码内容中的尾随换行，并额外补上关闭围栏所必需的结构性换行。 */
export const serializeFencedCodeBlock = (content: string, language: string): string => {
  const fence = createCodeFence(content);
  return `${fence}${language}\n${content}\n${fence}`;
};
