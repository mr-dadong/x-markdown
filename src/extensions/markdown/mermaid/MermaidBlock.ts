import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import MermaidBlockView from "./MermaidBlockView.vue";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw, withSingleTrailingNewline } from "../shared/officialMarkdown";

/** 解析注册表用的 token 名，与节点名分开以免和 marked 内置 token 冲突。 */
const TOKEN_NAME = "xmdMermaidBlock";

/** 开启围栏：``` 或 ~~~ 后紧跟 mermaid 语言标记。 */
const OPENING_FENCE_PATTERN = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/iu;

/** 判断一行是否为关闭围栏（同种字符、长度不短于开启围栏）。 */
const isClosingFence = (line: string, marker: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  if (!/^[`~]+$/u.test(trimmed)) return false;
  return trimmed[0] === marker[0];
};

/**
 * 解析 ```mermaid 围栏。
 * 只接管 mermaid 语言的围栏，其它围栏返回 undefined 交给官方代码块处理；
 * 未闭合的围栏同样交还，避免把不完整的源码吞成图表节点。
 */
const tokenizeMermaid = (src: string): MarkdownToken | undefined => {
  const lines = src.split("\n");
  const opening = lines[0]?.match(OPENING_FENCE_PATTERN);
  if (!opening) return undefined;

  const marker = opening[1];
  const bodyLines: string[] = [];
  let consumed = 1;
  let closed = false;

  while (consumed < lines.length) {
    if (isClosingFence(lines[consumed], marker)) {
      consumed += 1;
      closed = true;
      break;
    }
    bodyLines.push(lines[consumed]);
    consumed += 1;
  }

  if (!closed) return undefined;

  return {
    type: TOKEN_NAME,
    raw: takeBlockRaw(lines, consumed),
    // 与 markdown-it 的 fence token.content 一致：内容保留结尾换行。
    source: bodyLines.length > 0 ? `${bodyLines.join("\n")}\n` : "",
  } as MarkdownToken;
};

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: { default: "graph TD\n  A[开始] --> B[结束]" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre[data-xmd-mermaid]",
        getAttrs: (element) => ({
          source: element instanceof HTMLElement ? element.textContent ?? "" : "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { source, ...attributes } = HTMLAttributes;
    return [
      "pre",
      mergeAttributes(attributes, {
        "data-xmd-mermaid": "",
        class: "my-4 overflow-x-auto rounded-md border border-line bg-toolbar p-3 font-mono text-[13px] text-secondary",
      }),
      String(source ?? ""),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(MermaidBlockView);
  },

  markdownTokenName: TOKEN_NAME,

  parseMarkdown: (token) => ({
    type: "mermaidBlock",
    attrs: { source: String(token.source ?? "") },
  }),

  renderMarkdown: (node) =>
    stripTrailingNewlines(
      `\`\`\`mermaid\n${withSingleTrailingNewline(String(node.attrs?.source ?? ""))}\`\`\``,
    ),

  markdownTokenizer: {
    name: TOKEN_NAME,
    level: "block",
    start: neverInterruptParagraph,
    tokenize: (src: string) => tokenizeMermaid(src),
  },
});
