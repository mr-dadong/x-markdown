import { computed } from "vue";

export interface AiChatContextOptions {
  /** 获取当前文档完整内容（不再截断，检索在主进程做）。 */
  getDocumentContent: () => string;
  /** 获取当前选区文本。 */
  getSelection: () => string;
  /** 获取光标在文档源码中的字符偏移；返回 null 表示拿不到光标位置。 */
  getCursorOffset: () => number | null;
}

/**
 * 管理 Chat 侧栏的文档上下文注入。
 * 只负责把"原始全文 + 选区 + 光标位置"传给主进程做切块检索，
 * 不再在渲染层截断文档。
 */
export const useAiChatContext = (options: AiChatContextOptions) => {
  const documentContext = computed(() => options.getDocumentContent());

  const selectionContext = computed(() => options.getSelection().trim());

  const hasDocument = computed(() => documentContext.value.trim().length > 0);
  const hasSelection = computed(() => selectionContext.value.length > 0);

  /**
   * 解析用户输入中的 @引用，返回处理后的消息和上下文。
   * 支持：
   *   @文档 — 显式引用当前文档
   *   @选区 — 显式引用当前选区
   */
  const resolveReferences = (
    input: string,
  ): { message: string; documentContext: string; selection: string; cursorOffset: number | null } => {
    let docCtx = "";
    let selCtx = "";

    let message = input;

    // @文档 或 @当前文档
    if (message.includes("@文档") || message.includes("@当前文档")) {
      docCtx = documentContext.value;
      message = message.replace(/@当前文档|@文档/g, "").trim();
    }

    // @选区
    if (message.includes("@选区")) {
      selCtx = selectionContext.value;
      message = message.replace(/@选区/g, "").trim();
    }

    // 如果没有显式引用，默认注入文档上下文（如果存在）
    if (!docCtx && !selCtx && hasDocument.value) {
      docCtx = documentContext.value;
    }

    // 光标偏移始终跟随当前光标位置（仅在有文档上下文时才有意义）
    const cursorOffset = docCtx ? options.getCursorOffset() : null;

    return { message, documentContext: docCtx, selection: selCtx, cursorOffset };
  };

  return {
    documentContext,
    selectionContext,
    hasDocument,
    hasSelection,
    resolveReferences,
  };
};
