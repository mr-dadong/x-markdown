import { computed } from "vue";

export interface AiChatContextOptions {
  /** 获取当前文档完整内容。 */
  getDocumentContent: () => string;
  /** 获取当前选区文本。 */
  getSelection: () => string;
  /** 最大上下文长度（字符数），超出时截断。 */
  maxContextLength?: number;
}

/**
 * 管理 Chat 侧栏的文档上下文注入。
 * 自动将当前文档内容和选区作为上下文提供给 AI。
 */
export const useAiChatContext = (options: AiChatContextOptions) => {
  const maxLen = options.maxContextLength ?? 8000;

  const documentContext = computed(() => {
    const content = options.getDocumentContent().trim();
    if (!content) return "";
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen) + "\n\n[文档内容已截断…]";
  });

  const selectionContext = computed(() => options.getSelection().trim());

  const hasDocument = computed(() => documentContext.value.length > 0);
  const hasSelection = computed(() => selectionContext.value.length > 0);

  /**
   * 解析用户输入中的 @引用，返回处理后的消息和上下文。
   * 支持：
   *   @文档 — 显式引用当前文档
   *   @选区 — 显式引用当前选区
   */
  const resolveReferences = (
    input: string,
  ): { message: string; documentContext: string; selection: string } => {
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

    return { message, documentContext: docCtx, selection: selCtx };
  };

  return {
    documentContext,
    selectionContext,
    hasDocument,
    hasSelection,
    resolveReferences,
  };
};
