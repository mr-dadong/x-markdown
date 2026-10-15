import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

/**
 * 叶子节点在纯文本里的表示：只有 hardBreak 需要还原成换行。
 *
 * hardBreak 是叶子节点，`textBetween` 不传 leafText 时会直接跳过它，
 * 导致 "第一行␣␣↵第二行" 被粘成 "第一行第二行"。其余叶子节点（图片、附件等）
 * 本来就没有可复制的文字，返回空串即可。
 */
const leafText = (leaf: ProseMirrorNode): string =>
  leaf.type.name === "hardBreak" ? "\n" : "";

/**
 * 复制时写入剪贴板 text/plain 的纯文本序列化。
 *
 * 背景：Tiptap 核心扩展 ClipboardTextSerializer 默认用 "\n\n" 作为块分隔符，
 * 而且它在遍历过程中对「每一个块级节点」都拼接一次分隔符。列表的结构是
 * orderedList > listItem > paragraph，三层都是块节点，于是相邻两个列表项之间
 * 会被拼上两个 "\n\n"（listItem 一次 + paragraph 一次）= 3 个空行。
 * 复制三个列表项就会带出大量空行，粘到记事本等纯文本软件里非常明显。
 *
 * 这里改成显式实现：每个块级节点之间只用一个 "\n"，一块一行，
 * 与块菜单复制、局部选区复制共用同一套「块之间一个换行」的语义。
 */
export const clipboardTextSerializer = (slice: Slice): string =>
  slice.content.textBetween(0, slice.content.size, "\n", leafText);

/**
 * 取「单个整块」的纯文本，供块菜单复制、块拖拽等按块操作的入口使用。
 *
 * 不能用 node.textContent：它不插入任何块分隔符，列表会粘成 "甲乙丙"、
 * 表格会粘成 "AB12"，多行内容全部挤成一行。也不插入多余的空行，
 * 与整篇复制的语义保持一致。
 */
export const blockPlainText = (node: ProseMirrorNode): string =>
  node.textBetween(0, node.content.size, "\n", leafText);

/**
 * 取文档中某个范围的纯文本，供按选区复制（局部文字复制/剪切）使用。
 *
 * 必须带上 leafText：只传块分隔符时 hardBreak 会被整块跳过，
 * 段落内用 Shift+Enter 或行尾两空格写的换行会在复制后粘连成一行。
 */
export const rangePlainText = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string => doc.textBetween(from, to, "\n", leafText);

