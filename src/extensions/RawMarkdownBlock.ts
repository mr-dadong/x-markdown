import { Node, mergeAttributes } from "@tiptap/core";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

const RAW_TOKEN_NAME = "xmd_raw_markdown";
const configuredMarkdownParsers = new WeakSet<MarkdownIt>();

const getLine = (state: StateBlock, line: number): string =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);

const findClosingLine = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  marker: string,
): number => {
  for (let line = startLine + 1; line < endLine; line += 1) {
    if (getLine(state, line).trim() === marker) return line;
  }
  return -1;
};

const findParagraphEnd = (
  state: StateBlock,
  startLine: number,
  endLine: number,
): number => {
  let line = startLine + 1;
  while (line < endLine && getLine(state, line).trim() !== "") line += 1;
  return line;
};

const rawMarkdownRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const lineText = getLine(state, startLine);
  const trimmedLine = lineText.trim();
  let nextLine = -1;

  if (startLine === 0 && trimmedLine === "---") {
    const closingLine = findClosingLine(state, startLine, endLine, "---");
    if (closingLine > startLine) nextLine = closingLine + 1;
  } else if (
    /^:::[\w-]+/.test(trimmedLine)
    || /\[\[[^\]]+\]\]/.test(lineText)
  ) {
    nextLine = findParagraphEnd(state, startLine, endLine);
  }

  if (nextLine < 0) return false;
  if (silent) return true;

  const token = state.push(RAW_TOKEN_NAME, "pre", 0);
  token.block = true;
  token.map = [startLine, nextLine];
  token.content = state.getLines(startLine, nextLine, state.blkIndent, false);
  state.line = nextLine;
  return true;
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

  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownSerializerState,
          node: ProseMirrorNode,
        ) {
          // 不理解的扩展块只允许在源码模式编辑，所见即所得模式始终原样写回。
          state.write(String(node.attrs.raw));
          state.closeBlock(node);
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredMarkdownParsers.has(markdown)) return;
            configuredMarkdownParsers.add(markdown);
            markdown.block.ruler.before("fence", RAW_TOKEN_NAME, rawMarkdownRule);
            markdown.renderer.rules[RAW_TOKEN_NAME] = (tokens: Token[], index: number) =>
              `<pre data-xmd-raw-markdown>${markdown.utils.escapeHtml(tokens[index].content)}</pre>`;
          },
        },
      },
    };
  },
});
