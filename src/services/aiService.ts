import type {
  AiChatDeltaEvent,
  AiChatDoneEvent,
  AiChatErrorEvent,
  AiChatRequest,
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiFetchModelsResult,
  AiInvokeRequest,
  AiPublicSettings,
  AiSettingsInput,
  AiStatus,
} from "../types/ai";

export const aiService = {
  getSettings: (): Promise<AiPublicSettings> => window.electronAPI.aiService.getSettings(),
  saveSettings: (settings: AiSettingsInput): Promise<AiPublicSettings> =>
    window.electronAPI.aiService.saveSettings(settings),
  getStatus: (): Promise<AiStatus> => window.electronAPI.aiService.getStatus(),
  fetchModels: (): Promise<AiFetchModelsResult> => window.electronAPI.aiService.fetchModels(),
  invoke: (request: AiInvokeRequest) => window.electronAPI.aiService.invoke(request),
  cancel: (requestId: string) => window.electronAPI.aiService.cancel(requestId),
  onDelta: (callback: (event: AiDeltaEvent) => void) => window.electronAPI.aiService.onDelta(callback),
  onDone: (callback: (event: AiDoneEvent) => void) => window.electronAPI.aiService.onDone(callback),
  onError: (callback: (event: AiErrorEvent) => void) => window.electronAPI.aiService.onError(callback),
  // Chat 多轮对话
  chatInvoke: (request: AiChatRequest) => window.electronAPI.aiService.chatInvoke(request),
  chatCancel: (requestId: string) => window.electronAPI.aiService.chatCancel(requestId),
  onChatDelta: (callback: (event: AiChatDeltaEvent) => void) => window.electronAPI.aiService.onChatDelta(callback),
  onChatDone: (callback: (event: AiChatDoneEvent) => void) => window.electronAPI.aiService.onChatDone(callback),
  onChatError: (callback: (event: AiChatErrorEvent) => void) => window.electronAPI.aiService.onChatError(callback),
};