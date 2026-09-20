import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import FootnoteDefinitionView from "./FootnoteDefinitionView.vue";
import FootnoteReferenceView from "./FootnoteReferenceView.vue";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw } from "../shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const REFERENCE_TOKEN = "xmdFootnoteReference";
const DEFINITION_TOKEN = "xmdFootnoteDefinition";

/** 脚注定义首行：[^标识]: 正文 */
const DEFINITION_PATTERN = /^\[\^([^\]]+)\]:\s*(.*)$/u;
/** 脚注定义正文的续行缩进（2~4 个空格或一个制表符）。 */
const DEFINITION_CONTINUATION_PATTERN = /^(?: {2,4}|\t)(.*)$/u;

/** 解析行内脚注引用 [^标识]，不匹配时交给其它 tokenizer。 */
const tokenizeFootnoteReference = (src: string): MarkdownToken | undefined => {
  if (!src.startsWith("[^")) return undefined;
  const end = src.indexOf("]", 2);
  if (end < 0) return undefined;

  const identifier = src.slice(2, end).trim();
  if (!identifier || identifier.includes("[")) return undefined;

  return {
    type: REFERENCE_TOKEN,
    raw: src.slice(0, end + 1),
    identifier,
  } as MarkdownToken;
};

/** 解析块级脚注定义，含缩进续行。 */
const tokenizeFootnoteDefinition = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const match = lines[0]?.match(DEFINITION_PATTERN);
  if (!match) return undefined;

  const bodyLines = [match[2]];
  let consumed = 1;
  while (consumed < lines.length) {
    const continuation = lines[consumed].match(DEFINITION_CONTINUATION_PATTERN);
    if (!continuation) break;
    bodyLines.push(continuation[1]);
    consumed += 1;
  }

  return {
    type: DEFINITION_TOKEN,
    raw: takeBlockRaw(lines, consumed),
    identifier: match[1].trim(),
    body: bodyLines.join("\n").trimEnd(),
  } as MarkdownToken;
};

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { identifier: { default: "1" } };
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-xmd-footnote-reference]",
        getAttrs: (element) => ({
          identifier: element instanceof HTMLElement ? element.dataset.identifier ?? "1" : "1",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const identifier = String(HTMLAttributes.identifier);
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-xmd-footnote-reference": "",
        "data-identifier": identifier,
        class: "mx-0.5 inline cursor-pointer font-mono text-[10px] font-semibold text-link",
        title: `脚注 ${identifier}`,
      }),
      `[${identifier}]`,
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(FootnoteReferenceView);
  },

  markdownTokenName: REFERENCE_TOKEN,

  parseMarkdown: (token) => ({
    type: "footnoteReference",
    attrs: { identifier: String(token.identifier ?? "1") },
  }),

  renderMarkdown: (node) => `[^${String(node.attrs?.identifier ?? "1")}]`,

  markdownTokenizer: {
    name: REFERENCE_TOKEN,
    level: "inline",
    // 行内 tokenizer 的 start 返回语法可能出现的下标，供 marked 决定文本切分位置。
    start: (src: string) => src.indexOf("[^"),
    tokenize: (src: string) => tokenizeFootnoteReference(src),
  },
});

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      identifier: { default: "1" },
      body: { default: "脚注内容" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-xmd-footnote-definition]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            identifier: element.dataset.identifier ?? "1",
            body: element.querySelector("pre[data-xmd-footnote-body]")?.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { body, ...attributes } = HTMLAttributes;
    return [
      "div",
      mergeAttributes(attributes, {
        "data-xmd-footnote-definition": "",
        "data-identifier": HTMLAttributes.identifier,
        class: "my-3 flex gap-3 rounded-md border border-line bg-toolbar p-3",
      }),
      ["span", { class: "font-mono text-[11px] font-semibold text-link" }, `[${String(HTMLAttributes.identifier)}]`],
      ["pre", { "data-xmd-footnote-body": "", class: "whitespace-pre-wrap font-sans text-[12px] text-secondary" }, String(body ?? "")],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(FootnoteDefinitionView);
  },

  markdownTokenName: DEFINITION_TOKEN,

  parseMarkdown: (token) => ({
    type: "footnoteDefinition",
    attrs: {
      identifier: String(token.identifier ?? "1"),
      body: String(token.body ?? ""),
    },
  }),

  renderMarkdown: (node) => {
    const identifier = String(node.attrs?.identifier ?? "1").trim();
    const lines = String(node.attrs?.body ?? "").split("\n");
    const firstLine = `[^${identifier}]: ${lines[0] ?? ""}`;
    // 续行必须保持缩进，否则重新解析时会被当成新的块。
    const continuation = lines.slice(1).map((line) => `    ${line}`).join("\n");
    return stripTrailingNewlines(continuation ? `${firstLine}\n${continuation}` : firstLine);
  },

  markdownTokenizer: {
    name: DEFINITION_TOKEN,
    level: "block",
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeFootnoteDefinition(src),
  },
});
