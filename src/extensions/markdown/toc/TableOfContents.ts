import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import TableOfContentsView from "./TableOfContentsView.vue";
import { neverInterruptParagraph, takeBlockRaw } from "../shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const TOKEN_NAME = "xmdTableOfContents";

/** 目录占位语法：独占一行的 [TOC]，大小写不敏感。 */
const TOC_PATTERN = /^\[toc\]$/iu;

/** 解析独占一行的 [TOC] 占位块。 */
const tokenizeTableOfContents = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  if (!TOC_PATTERN.test((lines[0] ?? "").trim())) return undefined;
  return {
    type: TOKEN_NAME,
    raw: takeBlockRaw(lines, 1),
  } as MarkdownToken;
};

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "nav[data-xmd-table-of-contents]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "nav",
      mergeAttributes(HTMLAttributes, {
        "data-xmd-table-of-contents": "",
        class: "my-4 flex flex-col rounded-lg border border-line bg-toolbar p-4",
      }),
      "文档目录",
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(TableOfContentsView);
  },

  markdownTokenName: TOKEN_NAME,

  parseMarkdown: () => ({ type: "tableOfContents" }),

  renderMarkdown: () => "[TOC]",

  markdownTokenizer: {
    name: TOKEN_NAME,
    level: "block",
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeTableOfContents(src),
  },
});
