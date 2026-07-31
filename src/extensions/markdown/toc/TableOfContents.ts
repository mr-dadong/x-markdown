import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import TableOfContentsView from "./TableOfContentsView.vue";
import { getMarkdownLine, writeMarkdownBlock } from "../shared/markdownRuleUtils";

const TOKEN_NAME = "xmd_table_of_contents";
const configuredParsers = new WeakSet<MarkdownIt>();

const tableOfContentsRule = (
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean => {
  if (!/^\[toc\]$/iu.test(getMarkdownLine(state, startLine).trim())) return false;
  if (silent) return true;

  const token = state.push(TOKEN_NAME, "nav", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          writeMarkdownBlock(state, node, "[TOC]");
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredParsers.has(markdown)) return;
            configuredParsers.add(markdown);
            markdown.block.ruler.before("paragraph", TOKEN_NAME, tableOfContentsRule);
            markdown.renderer.rules[TOKEN_NAME] = () => "<nav data-xmd-table-of-contents></nav>";
          },
        },
      },
    };
  },
});
