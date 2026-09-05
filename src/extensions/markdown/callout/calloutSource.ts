/**
 * Callout 模块的落盘 Markdown 构建。
 *
 * 弹层编辑器只编辑正文；类型、折叠是块的内置属性，标题不再单独编辑，
 * 为空时卡片直接显示类型名。序列化统一从这里生成「> [!类型]」引用块，
 * 保证编辑器、导出与文档保真测试用的是同一套格式。
 */

export interface CalloutPayload {
  calloutType: string;
  fold: string;
  title: string;
  body: string;
}

/** 把节点属性整理成落盘的完整 Markdown（> 引用块）。 */
export const calloutToMarkdown = (payload: CalloutPayload): string => {
  const calloutType = String(payload.calloutType).toLocaleUpperCase();
  const title = String(payload.title).trim();
  const fold = ["+", "-"].includes(String(payload.fold)) ? String(payload.fold) : "";
  const header = `> [!${calloutType}]${fold}${title ? ` ${title}` : ""}`;
  // 正文为空时只输出首行；多行正文里的空行用单独的「>」占位，避免引用块提前结束。
  const body = String(payload.body).trimEnd();
  const quotedBody = body
    ? body
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")
    : "";
  return quotedBody ? `${header}\n${quotedBody}` : header;
};
