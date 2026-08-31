import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type StateInline from "markdown-it/lib/rules_inline/state_inline";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import FootnoteDefinitionView from "./FootnoteDefinitionView.vue";
import FootnoteReferenceView from "./FootnoteReferenceView.vue";
import {
  escapeMarkdownAttribute,
  getMarkdownLine,
  writeMarkdownBlock,
} from "../shared/markdownRuleUtils";

const REFERENCE_TOKEN = "xmd_footnote_reference";
const DEFINITION_TOKEN = "xmd_footnote_definition";
const configuredReferenceParsers = new WeakSet<MarkdownIt>();
const configuredDefinitionParsers = new WeakSet<MarkdownIt>();

interface FootnoteDefinitionMeta {
  identifier: string;
  body: string;
}

const footnoteReferenceRule = (state: StateInline, silent: boolean): boolean => {
  if (!state.src.startsWith("[^", state.pos)) return false;
  const end = state.src.indexOf("]", state.pos + 2);
  if (end < 0) return false;

  const identifier = state.src.slice(state.pos + 2, end).trim();
  if (!identifier || identifier.includes("[")) return false;

  if (!silent) {
    const token = state.push(REFERENCE_TOKEN, "sup", 0);
    token.content = identifier;
  }
  state.pos = end + 1;
  return true;
};

const footnoteDefinitionRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const firstLine = getMarkdownLine(state, startLine);
  const match = firstLine.match(/^\[\^([^\]]+)\]:\s*(.*)$/u);
  if (!match) return false;

  const bodyLines = [match[2]];
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const rawLine = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
    const continuation = rawLine.match(/^(?: {2,4}|\t)(.*)$/u);
    if (!continuation) break;
    bodyLines.push(continuation[1]);
    nextLine += 1;
  }

  if (silent) return true;
  const token = state.push(DEFINITION_TOKEN, "div", 0);
  token.block = true;
  token.map = [startLine, nextLine];
  token.meta = {
    identifier: match[1].trim(),
    body: bodyLines.join("\n").trimEnd(),
  } satisfies FootnoteDefinitionMeta;
  state.line = nextLine;
  return true;
};

const configureReferenceParser = (markdown: MarkdownIt): void => {
  if (configuredReferenceParsers.has(markdown)) return;
  configuredReferenceParsers.add(markdown);
  markdown.inline.ruler.before("link", REFERENCE_TOKEN, footnoteReferenceRule);
  markdown.renderer.rules[REFERENCE_TOKEN] = (tokens, index) => {
    const identifier = escapeMarkdownAttribute(markdown, tokens[index].content);
    return `<sup data-xmd-footnote-reference data-identifier="${identifier}"></sup>`;
  };
};

const configureDefinitionParser = (markdown: MarkdownIt): void => {
  if (configuredDefinitionParsers.has(markdown)) return;
  configuredDefinitionParsers.add(markdown);
  markdown.block.ruler.before("xmd_raw_markdown", DEFINITION_TOKEN, footnoteDefinitionRule);
  markdown.renderer.rules[DEFINITION_TOKEN] = (tokens, index) => {
    const meta = tokens[index].meta as FootnoteDefinitionMeta;
    return [
      `<div data-xmd-footnote-definition data-identifier="${escapeMarkdownAttribute(markdown, meta.identifier)}">`,
      `<pre data-xmd-footnote-body>${markdown.utils.escapeHtml(meta.body)}</pre>`,
      "</div>",
    ].join("");
  };
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(`[^${String(node.attrs.identifier)}]`);
        },
        parse: { setup: configureReferenceParser },
      },
    };
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const identifier = String(node.attrs.identifier).trim();
          const lines = String(node.attrs.body).split("\n");
          const firstLine = `[^${identifier}]: ${lines[0] ?? ""}`;
          const continuation = lines.slice(1).map((line) => `    ${line}`).join("\n");
          writeMarkdownBlock(state, node, continuation ? `${firstLine}\n${continuation}` : firstLine);
        },
        parse: { setup: configureDefinitionParser },
      },
    };
  },
});
