import { computed, onUnmounted, ref, watch } from "vue";
import { aiService } from "../services/aiService";
import { normalizeAiMarkdown } from "../utils/aiMarkdown";
import type { AiChatMessage, AiChatRole } from "../types/ai";

export type AiChatStatus = "idle" | "streaming" | "done" | "error";

/**
 * 发送消息时可显式指定的上下文。
 * 字段为 undefined 时回退到 options 中的默认取值；
 * 显式传入空字符串则表示本次请求不携带该项内容（如仅 @选区 时不带文档）。
 */
export interface AiChatContextOverride {
  documentContext?: string;
  selection?: string;
  /** 光标在文档源码中的字符偏移；null 表示不带光标信息。 */
  cursorOffset?: number | null;
}

export interface AiChatOptions {
  /** 获取当前文档内容，用于注入上下文。 */
  getDocumentContext: () => string;
  /** 获取当前选区文本。 */
  getSelection: () => string;
  /** 获取光标在文档源码中的字符偏移；返回 null 表示拿不到光标位置。 */
  getCursorOffset: () => number | null;
  /** 将文本插入到编辑器光标位置。 */
  insertAtCursor: (text: string) => void;
  /** 用文本替换当前选区。 */
  replaceSelection: (text: string) => void;
  /** 当前文档文件路径，用于按文档隔离对话历史。 */
  filePath: () => string | null;
  /** 获取侧栏选择的模型覆盖值（仅模型名）；返回空表示使用设置页当前模型。 */
  getModelOverride?: () => string | null;
}

const MAX_MESSAGES = 100;

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageKey(filePath: string | null): string {
  return `ai-chat-${filePath ?? "__unsaved__"}`;
}

function loadMessages(filePath: string | null): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is AiChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as AiChatMessage).id === "string" &&
        typeof (m as AiChatMessage).role === "string" &&
        typeof (m as AiChatMessage).content === "string",
    );
  } catch {
    return [];
  }
}

