/**
 * 块级 HTML 容器的源码片段工具。
 *
 * 容器节点里保存的是用户写的原始标签行（开标签、闭标签、summary 行），
 * 渲染成编辑器 DOM 与导出 HTML 时只需要其中的语义部分（对齐方式、摘要文本）。
 * 这些转换集中在这里，节点文件与 NodeView 共用同一套规则，避免两处解析口径不一致。
 */

/** TextAlign 扩展认识的对齐取值；`middle` 这类历史写法不认领。 */
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

/** 归一化对齐取值；不属于支持范围时返回 null。 */
export const normalizeHtmlAlignment = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ALIGNMENTS.has(normalized) ? normalized : null;
};

/** 去掉 HTML 标签，得到标题栏与导出用的纯文本。 */
export const stripHtmlTags = (source: string): string => source.replace(/<[^>]*>/gu, "").trim();

/**
 * `<summary>…</summary>` 行转纯文本。
 *
 * 只取标题文字：面板标题是只读展示，行内标签（`<b>`、emoji）在编辑器和导出里
 * 统一按纯文本呈现；原始 summary 行仍逐字保存在节点属性里，写回 Markdown 不丢格式。
 */
export const summaryPlainText = (source: string): string =>
  stripHtmlTags(source.replace(/^<summary[^>]*>/iu, "").replace(/<\/summary\s*>$/iu, ""));

/** 粘贴来的容器没有开标签原文时，按对齐方式合成一个。 */
export const openTagOfAlignment = (align: string | null): string =>
  align ? `<div align="${align}">` : "<div>";
