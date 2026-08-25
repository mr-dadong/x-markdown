import { onUnmounted, ref } from "vue";
import { aiService } from "../services/aiService";
import type { AiEditAction } from "../types/ai";

export type InlineAiStatus = "idle" | "streaming" | "done" | "error";

export interface InlineAiOptions {
  getSelection: () => string;
  getDocumentContext: () => string;
  applyResult: (text: string) => void;
}

function createRequestId(): string {
  return `inline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useInlineAi = (options: InlineAiOptions) => {
  const isStreaming = ref(false);
  const status = ref<InlineAiStatus>("idle");
  const result = ref("");
  const error = ref("");
  const activeRequestId = ref("");
  const currentAction = ref<AiEditAction | null>(null);
  const justCancelled = ref(false);

  const clearResult = (): void => {
    if (isStreaming.value && activeRequestId.value) {
      aiService.cancel(activeRequestId.value);
    }
    result.value = "";
    error.value = "";
    status.value = "idle";
    activeRequestId.value = "";
    isStreaming.value = false;
    currentAction.value = null;
  };

  const cancel = (): void => {
    if (!activeRequestId.value) return;
    aiService.cancel(activeRequestId.value);
    isStreaming.value = false;
    status.value = "idle";
    activeRequestId.value = "";
    currentAction.value = null;
    justCancelled.value = true;
    // 500ms 后重置标志，允许再次显示选择条
    setTimeout(() => {
      justCancelled.value = false;
    }, 500);
  };

  const runAction = async (action: AiEditAction): Promise<void> => {
    const selection = options.getSelection().trim();
    const documentContext = options.getDocumentContext().trim();
    if (!selection && !documentContext) {
      error.value = "请先选中文本";
      status.value = "error";
      return;
    }

    clearResult();
    const requestId = createRequestId();
    currentAction.value = action;
    activeRequestId.value = requestId;
    isStreaming.value = true;
    status.value = "streaming";

    try {
      await aiService.invoke({
        requestId,
        action,
        selection,
        documentContext,
      });
    } catch (invokeError) {
      if (status.value === "streaming") {
        status.value = "error";
        isStreaming.value = false;
        error.value = invokeError instanceof Error ? invokeError.message : String(invokeError);
      }
    }
  };

  const acceptResult = (): void => {
    if (!result.value || status.value === "streaming") return;
    options.applyResult(result.value);
    clearResult();
  };

  const rejectResult = (): void => {
    clearResult();
  };

  const retry = (): void => {
    if (!currentAction.value) return;
    void runAction(currentAction.value);
  };

  // 监听流式事件
  const offDelta = aiService.onDelta((event) => {
    if (event.requestId !== activeRequestId.value) return;
    result.value += event.delta;
  });

  const offDone = aiService.onDone((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "done";
    activeRequestId.value = "";
  });

  const offError = aiService.onError((event) => {
    if (event.requestId !== activeRequestId.value) return;
    isStreaming.value = false;
    status.value = "error";
    error.value = event.error;
    activeRequestId.value = "";
  });

  onUnmounted(() => {
    if (activeRequestId.value) aiService.cancel(activeRequestId.value);
    offDelta();
    offDone();
    offError();
  });

  return {
    isStreaming,
    status,
    result,
    error,
    currentAction,
    justCancelled,
    runAction,
    acceptResult,
    rejectResult,
    retry,
    cancel,
    clearResult,
  };
};
