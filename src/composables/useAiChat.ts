import { computed, onUnmounted, ref, watch } from "vue";
import { aiService } from "../services/aiService";
import type { AiChatMessage, AiChatRole } from "../types/ai";

export type AiChatStatus = "idle" | "streaming" | "done" | "error";

export interface AiChatOptions {
  /** 获取当前文档内容，用于注入上下文。 */
  getDocumentContext: () => string;
  /** 获取当前选区文本。 */
  getSelection: () => string;
  /** 将文本插入到编辑器光标位置。 */
  insertAtCursor: (text: string) => void;
  /** 用文本替换当前选区。 */
  replaceSelection: (text: string) => void;
  /** 当前文档文件路径，用于按文档隔离对话历史。 */
  filePath: () => string | null;
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

  const addAssistantMessage = (content: string): AiChatMessage => {
    const msg: AiChatMessage = {
      id: createMessageId(),
      role: "assistant",
      content,
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

  const sendMessage = async (content: string): Promise<void> => {
    if (!content.trim() || isStreaming.value) return;

    addUserMessage(content.trim());

    // 准备请求
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequestId.value = requestId;
    isStreaming.value = true;
    streamingContent.value = "";
    status.value = "streaming";
    error.value = "";

    // 构建消息历史（排除 system 消息，由后端注入）
    const chatMessages = messages.value
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      await aiService.chatInvoke({
        requestId,
        messages: chatMessages,
        documentContext: options.getDocumentContext(),
        selection: options.getSelection(),
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
      addAssistantMessage(streamingContent.value);
      streamingContent.value = "";
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
    error.value = "";
    status.value = "idle";
  };

  const insertMessageToCursor = (messageId: string): void => {
    const msg = messages.value.find((m) => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;
    
    // 智能判断：如果有选区则替换选区，否则插入到光标位置
    const selection = options.getSelection();
    if (selection && selection.trim()) {
      options.replaceSelection(msg.content);
      addSystemMessage("已替换选区");
    } else {
      options.insertAtCursor(msg.content);
      addSystemMessage("已插入到文档");
    }
  };

  const copyMessage = async (messageId: string): Promise<void> => {
    const msg = messages.value.find((m) => m.id === messageId);
    if (!msg) return;
    await navigator.clipboard.writeText(msg.content);
  };

  // 监听流式事件
  const offDelta = aiService.onChatDelta((event) => {
    if (event.requestId !== activeRequestId.value) return;
    streamingContent.value += event.delta;
  });

  const offDone = aiService.onChatDone((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "done";
    // 将流式内容保存为 assistant 消息
    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value);
    }
    streamingContent.value = "";
    activeRequestId.value = "";
  });

  const offError = aiService.onChatError((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "error";
    error.value = event.error;
    addSystemMessage(`错误：${event.error}`);
    streamingContent.value = "";
    activeRequestId.value = "";
  });

  onUnmounted(() => {
    if (activeRequestId.value) aiService.chatCancel(activeRequestId.value);
    offDelta();
    offDone();
    offError();
  });

  return {
    messages,
    isStreaming,
    streamingContent,
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
