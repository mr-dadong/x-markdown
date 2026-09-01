import type {
  AiChatDeltaEvent,
  AiChatDoneEvent,
  AiChatErrorEvent,
  AiChatReasoningDeltaEvent,
  AiChatRequest,
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiFetchModelsResult,
  AiInvokeRequest,
  AiReasoningDeltaEvent,
  AiPublicSettings,
  AiSettingsInput,
  AiStatus,
  AiTestConnectionResult,
} from "../types/ai";

export const aiService = {
  getSettings: (): Promise<AiPublicSettings> => window.electronAPI.aiService.getSettings(),
  saveSettings: (settings: AiSettingsInput): Promise<AiPublicSettings> =>
    window.electronAPI.aiService.saveSettings(settings),
  getStatus: (): Promise<AiStatus> => window.electronAPI.aiService.getStatus(),
  fetchModels: (): Promise<AiFetchModelsResult> => window.electronAPI.aiService.fetchModels(),
  fetchModelsWithDraft: (draft: AiSettingsInput): Promise<AiFetchModelsResult> =>
    window.electronAPI.aiService.fetchModelsWithDraft(draft),
  testConnection: (): Promise<AiTestConnectionResult> => window.electronAPI.aiService.testConnection(),
  testConnectionWithDraft: (draft: AiSettingsInput): Promise<AiTestConnectionResult> =>
    window.electronAPI.aiService.testConnectionWithDraft(draft),
  invoke: (request: AiInvokeRequest) => window.electronAPI.aiService.invoke(request),
  cancel: (requestId: string) => window.electronAPI.aiService.cancel(requestId),
  onDelta: (callback: (event: AiDeltaEvent) => void) => window.electronAPI.aiService.onDelta(callback),
  onReasoningDelta: (callback: (event: AiReasoningDeltaEvent) => void) =>
    window.electronAPI.aiService.onReasoningDelta(callback),
  onDone: (callback: (event: AiDoneEvent) => void) => window.electronAPI.aiService.onDone(callback),
  onError: (callback: (event: AiErrorEvent) => void) => window.electronAPI.aiService.onError(callback),
  // Chat 多轮对话
  chatInvoke: (request: AiChatRequest) => window.electronAPI.aiService.chatInvoke(request),
  chatCancel: (requestId: string) => window.electronAPI.aiService.chatCancel(requestId),
  onChatDelta: (callback: (event: AiChatDeltaEvent) => void) => window.electronAPI.aiService.onChatDelta(callback),
  onChatReasoningDelta: (callback: (event: AiChatReasoningDeltaEvent) => void) =>
    window.electronAPI.aiService.onChatReasoningDelta(callback),
  onChatDone: (callback: (event: AiChatDoneEvent) => void) => window.electronAPI.aiService.onChatDone(callback),
  onChatError: (callback: (event: AiChatErrorEvent) => void) => window.electronAPI.aiService.onChatError(callback),
};
