import type { MarkdownToken } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";

/** 行尾两空格硬换行的标记（仅存在于解析内存，不进入编辑器 DOM）。 */
const SPACE_BREAK_ATTRIBUTE = "data-xmd-space-break";
/** 普通软换行的标记（breaks 模式下渲染为 <br>，保存时还原为普通换行）。 */
const SOFT_BREAK_ATTRIBUTE = "data-xmd-soft-break";

/** 行尾两个及以上空格 + 换行：CommonMark 的两空格硬换行写法。 */
const SPACE_BREAK_PATTERN = /^ {2,}\n$/u;
/** 反斜杠 + 换行：CommonMark 的反斜杠硬换行写法。 */
const BACKSLASH_BREAK_PATTERN = /^\\\n$/u;

/**
 * 从 marked 的 br token 反推源码写法。
 *
 * marked 把「行尾两空格」「反斜杠」「breaks 模式下的软换行」都产出同一个 br token，
 * 只有 token.raw 保留着原始写法，因此按 raw 区分：
 * - `  \n`  → space（两空格硬换行）
 * - `\\\n`  → null（反斜杠硬换行，与用户手动插入的换行同形）
 * - `\n`    → soft（breaks 模式下的普通换行）
 *
 * 刻意**不注册**自定义 br 行内 tokenizer：marked 会先试行内扩展再试内置 link，
 * 自定义 tokenizer 的 start 会参与行内文本切分，导致 `![图片](地址)` 在段落开头
 * 被拆成 `!` + 换行 + 链接。只消费既有 token 就不会干扰分词。
 */
const resolveBreakLiteral = (token: MarkdownToken): string | null => {
  const raw = String(token.raw ?? "");
  if (BACKSLASH_BREAK_PATTERN.test(raw)) return null;
  if (SPACE_BREAK_PATTERN.test(raw)) return "space";
  return "soft";
};

/**
 * 保留硬换行源码写法的 HardBreak 扩展：
 * 解析时记录「两空格 / 反斜杠 / 软换行」写法，序列化时按原文还原。
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

  markdownTokenName: "br",

  parseMarkdown: (token) => ({
    type: "hardBreak",
    attrs: { literal: resolveBreakLiteral(token) },
  }),

  renderMarkdown: (node, helpers, ctx) => {
    const literal = node.attrs?.literal;
    /*
     * 列表项内的换行必须补上缩进，否则续行会被重新解析成新的块
     * （`- 第一行\n  第二行` 会退化成 `- 第一行\n第二行`）。
     *
     * 官方 renderNestedMarkdownContent 只缩进「后续子节点」，首个子节点内部的
     * 换行不缩进，因此这里自己补一级 indentString；更外层列表会对整段内容
     * 再统一缩进，所以补一级就够，不会重复。
     */
    const indent = (ctx?.level ?? 0) > 0 ? helpers.indent("") : "";
    const marker = literal === "space" ? "  " : literal === "soft" ? "" : "\\";
    return `${marker}\n${indent}`;
  },
});
