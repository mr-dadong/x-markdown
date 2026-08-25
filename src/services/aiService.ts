import type {
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
};