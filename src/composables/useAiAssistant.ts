import { onUnmounted, ref } from "vue";
import { aiService } from "../services/aiService";
import type { AiEditAction } from "../types/ai";

export type AiRunStatus = "idle" | "streaming" | "done" | "error";

export interface AiAssistantOptions {
  getSelection: () => string;
  getDocumentContext: () => string;
  applyResult: (text: string, replaceSelection: boolean) => void;
}

interface LastRun {
  action: AiEditAction;
  selection: string;
  documentContext: string;
  language?: string;
  instruction?: string;
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useAiAssistant = (options: AiAssistantOptions) => {
  const isStreaming = ref(false);
  const status = ref<AiRunStatus>("idle");
  const result = ref("");
  const error = ref("");
  const activeRequestId = ref("");
  const currentAction = ref<AiEditAction | null>(null);
  let lastRun: LastRun | null = null;

  const clearResult = (): void => {
    const previousRequestId = activeRequestId.value;
    result.value = "";
    error.value = "";
    status.value = "idle";
    activeRequestId.value = "";
    if (isStreaming.value && previousRequestId) aiService.cancel(previousRequestId);
    isStreaming.value = false;
    currentAction.value = null;
  };

  const cancel = (): void => {
    if (!activeRequestId.value) return;
    aiService.cancel(activeRequestId.value);
    isStreaming.value = false;
    status.value = "done";
  };

  const runAction = async (
    action: AiEditAction,
    instruction = "",
    language?: string,
  ): Promise<void> => {
    const selection = options.getSelection().trim();
    const documentContext = options.getDocumentContext().trim();
    if (!selection && !documentContext) {
      status.value = "error";
      error.value = "请先选中一段文本，或在文档中执行 AI 动作。";
      return;
    }

    clearResult();
    const requestId = createRequestId();
    currentAction.value = action;
    activeRequestId.value = requestId;
    isStreaming.value = true;
    status.value = "streaming";
    lastRun = {
      action,
      selection,
      documentContext,
      language,
      instruction: instruction.trim() || undefined,
    };

    try {
      await aiService.invoke({
        requestId,
        action,
        selection,
        documentContext,
        options: {
          ...(language ? { language } : {}),
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        },
      });
    } catch (invokeError) {
      if (status.value === "streaming") {
        status.value = "error";
        isStreaming.value = false;
        error.value = invokeError instanceof Error ? invokeError.message : String(invokeError);
      }
    }
  };

  const retry = (): void => {
    if (!lastRun) return;
    void runAction(
      lastRun.action,
      lastRun.instruction ?? "",
      lastRun.language,
    );
  };

  const copyResult = async (): Promise<void> => {
    if (!result.value) return;
    await navigator.clipboard.writeText(result.value);
  };

  const insertResult = (replaceSelection: boolean): void => {
    if (!result.value || status.value === "streaming") return;
    options.applyResult(result.value, replaceSelection);
    clearResult();
  };

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
    runAction,
    retry,
    cancel,
    copyResult,
    insertResult,
    clearResult,
  };
};