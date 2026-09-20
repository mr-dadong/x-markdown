import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import CalloutView from "./CalloutView.vue";
import { calloutToMarkdown } from "./calloutSource";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw } from "../shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const TOKEN_NAME = "xmdCallout";

/** callout 起始行：> [!类型]± 标题。 */
const OPENING_PATTERN = /^\s*>\s*\[!([A-Za-z][\w-]*)\]([+-])?\s*(.*)$/u;
/** callout 正文行：> 内容。 */
const QUOTED_LINE_PATTERN = /^\s*> ?(.*)$/u;

/**
 * 从当前位置解析 callout 引用块。
 * 语法不匹配时返回 undefined，交给 marked 的其它 tokenizer 处理。
 */
const tokenizeCallout = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const match = lines[0]?.match(OPENING_PATTERN);
  if (!match) return undefined;

  // 起始行之后连续的「> 内容」行都属于正文，遇到第一个非引用行即结束。
  const bodyLines: string[] = [];
  let consumed = 1;
  while (consumed < lines.length) {
    const quoted = lines[consumed].match(QUOTED_LINE_PATTERN);
    if (!quoted) break;
    bodyLines.push(quoted[1]);
    consumed += 1;
  }

  return {
    type: TOKEN_NAME,
    raw: takeBlockRaw(lines, consumed),
    calloutType: match[1].toLocaleUpperCase(),
    fold: match[2] ?? "",
    title: match[3].trim(),
    body: bodyLines.join("\n").trimEnd(),
  } as MarkdownToken;
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

  // 解析注册表按 markdownTokenName 建键，必须与 tokenizer 产出的 type 一致。
  markdownTokenName: TOKEN_NAME,

  parseMarkdown: (token) => ({
    type: "callout",
    attrs: {
      calloutType: String(token.calloutType ?? "NOTE"),
      title: String(token.title ?? ""),
      fold: String(token.fold ?? ""),
      body: String(token.body ?? ""),
    },
  }),

  // 落盘格式统一由 calloutSource 生成，保证与编辑器里的载荷源码一致。
  renderMarkdown: (node) =>
    stripTrailingNewlines(
      calloutToMarkdown({
        calloutType: String(node.attrs?.calloutType ?? "NOTE"),
        fold: String(node.attrs?.fold ?? ""),
        title: String(node.attrs?.title ?? ""),
        body: String(node.attrs?.body ?? ""),
      }),
    ),

  markdownTokenizer: {
    name: TOKEN_NAME,
    level: "block",
    // marked 用 start 判断段落是否需要在当前位置提前结束，返回 0 表示「可能在此匹配」。
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeCallout(src),
  },
});
