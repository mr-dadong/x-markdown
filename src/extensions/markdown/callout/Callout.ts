import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import CalloutView from "./CalloutView.vue";
import {
  escapeMarkdownAttribute,
  getMarkdownLine,
  writeMarkdownBlock,
} from "../shared/markdownRuleUtils";
import { calloutToMarkdown } from "./calloutSource";

const TOKEN_NAME = "xmd_callout";
const configuredParsers = new WeakSet<MarkdownIt>();

interface CalloutTokenMeta {
  calloutType: string;
  title: string;
  fold: string;
  body: string;
}

const calloutRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const openingLine = getMarkdownLine(state, startLine);
  const match = openingLine.match(/^\s*>\s*\[!([A-Za-z][\w-]*)\]([+-])?\s*(.*)$/u);
  if (!match) return false;

  const bodyLines: string[] = [];
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const line = getMarkdownLine(state, nextLine);
    const quotedLine = line.match(/^\s*> ?(.*)$/u);
    if (!quotedLine) break;
    bodyLines.push(quotedLine[1]);
    nextLine += 1;
  }

  if (silent) return true;
  const token = state.push(TOKEN_NAME, "aside", 0);
  token.block = true;
  token.map = [startLine, nextLine];
  token.meta = {
    calloutType: match[1].toLocaleUpperCase(),
    fold: match[2] ?? "",
    title: match[3].trim(),
    body: bodyLines.join("\n").trimEnd(),
  } satisfies CalloutTokenMeta;
  state.line = nextLine;
  return true;
};

export const Callout = Node.create({
  name: "callout",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      calloutType: { default: "NOTE" },
      // 标题为空时卡片直接显示类型名，因此默认不再内置「提示」标题。
      title: { default: "" },
      fold: { default: "" },
      body: { default: "在这里输入提示内容。" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "aside[data-xmd-callout]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            calloutType: element.dataset.calloutType ?? "NOTE",
            title: element.dataset.title ?? "",
            fold: element.dataset.fold ?? "",
            body: element.querySelector("pre[data-xmd-callout-body]")?.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { body, ...attributes } = HTMLAttributes;
    return [
      "aside",
      mergeAttributes(attributes, {
        "data-xmd-callout": "",
        "data-callout-type": HTMLAttributes.calloutType,
        "data-title": HTMLAttributes.title,
        "data-fold": HTMLAttributes.fold,
        class: "my-4 flex flex-col rounded-lg border border-line bg-paper p-4",
      }),
      ["pre", { "data-xmd-callout-body": "", class: "whitespace-pre-wrap font-sans" }, String(body ?? "")],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(CalloutView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          // 落盘格式统一由 calloutSource 生成，保证与编辑器里的载荷源码一致。
          writeMarkdownBlock(
            state,
            node,
            calloutToMarkdown({
              calloutType: String(node.attrs.calloutType),
              fold: String(node.attrs.fold),
              title: String(node.attrs.title),
              body: String(node.attrs.body),
            }),
          );
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredParsers.has(markdown)) return;
            configuredParsers.add(markdown);
            markdown.block.ruler.before("xmd_raw_markdown", TOKEN_NAME, calloutRule);
            markdown.renderer.rules[TOKEN_NAME] = (tokens, index) => {
              const meta = tokens[index].meta as CalloutTokenMeta;
              return [
                `<aside data-xmd-callout data-callout-type="${escapeMarkdownAttribute(markdown, meta.calloutType)}"`,
                ` data-title="${escapeMarkdownAttribute(markdown, meta.title)}"`,
                ` data-fold="${escapeMarkdownAttribute(markdown, meta.fold)}">`,
                `<pre data-xmd-callout-body>${markdown.utils.escapeHtml(meta.body)}</pre>`,
                "</aside>",
              ].join("");
            };
          },
        },
      },
    };
  },
});
