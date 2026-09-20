import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import MathView from "./MathView.vue";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw } from "../shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const BLOCK_TOKEN = "xmdMathBlock";
const INLINE_TOKEN = "xmdMathInline";

/** 单行块级公式：$$表达式$$ */
const SINGLE_LINE_BLOCK_PATTERN = /^\$\$\s*(.+?)\s*\$\$$/u;

/**
 * 解析块级公式，支持两种写法：
 * - 单行 `$$E = mc^2$$`
 * - 多行 `$$` 起始、`$$` 结束，中间为表达式
 */
const tokenizeMathBlock = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const openingLine = (lines[0] ?? "").trim();
  if (!openingLine.startsWith("$$")) return undefined;

  const singleLine = openingLine.match(SINGLE_LINE_BLOCK_PATTERN);
  let expression: string;
  let consumed: number;

  if (singleLine) {
    expression = singleLine[1];
    consumed = 1;
  } else {
    // 多行写法要求起始行只有 $$，否则视为不认识的语法。
    if (openingLine !== "$$") return undefined;

    const expressionLines: string[] = [];
    let closingIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "$$") {
        closingIndex = index;
        break;
      }
      expressionLines.push(lines[index]);
    }
    if (closingIndex < 0) return undefined;
    expression = expressionLines.join("\n").trim();
    consumed = closingIndex + 1;
  }

  if (!expression) return undefined;
  return {
    type: BLOCK_TOKEN,
    raw: takeBlockRaw(lines, consumed),
    expression,
  } as MarkdownToken;
};

/**
 * 解析行内公式 $表达式$。
 * 起始 `$` 后不能紧跟 `$` 或空白，结束 `$` 前不能是反斜杠或空白，
 * 与旧 markdown-it 规则保持一致，避免把价格写法误判成公式。
 */
const tokenizeMathInline = (src: string): MarkdownToken | undefined => {
  if (src[0] !== "$" || src[1] === "$" || /\s/u.test(src[1] ?? "")) return undefined;

  let closingPosition = -1;
  for (let position = 1; position < src.length; position += 1) {
    if (src[position] !== "$" || src[position - 1] === "\\") continue;
    if (/\s/u.test(src[position - 1] ?? "")) continue;
    closingPosition = position;
    break;
  }

  if (closingPosition < 0) return undefined;
  const expression = src.slice(1, closingPosition);
  if (!expression) return undefined;

  return {
    type: INLINE_TOKEN,
    raw: src.slice(0, closingPosition + 1),
    expression,
  } as MarkdownToken;
};

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return { expression: { default: "E = mc^2" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-xmd-math-block]",
        getAttrs: (element) => ({
          expression: element instanceof HTMLElement ? element.dataset.expression ?? "" : "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-xmd-math-block": "",
        "data-expression": HTMLAttributes.expression,
        class: "my-4 flex min-h-16 items-center justify-center rounded-md border border-line bg-paper px-4 py-3",
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(MathView);
  },

  markdownTokenName: BLOCK_TOKEN,

  parseMarkdown: (token) => ({
    type: "mathBlock",
    attrs: { expression: String(token.expression ?? "") },
  }),

  // 统一按多行写法落盘，表达式内部的 \* \_ 属于 LaTeX 语法，不做转义。
  renderMarkdown: (node) =>
    stripTrailingNewlines(`$$\n${String(node.attrs?.expression ?? "").trim()}\n$$`),

  markdownTokenizer: {
    name: BLOCK_TOKEN,
    level: "block",
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeMathBlock(src),
  },
});

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { expression: { default: "x" } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-xmd-math-inline]",
        getAttrs: (element) => ({
          expression: element instanceof HTMLElement ? element.dataset.expression ?? "" : "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-xmd-math-inline": "",
        "data-expression": HTMLAttributes.expression,
        class: "inline-flex rounded px-1",
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(MathView);
  },

  markdownTokenName: INLINE_TOKEN,

  parseMarkdown: (token) => ({
    type: "mathInline",
    attrs: { expression: String(token.expression ?? "") },
  }),

  renderMarkdown: (node) => `$${String(node.attrs?.expression ?? "")}$`,

  markdownTokenizer: {
    name: INLINE_TOKEN,
    level: "inline",
    start: (src: string) => src.indexOf("$"),
    tokenize: (src: string) => tokenizeMathInline(src),
  },
});
