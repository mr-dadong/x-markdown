import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw } from "./markdown/shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const RAW_TOKEN_NAME = "xmdRawMarkdown";

/** 不认识的扩展块：Pandoc 风格 :::name 或 wiki 风格 [[链接]]。 */
const EXTENSION_BLOCK_PATTERN = /^:::[\w-]+/u;
const WIKI_LINK_PATTERN = /\[\[[^\]]+\]\]/u;

/** 找出行内容与给定标记完全相同的行，用于配对 frontmatter 的 --- 围栏。 */
const findClosingLine = (lines: readonly string[], marker: string): number => {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === marker) return index;
  }
  return -1;
};

/** 找到段落结束位置：第一处空行。 */
const findParagraphEnd = (lines: readonly string[]): number => {
  let index = 1;
  while (index < lines.length && lines[index].trim() !== "") index += 1;
  return index;
};

/**
 * 解析「不理解的扩展块」，原样保存源码以便在源码模式里继续编辑。
 *
 * frontmatter（文档开头的 --- ... ---）只在 `isDocumentStart` 为真时识别，
 * 与旧实现要求的 startLine === 0 一致；否则 --- 应交给分隔线处理。
 */
const tokenizeRawMarkdown = (src: string, isDocumentStart: boolean): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const firstLine = lines[0] ?? "";
  const trimmedLine = firstLine.trim();
  let consumed = -1;

  if (isDocumentStart && trimmedLine === "---") {
    const closingLine = findClosingLine(lines, "---");
    if (closingLine > 0) consumed = closingLine + 1;
  } else if (EXTENSION_BLOCK_PATTERN.test(trimmedLine) || WIKI_LINK_PATTERN.test(firstLine)) {
    consumed = findParagraphEnd(lines);
  }

  if (consumed < 0) return undefined;

  return {
    type: RAW_TOKEN_NAME,
    raw: takeBlockRaw(lines, consumed),
    rawMarkdown: lines.slice(0, consumed).join("\n"),
  } as MarkdownToken;
};

export const RawMarkdownBlock = Node.create({
  name: "rawMarkdownBlock",
  group: "block",
  atom: true,
  priority: 1000,

  addAttributes() {
    return {
      raw: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre[data-xmd-raw-markdown]",
        getAttrs: (element) => ({
          raw: element instanceof HTMLElement ? element.textContent ?? "" : "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { raw, ...elementAttributes } = HTMLAttributes;
    return [
      "pre",
      mergeAttributes(elementAttributes, {
        "data-xmd-raw-markdown": "",
        class: "my-4 overflow-x-auto rounded-md border border-line bg-toolbar p-3 font-mono text-[13px] leading-5 text-secondary",
        contenteditable: "false",
      }),
      String(raw ?? ""),
    ];
  },

  markdownTokenName: RAW_TOKEN_NAME,

  parseMarkdown: (token) => ({
    type: "rawMarkdownBlock",
    attrs: { raw: String(token.rawMarkdown ?? "") },
  }),

  // 不理解的扩展块只允许在源码模式编辑，所见即所得模式始终原样写回。
  renderMarkdown: (node) => stripTrailingNewlines(String(node.attrs?.raw ?? "")),

  markdownTokenizer: {
    name: RAW_TOKEN_NAME,
    level: "block",
    start: neverInterruptParagraph,
    // tokens 为空表示当前位于文档最开头，frontmatter 只在这种位置成立。
    tokenize: (src: string, tokens: MarkdownToken[]) =>
      tokenizeRawMarkdown(src, tokens.length === 0),
  },
});
