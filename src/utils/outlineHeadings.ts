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

/*
 * HTML 块识别（对齐 CommonMark，标记语言里的 “# 开头一行” 不是 Markdown 标题）。
 * 不识别的话，`<div>` 里的一行 `# 说明` 会在大纲里凭空多出一条，
 * 后续标题下标整体后移，高亮与跳转就都错位了。
 */

// CommonMark 的块级标签：这些标签出现在行首会开启一个 HTML 块（类型 6），块到空行结束。
const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption",
  "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1",
  "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend",
  "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup",
  "option", "p", "param", "search", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "title", "tr", "track", "ul",
]);

/** HTML 块的开头：close 为 null 表示「到空行为止」，否则读到 close 匹配的那一行为止。 */
interface HtmlBlockStart {
  close: RegExp | null;
}

// CommonMark 类型 1-5：有专属结束标记的 HTML 块。
const HTML_BLOCK_SPECIAL_STARTS: Array<{ open: RegExp; close: RegExp }> = [
  { open: /^ {0,3}<(?:script|pre|style|textarea)(?=[\s>]|$)/iu, close: /<\/(?:script|pre|style|textarea)>/iu },
  { open: /^ {0,3}<!--/u, close: /-->/u },
  { open: /^ {0,3}<\?/u, close: /\?>/u },
  { open: /^ {0,3}<![a-z]/iu, close: />/u },
  { open: /^ {0,3}<!\[CDATA\[/u, close: /\]\]>/u },
];

const HTML_BLOCK_TAG_PATTERN = /^ {0,3}<\/?([a-z][a-z0-9-]*)(?=[\s/>]|$)/iu;

/** 判断这一行是否开启一个 HTML 块；不开启时返回 null。 */
const detectHtmlBlockStart = (line: string): HtmlBlockStart | null => {
  for (const candidate of HTML_BLOCK_SPECIAL_STARTS) {
    if (candidate.open.test(line)) return { close: candidate.close };
  }

  const tagMatch = line.match(HTML_BLOCK_TAG_PATTERN);
  if (tagMatch && HTML_BLOCK_TAGS.has(tagMatch[1].toLowerCase())) {
    // 类型 6 一律读到空行，闭合标签不结束块（与 CommonMark 一致）。
    return { close: null };
  }
  return null;
};

export const scanOutlineHeadings = (markdown: string): OutlineHeading[] => {
  // 先把 CRLF 统一成 LF，避免行尾的 \r 让标题匹配失败。
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const headings: OutlineHeading[] = [];
  let codeFence: { marker: string; length: number } | null = null;
  // 块级公式内部照抄源码，公式里的 “# 开头的一行” 不是标题。
  let inMathBlock = false;
  // 正在一个 HTML 块内部时，块里的内容一律不当标题。
  let htmlBlock: HtmlBlockStart | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    // HTML 块内的行先判断是否结束：读到闭合标记、或（类型 6）遇到空行即结束。
    if (htmlBlock) {
      const closed = htmlBlock.close ? htmlBlock.close.test(line) : line.trim() === "";
      if (closed) htmlBlock = null;
      continue;
    }

    /*
     * 块级公式与 Math.ts 的解析规则保持一致：单独一行 $$ 起始、单独一行 $$ 结束。
     * 不排除它的话，公式里以 # 开头的行会在大纲里凭空多出一条条目，
     * 后续标题的下标整体后移，高亮与跳转就都错位了。
     */
    if (line.trim() === "$$") {
      inMathBlock = !inMathBlock;
      continue;
    }
    if (inMathBlock) continue;

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

    const htmlStart = detectHtmlBlockStart(line);
    if (htmlStart) {
      // 开标签这一行本身不是标题。单行即可闭合的（如 <!-- x -->）不进块内状态。
      htmlBlock = htmlStart.close && htmlStart.close.test(line) ? null : htmlStart;
      continue;
    }

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
