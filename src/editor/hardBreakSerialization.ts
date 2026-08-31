import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type ParserInline from "markdown-it/lib/parser_inline";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import HardBreak from "@tiptap/extension-hard-break";

/** 行尾两空格硬换行的标记（仅存在于解析内存的 HTML，不进入编辑器 DOM）。 */
const SPACE_BREAK_ATTRIBUTE = "data-xmd-space-break";
/** 普通软换行的标记（breaks 模式下渲染为 <br>，保存时还原为普通换行）。 */
const SOFT_BREAK_ATTRIBUTE = "data-xmd-soft-break";

type BreakSerializerState = MarkdownSerializerState & {
  inTable: boolean;
};

interface InlineRuleEntry {
  name: string;
  fn: ParserInline.RuleInline;
}

const configuredHardBreakParsers = new WeakSet<MarkdownIt>();

/**
 * 区分硬换行的源码写法：CommonMark 中行尾两空格与反斜杠都是 hardbreak，
 * markdown-it 渲染成同样的 <br> 后保存时无从分辨，默认统一存成反斜杠。
 * 这里在解析时给两空格写法（以及 breaks 模式下的软换行）打上标记，
 * 供序列化器按原文写法还原，避免保存时改写用户文件。
 */
export const configureHardBreakLiteralParsing = (markdown: MarkdownIt): void => {
  if (configuredHardBreakParsers.has(markdown)) return;
  configuredHardBreakParsers.add(markdown);

  const originalHardBreak = markdown.renderer.rules.hardbreak;
  markdown.renderer.rules.hardbreak = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token && token.attrGet(SPACE_BREAK_ATTRIBUTE) !== null) {
      return `<br ${SPACE_BREAK_ATTRIBUTE}>`;
    }
    return originalHardBreak
      ? originalHardBreak(tokens, idx, options, env, self)
      : "<br>";
  };

  const originalSoftBreak = markdown.renderer.rules.softbreak;
  markdown.renderer.rules.softbreak = (tokens, idx, options, env, self) => {
    // breaks 模式下软换行本就渲染为 <br>，补上标记让保存时还原为普通换行。
    if (options.breaks) {
      return `<br ${SOFT_BREAK_ATTRIBUTE}>`;
    }
    return originalSoftBreak
      ? originalSoftBreak(tokens, idx, options, env, self)
      : "\n";
  };

  // newline 规则负责“行尾两空格 -> hardbreak”，包装它以读取 pending 尾部空格。
  // __rules__ 是 markdown-it Ruler 的私有结构，读取失败时保守降级为不区分写法。
  const inlineRules = (
    markdown.inline.ruler as unknown as { __rules__?: InlineRuleEntry[] }
  ).__rules__;
  const newlineEntry = inlineRules?.find((rule) => rule.name === "newline");
  if (!newlineEntry) return;
  const originalNewline = newlineEntry.fn;

  markdown.inline.ruler.at("newline", (state, silent) => {
    const isSpaceHardBreak = !silent && state.pending.endsWith("  ");
    const handled = originalNewline(state, silent);
    if (handled && isSpaceHardBreak) {
      const token = state.tokens[state.tokens.length - 1];
      if (token && token.type === "hardbreak") {
        token.attrSet(SPACE_BREAK_ATTRIBUTE, "");
      }
    }
    return handled;
  });
};

/**
 * 保留硬换行源码写法的 HardBreak 扩展：
 * 解析时记录“两空格 / 反斜杠 / 软换行”写法，序列化时按原文还原。
 * 用户手动插入（Shift-Enter）的换行按 CommonMark 反斜杠写法保存。
 */
export const LiteralHardBreak = HardBreak.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      literal: {
        default: null,
        // 标记属性只用于解析传输，不渲染到编辑器和导出的 DOM。
        parseHTML: (element) =>
          element.hasAttribute(SPACE_BREAK_ATTRIBUTE)
            ? "space"
            : element.hasAttribute(SOFT_BREAK_ATTRIBUTE)
              ? "soft"
              : null,
        renderHTML: () => ({}),
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownSerializerState,
          node: ProseMirrorNode,
          parent: ProseMirrorNode | Fragment,
          index: number,
        ) {
          // 与 tiptap-markdown 默认行为一致：段落末尾的硬换行无法用
          // Markdown 表达，直接丢弃，只有后面还有内容时才输出。
          for (let i = index + 1; i < parent.childCount; i += 1) {
            if (parent.child(i).type === node.type) continue;

            const breakState = state as BreakSerializerState;
            if (breakState.inTable) {
              state.write("<br>");
            } else if (node.attrs.literal === "space") {
              state.write("  \n");
            } else if (node.attrs.literal === "soft") {
              state.write("\n");
            } else {
              state.write("\\\n");
            }
            return;
          }
        },
        parse: {
          setup(markdown: MarkdownIt) {
            configureHardBreakLiteralParsing(markdown);
          },
        },
      },
    };
  },
});
