import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type StateInline from "markdown-it/lib/rules_inline/state_inline";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import MathView from "./MathView.vue";
import {
  escapeMarkdownAttribute,
  getMarkdownLine,
  writeMarkdownBlock,
} from "../shared/markdownRuleUtils";

const BLOCK_TOKEN = "xmd_math_block";
const INLINE_TOKEN = "xmd_math_inline";
const configuredBlockParsers = new WeakSet<MarkdownIt>();
const configuredInlineParsers = new WeakSet<MarkdownIt>();

const mathBlockRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const openingLine = getMarkdownLine(state, startLine).trim();
  if (!openingLine.startsWith("$$")) return false;

  let expression = "";
  let nextLine = startLine + 1;
  const singleLine = openingLine.match(/^\$\$\s*(.+?)\s*\$\$$/u);

  if (singleLine) {
    expression = singleLine[1];
  } else {
    if (openingLine !== "$$") return false;

    const expressionLines: string[] = [];
    let closingLine = -1;
    for (let line = startLine + 1; line < endLine; line += 1) {
      const currentLine = getMarkdownLine(state, line);
      if (currentLine.trim() === "$$") {
        closingLine = line;
        break;
      }
      expressionLines.push(currentLine);
    }
    if (closingLine < 0) return false;
    expression = expressionLines.join("\n").trim();
    nextLine = closingLine + 1;
  }

  if (!expression) return false;
  if (silent) return true;

  const token = state.push(BLOCK_TOKEN, "math", 0);
  token.block = true;
  token.map = [startLine, nextLine];
  token.content = expression;
  state.line = nextLine;
  return true;
};

const mathInlineRule = (state: StateInline, silent: boolean): boolean => {
  const start = state.pos;
  if (state.src[start] !== "$" || state.src[start + 1] === "$" || /\s/u.test(state.src[start + 1] ?? "")) {
    return false;
  }

  let closingPosition = -1;
  for (let position = start + 1; position < state.posMax; position += 1) {
    if (state.src[position] !== "$" || state.src[position - 1] === "\\") continue;
    if (/\s/u.test(state.src[position - 1] ?? "")) continue;
    closingPosition = position;
    break;
  }

  if (closingPosition < 0) return false;
  const expression = state.src.slice(start + 1, closingPosition);
  if (!expression) return false;

  if (!silent) {
    const token = state.push(INLINE_TOKEN, "math", 0);
    token.content = expression;
  }
  state.pos = closingPosition + 1;
  return true;
};

const configureMathBlockParser = (markdown: MarkdownIt): void => {
  if (configuredBlockParsers.has(markdown)) return;
  configuredBlockParsers.add(markdown);

  markdown.block.ruler.before("xmd_raw_markdown", BLOCK_TOKEN, mathBlockRule);
  markdown.renderer.rules[BLOCK_TOKEN] = (tokens, index) =>
    `<div data-xmd-math-block data-expression="${escapeMarkdownAttribute(markdown, tokens[index].content)}"></div>`;
};

const configureMathInlineParser = (markdown: MarkdownIt): void => {
  if (configuredInlineParsers.has(markdown)) return;
  configuredInlineParsers.add(markdown);

  markdown.inline.ruler.before("escape", INLINE_TOKEN, mathInlineRule);
  markdown.renderer.rules[INLINE_TOKEN] = (tokens, index) =>
    `<span data-xmd-math-inline data-expression="${escapeMarkdownAttribute(markdown, tokens[index].content)}"></span>`;
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          writeMarkdownBlock(state, node, `$$\n${String(node.attrs.expression).trim()}\n$$`);
        },
        parse: { setup: configureMathBlockParser },
      },
    };
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(`$${String(node.attrs.expression)}$`);
        },
        parse: { setup: configureMathInlineParser },
      },
    };
  },
});
