import MarkdownIt from "markdown-it";

/** 顶层块的源码行范围。行号为 0 起始，与 markdown-it 的 token.map 一致。 */
export interface BlockRange {
  startLine: number;
  endLine: number;
}

/**
 * 抽取顶层块所需的最小 token 结构。markdown-it 的 Token 天然满足，
 * 因此配置化实例与纯 markdown-it 实例产出的 token 流都能直接传入。
 */
export interface BlockTokenLike {
  nesting: number;
  map: [number, number] | null;
}

/**
 * 只用于块结构分析的解析器：顶层块数量由 Markdown 的块级结构决定，
 * 与编辑器注册了哪些自定义解析规则无关，因此不需要挂载扩展规则。
 */
const blockStructureParser = new MarkdownIt({ html: true });

/**
 * 从 markdown-it token 流中抽取每个顶层块（标题、段落、列表、表格、代码块等）
 * 的源码行范围。引用块、列表内部的块不单独计数。
 *
 * 视图同步与块级源码映射增量保存共用这一份 nesting 逻辑，避免两处实现漂移；
 * 调用方自行决定传入纯 markdown-it 还是挂载了全部扩展规则的配置化实例的 token。
 */
export const topLevelRangesFromTokens = (
  tokens: readonly BlockTokenLike[],
): BlockRange[] => {
  const ranges: BlockRange[] = [];
  let depth = 0;

  for (const token of tokens) {
    // 只统计最外层的块开始标记；引用块、列表内部的块不单独计数。
    if (token.nesting < 0) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.nesting > 0) {
      if (depth === 0 && token.map) {
        ranges.push({ startLine: token.map[0], endLine: token.map[1] });
      }
      depth += 1;
      continue;
    }
    // 自闭合块（围栏代码、分割线、HTML 块等）没有开闭标记。
    if (depth === 0 && token.map) {
      ranges.push({ startLine: token.map[0], endLine: token.map[1] });
    }
  }

  return ranges;
};

/**
 * 解析 Markdown 并返回每个顶层块在源码中的行范围，
 * 用于源码视图与渲染视图之间的位置映射。
 */
export const getTopLevelBlockRanges = (markdown: string): BlockRange[] =>
  topLevelRangesFromTokens(blockStructureParser.parse(markdown, {}));

/**
 * 两种视图的顶层块基本一一对应，数量差异通常只来自渲染视图结尾自动补充的
 * 空段落。这里直接按序号对齐并钳制，保证映射可逆：渲染→源码→渲染能回到
 * 同一个块。若改用按比例换算，块数不一致时映射不可逆，往返会整体漂移一个块。
 */
export const mapBlockIndex = (
  index: number,
  sourceCount: number,
  targetCount: number,
): number => {
  if (targetCount <= 0 || sourceCount <= 0) return 0;
  return Math.max(0, Math.min(index, targetCount - 1));
};

/** 查找包含指定行（0 起始）的顶层块序号，行号超出末尾时返回最后一个块。 */
export const findBlockIndexByLine = (
  ranges: readonly BlockRange[],
  line: number,
): number => {
  for (let index = 0; index < ranges.length; index += 1) {
    if (line < ranges[index].endLine) return index;
  }
  return ranges.length - 1;
};

/**
 * 源码行号（0 起始，可为小数）换算为所在顶层块序号与块内偏移比例。
 * 比例表示“视口顶部切入该块多深”，用于在渲染视图中恢复到块内同一相对位置，
 * 而不是粗暴地对齐到块顶，避免往返切换时位置跳动。
 */
export const sourceLineToBlockFraction = (
  ranges: readonly BlockRange[],
  line: number,
): { index: number; fraction: number } => {
  if (ranges.length === 0) return { index: 0, fraction: 0 };
  const index = findBlockIndexByLine(ranges, Math.floor(line));
  if (index < 0) return { index: 0, fraction: 0 };
  const range = ranges[index];
  const span = Math.max(1, range.endLine - range.startLine);
  const fraction = Math.min(1, Math.max(0, (line - range.startLine) / span));
  return { index, fraction };
};

/**
 * 顶层块序号与块内偏移比例换算为源码行号（0 起始，可为小数）。
 * 渲染视图记录的“切入块内多深”按比例落到源码块的对应行上。
 */
export const blockFractionToSourceLine = (
  ranges: readonly BlockRange[],
  index: number,
  fraction: number,
): number => {
  if (ranges.length === 0) return 0;
  const clamped = Math.max(0, Math.min(index, ranges.length - 1));
  const range = ranges[clamped];
  const span = range.endLine - range.startLine;
  return range.startLine + Math.min(1, Math.max(0, fraction)) * span;
};
