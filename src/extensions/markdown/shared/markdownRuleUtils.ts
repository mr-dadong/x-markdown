import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** 读取 Markdown 块规则中的原始行，扩展模块共用这一套边界处理。 */
export const getMarkdownLine = (state: StateBlock, line: number): string =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);

/** HTML 属性统一转义，避免扩展内容破坏解析阶段生成的临时 DOM。 */
export const escapeMarkdownAttribute = (markdown: MarkdownIt, value: string): string =>
  markdown.utils.escapeHtml(value).replaceAll('"', "&quot;");

/** 块节点序列化后统一闭合，保证相邻 Markdown 模块之间只有必要的空行。 */
export const writeMarkdownBlock = (
  state: { write: (value: string) => void; closeBlock: (node: ProseMirrorNode) => void },
  node: ProseMirrorNode,
  value: string,
): void => {
  state.write(value);
  state.closeBlock(node);
};

/** 多行内容末尾只保留一个换行，便于拼接围栏或引用结束标记。 */
export const withSingleTrailingNewline = (value: string): string =>
  `${value.replace(/\n+$/u, "")}\n`;
