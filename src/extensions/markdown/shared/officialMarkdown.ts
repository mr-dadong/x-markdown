/**
 * 官方 @tiptap/markdown 扩展侧的公共工具。
 *
 * 官方实现与旧包（markdown-it + prosemirror-markdown）的约定完全不同，
 * 这里集中记录两条容易踩坑的规则：
 *
 * 1. 自定义 tokenizer 返回的 `raw` 必须包含被消费的全部原文，**含结尾换行**。
 *    marked 用 `src.substring(token.raw.length)` 推进游标（marked.esm.js 中
 *    blockTokens 的扩展分支），raw 少一个换行就会让后续解析整体错位。
 * 2. `renderMarkdown` 只返回块自身的内容，**不带结尾换行**。顶层块之间的空行
 *    由 Document 扩展的 renderMarkdown（`renderChildren(content, "\n\n")`）负责，
 *    与旧包 `state.closeBlock(node)` 的职责相当。
 */

import type { JSONContent } from "@tiptap/core";

/** 把 src 开头被消费的若干行拼成 marked 需要的 raw，保留行间与结尾换行。 */
export const takeBlockRaw = (
  lines: readonly string[],
  consumed: number,
): string => (consumed < lines.length ? `${lines.slice(0, consumed).join("\n")}\n` : lines.slice(0, consumed).join("\n"));

/** 去掉结尾换行：块间空行统一交给 Document 的 renderMarkdown。 */
export const stripTrailingNewlines = (value: string): string => value.replace(/\n+$/u, "");

/** 多行内容末尾只保留一个换行，便于拼接围栏或引用结束标记。 */
export const withSingleTrailingNewline = (value: string): string =>
  `${value.replace(/\n+$/u, "")}\n`;

/** 取 src 的第一行，供 tokenizer 的 start 判断语法是否出现在当前位置。 */
export const firstLineOf = (src: string): string => src.split("\n", 1)[0] ?? "";

/**
 * 块级自定义 tokenizer 的 start 返回值：-1 表示「不需要打断段落」。
 *
 * marked 用 startBlock 的返回值把段落截断成 `e.substring(0, 返回值 + 1)`，
 * 再把它与后续段落用换行拼接（marked.esm.js 中 blockTokens 的 paragraph 分支）。
 * 而块级扩展的 tokenizer 在每个位置都先于内置规则被尝试，语法出现在块首时
 * 自然会命中，根本不需要靠截断来「让出位置」。
 *
 * 一旦在当前位置返回 0，marked 会把首个字符截成独立段落并插入一个换行：
 * `![图片](地址)` 会被拆成 `!` + 换行 + 链接。因此块级 tokenizer 一律返回 -1。
 */
export const neverInterruptParagraph = (): number => -1;

/** 递归取出 JSONContent 的纯文本，用于代码块等以文本为内容的节点。 */
export const jsonTextContent = (node: JSONContent): string => {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(jsonTextContent).join("");
};