function saveMessages(filePath: string | null, messages: AiChatMessage[]): void {
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(storageKey(filePath), JSON.stringify(trimmed));
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

export const useAiChat = (options: AiChatOptions) => {
  const messages = ref<AiChatMessage[]>([]);
  const isStreaming = ref(false);
  const streamingContent = ref("");
  const streamingReasoning = ref("");
  const status = ref<AiChatStatus>("idle");
  const error = ref("");
  const activeRequestId = ref("");

  // 当前文件路径变化时加载对应对话历史
  const currentFilePath = computed(() => options.filePath());

  const loadHistory = (): void => {
    messages.value = loadMessages(currentFilePath.value);
  };

  const persistHistory = (): void => {
    saveMessages(currentFilePath.value, messages.value);
  };

  // 文件路径变化时重新加载
  watch(currentFilePath, () => loadHistory(), { immediate: true });

  const addUserMessage = (content: string): AiChatMessage => {
    const msg: AiChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    messages.value = [...messages.value, msg];
    persistHistory();
    return msg;
  };

  const addAssistantMessage = (content: string, reasoning?: string): AiChatMessage => {
    const msg: AiChatMessage = {
      id: createMessageId(),
      role: "assistant",
      content,
      ...(reasoning ? { reasoning } : {}),
      timestamp: Date.now(),
    };
    messages.value = [...messages.value, msg];
    persistHistory();
    return msg;
  };

  const addSystemMessage = (content: string): AiChatMessage => {
    const msg: AiChatMessage = {
      id: createMessageId(),
      role: "system",
      content,
      timestamp: Date.now(),
    };
    messages.value = [...messages.value, msg];
    persistHistory();
    return msg;
  };

  const sendMessage = async (
    content: string,
    context?: AiChatContextOverride,
  ): Promise<void> => {
    if (!content.trim() || isStreaming.value) return;

    addUserMessage(content.trim());

    // 准备请求
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequestId.value = requestId;
    isStreaming.value = true;
    streamingContent.value = "";
    streamingReasoning.value = "";
    status.value = "streaming";
    error.value = "";

    // 构建消息历史（排除 system 消息，由后端注入）
    const chatMessages = messages.value
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      // 侧栏选择的模型覆盖值，仅在非空时携带，避免写入 undefined
      const modelOverride = options.getModelOverride?.();
      // 显式传入的上下文优先（含空字符串，表示刻意不带）；否则回退到默认取值
      const documentContext = context?.documentContext ?? options.getDocumentContext();
      const selection = context?.selection ?? options.getSelection();
      // 光标偏移：显式传入优先，否则取当前编辑器光标位置；null 表示不携带
      const cursorOffset = context?.cursorOffset ?? options.getCursorOffset();
      await aiService.chatInvoke({
        requestId,
        messages: chatMessages,
        documentContext,
        selection,
        ...(cursorOffset !== null && cursorOffset !== undefined ? { cursorOffset } : {}),
        ...(modelOverride ? { model: modelOverride } : {}),
      });
    } catch (invokeError) {
      if (status.value === "streaming") {
        status.value = "error";
        isStreaming.value = false;
        error.value = invokeError instanceof Error ? invokeError.message : String(invokeError);
        addSystemMessage(`错误：${error.value}`);
      }
    }
  };

  const cancel = (): void => {
    if (!activeRequestId.value) return;
    aiService.chatCancel(activeRequestId.value);
    isStreaming.value = false;
    status.value = "done";
    // 将已收到的流式内容保存为 assistant 消息
    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined);
      streamingContent.value = "";
      streamingReasoning.value = "";
    }
  };

  const retry = (): void => {
    // 找到最后一条用户消息并重新发送
    const lastUserMsg = [...messages.value].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // 移除最后一条 assistant 消息（如果有）
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg?.role === "assistant") {
      messages.value = messages.value.slice(0, -1);
      persistHistory();
    }
    void sendMessage(lastUserMsg.content);
  };

  const clearHistory = (): void => {
    messages.value = [];
    persistHistory();
    streamingContent.value = "";
    streamingReasoning.value = "";
    error.value = "";
    status.value = "idle";
  };

  const insertMessageToCursor = (messageId: string): void => {
    const msg = messages.value.find((m) => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;

    // 智能判断：如果有选区则替换选区，否则插入到光标位置
    // 插入前归一化，避免模型过度转义的 \*\* 以原始文本进入文档
    const normalized = normalizeAiMarkdown(msg.content);
    const selection = options.getSelection();
    if (selection && selection.trim()) {
      options.replaceSelection(normalized);
      addSystemMessage("已替换选区");
    } else {
      options.insertAtCursor(normalized);
      addSystemMessage("已插入到文档");
    }
  };

  const copyMessage = async (messageId: string): Promise<void> => {
    const msg = messages.value.find((m) => m.id === messageId);
    if (!msg) return;
    // 复制归一化后的 Markdown，粘贴到别处不会带 \*\* 等转义符
    await navigator.clipboard.writeText(normalizeAiMarkdown(msg.content));
  };

  // 监听流式事件
  const offDelta = aiService.onChatDelta((event) => {
    if (event.requestId !== activeRequestId.value) return;
    streamingContent.value += event.delta;
  });

  const offReasoningDelta = aiService.onChatReasoningDelta((event) => {
    if (event.requestId !== activeRequestId.value) return;
    streamingReasoning.value += event.delta;
  });

  const offDone = aiService.onChatDone((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "done";
    // 将流式内容保存为 assistant 消息；
    // 内容为空时兑底提示，避免“加载消失但无任何反馈”的静默失败
    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined);
    } else {
      addSystemMessage("AI 返回了空回复，请重试；若持续出现请检查网络与 AI 设置。");
    }
    streamingContent.value = "";
    streamingReasoning.value = "";
    activeRequestId.value = "";
  });

  const offError = aiService.onChatError((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "error";
    error.value = event.error;
    addSystemMessage(`错误：${event.error}`);
    streamingContent.value = "";
    streamingReasoning.value = "";
    activeRequestId.value = "";
  });

  onUnmounted(() => {
    if (activeRequestId.value) aiService.chatCancel(activeRequestId.value);
    offDelta();
    offReasoningDelta();
    offDone();
    offError();
  });

  return {
    messages,
    isStreaming,
    streamingContent,
    streamingReasoning,
    status,
    error,
    sendMessage,
    cancel,
    retry,
    clearHistory,
    insertMessageToCursor,
    copyMessage,
    loadHistory,
  };
};
