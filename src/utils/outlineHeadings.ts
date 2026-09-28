import MarkdownIt from "markdown-it";

/*
 * 大纲标题扫描：从 Markdown 源码里按出现顺序找出标题。
 *
 * 预览模式用文档节点算光标所在标题的下标，源码模式用光标行号算同一套下标，
 * 两条路径都必须与这份扫描结果对齐（大纲面板的点击跳转也按下标定位）。
 */

export interface OutlineHeading {
  /** 0 起始的源码行号；下划线式标题取标题文字所在的那一行。 */
  line: number;
  level: number;
  /** 标题的可见文字：去掉 Markdown 定界符后的纯文本。 */
  text: string;
}

const inlineMarkdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false });

const getHeadingPlainText = (source: string): string => {
  const inlineToken = inlineMarkdownParser.parseInline(source, {})[0];
  if (!inlineToken?.children) return source.trim();

  // 大纲只展示标题的可见文字，粗体、链接、行内代码等 Markdown 定界符不应出现。
  return inlineToken.children
    .filter(
      (token) =>
        token.type === "text" || token.type === "code_inline" || token.type === "image",
    )
    .map((token) => token.content)
    .join("")
    .trim();
};

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const ATX_PATTERN = /^ {0,3}(#{1,6})\s+(.+)$/u;
const SETEXT_PATTERN = /^ {0,3}(=+|-+)\s*$/u;
// 下划线式标题的上一行必须是普通正文行：列表项、引用、表格、标题自身后面的
// 分隔线都不是 setext 下划线（CommonMark 里那些是列表或水平线）。
const NON_PARAGRAPH_LINE_PATTERN = /^ {0,3}(?:[-+*]|\d+[.)]|>|\||#{1,6}\s|=+|-+)/u;

export const scanOutlineHeadings = (markdown: string): OutlineHeading[] => {
  // 先把 CRLF 统一成 LF，避免行尾的 \r 让标题匹配失败。
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const headings: OutlineHeading[] = [];
  let codeFence: { marker: string; length: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      // 代码块里的“# 注释”不是文档标题，必须排除，否则后面的标题会整体错位。
      if (!codeFence) {
        codeFence = { marker, length };
      } else if (codeFence.marker === marker && length >= codeFence.length) {
        codeFence = null;
      }
      continue;
    }
    if (codeFence) continue;

    const atxMatch = line.match(ATX_PATTERN);
    if (atxMatch) {
      // ATX 标题末尾允许使用一组 # 作为闭合标记，这组字符不是标题正文。
      const headingSource = atxMatch[2].replace(/\s+#+\s*$/u, "").trim();
      headings.push({
        line: lineIndex,
        level: atxMatch[1].length,
        text: getHeadingPlainText(headingSource),
      });
      continue;
    }

    // 下划线式标题：解析器同样会把它变成标题节点，漏掉会让大纲与文档顺序错位。
    const setextMatch = line.match(SETEXT_PATTERN);
    const previousLine = lineIndex > 0 ? lines[lineIndex - 1] : "";
    if (
      setextMatch &&
      previousLine.trim() !== "" &&
      !NON_PARAGRAPH_LINE_PATTERN.test(previousLine)
    ) {
      headings.push({
        line: lineIndex - 1,
        level: setextMatch[1][0] === "=" ? 1 : 2,
        text: getHeadingPlainText(previousLine.trim()),
      });
    }
  }

  return headings;
};

/**
 * 光标在第 line 行（0 起始）时所在的标题下标：
 * 取不晚于该行的最后一个标题；光标在第一个标题之前时返回 -1。
 */
export const findActiveHeadingByLine = (
  headings: readonly OutlineHeading[],
  line: number,
): number => {
  let active = -1;
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index].line > line) break;
    active = index;
  }
  return active;
};
