import { ipcMain, type BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../../src/constants/ipcChannels";
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
  AiModelInfo,
  AiSettingsInput,
} from "../../../src/types/ai";
import { getAiSettings, saveAiSettings, toPublicSettings } from "../aiSettings";
import { getAiAgentStatus, getChatAgent, getWriterAgent } from "../mastra";
import { buildAiPrompt, buildChatSystemPrompt } from "../prompts";

interface ActiveAiRequest {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

const activeRequests = new Map<string, ActiveAiRequest>();

const EDIT_ACTIONS = new Set([
  "polish",
  "rewrite",
  "summarize",
  "translate",
  "continue",
  "explain-code",
  "fix-code",
  "outline",
  "toc",
  "table",
  "callout",
  "mermaid",
  "frontmatter",
]);

function assertInvokeRequest(value: unknown): asserts value is AiInvokeRequest {
  if (!value || typeof value !== "object") throw new Error("AI 请求格式不正确");
  const request = value as Partial<AiInvokeRequest>;
  if (
    typeof request.requestId !== "string" ||
    !request.requestId ||
    typeof request.action !== "string" ||
    !EDIT_ACTIONS.has(request.action) ||
    (typeof request.selection !== "string" && typeof request.documentContext !== "string")
  ) {
    throw new Error("AI 请求格式不正确");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveBaseUrl(provider: string, customBaseUrl?: string): string {
  if (customBaseUrl) return customBaseUrl.replace(/\/+$/, "");
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "ollama":
      return "http://localhost:11434";
    default:
      throw new Error("自定义提供方需要填写 API 地址");
  }
}

async function fetchOpenAiModels(baseUrl: string, apiKey?: string): Promise<AiModelInfo[]> {
  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`获取模型列表失败 (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json() as { data?: Array<{ id: string; name?: string }> };
  if (!Array.isArray(data.data)) throw new Error("模型列表格式不正确");

  return data.data
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOllamaModels(baseUrl: string): Promise<AiModelInfo[]> {
  const url = `${baseUrl}/api/tags`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`获取 Ollama 模型失败 (${response.status}): ${response.statusText}`);
  }

  const data = await response.json() as { models?: Array<{ name: string }> };
  if (!Array.isArray(data.models)) throw new Error("Ollama 模型列表格式不正确");

  return data.models.map((m) => ({ id: m.name, name: m.name }));
}

async function fetchAnthropicModels(): Promise<AiModelInfo[]> {
  // Anthropic 没有公开的模型列表 API，返回已知的常用模型
  return [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
  ];
}

async function fetchModels(): Promise<AiFetchModelsResult> {
  try {
    const settings = await getAiSettings();
    const baseUrl = resolveBaseUrl(settings.provider, settings.baseUrl);

    let models: AiModelInfo[];
    switch (settings.provider) {
      case "ollama":
        models = await fetchOllamaModels(baseUrl);
        break;
      case "anthropic":
        models = await fetchAnthropicModels();
        break;
      default:
        models = await fetchOpenAiModels(baseUrl, settings.apiKey);
        break;
    }

    return { models };
  } catch (error) {
    return { models: [], error: errorMessage(error) };
  }
}

export function registerAiIpc(options: { getMainWindow: () => BrowserWindow | null }): void {
  const { getMainWindow } = options;

  ipcMain.handle(IPC_CHANNELS.aiGetSettings, async () => {
    const settings = await getAiSettings();
    return toPublicSettings(settings);
  });

  ipcMain.handle(
    IPC_CHANNELS.aiSaveSettings,
    async (_event, input: AiSettingsInput) => saveAiSettings(input),
  );

  ipcMain.handle(IPC_CHANNELS.aiGetStatus, async () => getAiAgentStatus());

  ipcMain.handle(IPC_CHANNELS.aiFetchModels, async () => fetchModels());

  ipcMain.handle(IPC_CHANNELS.aiInvoke, async (_event, value: unknown) => {
    assertInvokeRequest(value);
    const request = value;

    const status = await getAiAgentStatus();
    if (!status.configured) {
      throw new Error("请先在设置中启用并配置 AI");
    }

    const settings = await getAiSettings();
    const controller = new AbortController();
    const active: ActiveAiRequest = {
      controller,
      timeout: setTimeout(() => controller.abort(), settings.timeoutMs),
      cancelled: false,
    };
    activeRequests.set(request.requestId, active);

    const sendDelta = (delta: string): void => {
      const event: AiDeltaEvent = { requestId: request.requestId, delta };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiStreamDelta, event);
    };
    const sendDone = (): void => {
      const event: AiDoneEvent = { requestId: request.requestId };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiStreamDone, event);
    };
    const sendError = (message: string): void => {
      const event: AiErrorEvent = { requestId: request.requestId, error: message };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiStreamError, event);
    };

    try {
      const agent = await getWriterAgent();
      const stream = await agent.stream(buildAiPrompt(request), {
        modelSettings: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxTokens,
        },
        abortSignal: controller.signal,
      });

      let finished = false;
      for await (const chunk of stream.fullStream) {
        if (active.cancelled) break;
        if (chunk.type === "text-delta") {
          sendDelta(chunk.payload.text);
        } else if (chunk.type === "finish") {
          finished = true;
          sendDone();
        } else if (chunk.type === "error") {
          sendError(errorMessage(chunk.payload.error));
          finished = true;
        }
      }

      if (!finished && !active.cancelled) sendDone();
    } catch (error) {
      if (!active.cancelled) sendError(errorMessage(error));
    } finally {
      clearTimeout(active.timeout);
      activeRequests.delete(request.requestId);
    }

    return { requestId: request.requestId };
  });

  ipcMain.on(IPC_CHANNELS.aiCancel, (_event, requestId: string) => {
    const active = activeRequests.get(requestId);
    if (!active) return;
    active.cancelled = true;
    active.controller.abort();
  });

  // ─── Chat 多轮对话 ─────────────────────────────────────────────────

  function assertChatRequest(value: unknown): asserts value is AiChatRequest {
    if (!value || typeof value !== "object") throw new Error("Chat 请求格式不正确");
    const request = value as Partial<AiChatRequest>;
    if (typeof request.requestId !== "string" || !request.requestId) {
      throw new Error("Chat 请求缺少 requestId");
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error("Chat 请求缺少消息列表");
    }
  }

  ipcMain.handle(IPC_CHANNELS.aiChatInvoke, async (_event, value: unknown) => {
    assertChatRequest(value);
    const request = value;

    const status = await getAiAgentStatus();
    if (!status.configured) {
      throw new Error("请先在设置中启用并配置 AI");
    }

    const settings = await getAiSettings();
    const controller = new AbortController();
    const active: ActiveAiRequest = {
      controller,
      timeout: setTimeout(() => controller.abort(), settings.timeoutMs),
      cancelled: false,
    };
    activeRequests.set(request.requestId, active);

    const sendDelta = (delta: string): void => {
      const event: AiChatDeltaEvent = { requestId: request.requestId, delta };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiChatStreamDelta, event);
    };
    const sendDone = (): void => {
      const event: AiChatDoneEvent = { requestId: request.requestId };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiChatStreamDone, event);
    };
    const sendError = (message: string): void => {
      const event: AiChatErrorEvent = { requestId: request.requestId, error: message };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiChatStreamError, event);
    };

    try {
      const agent = await getChatAgent();

      // 构建完整的消息列表：系统提示 + 文档上下文 + 对话历史
      const systemPrompt = buildChatSystemPrompt(request);
      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const stream = await agent.stream(messages, {
        modelSettings: {
          temperature: request.options?.temperature ?? settings.temperature,
          maxOutputTokens: request.options?.maxTokens ?? settings.maxTokens,
        },
        abortSignal: controller.signal,
      });

      let finished = false;
      for await (const chunk of stream.fullStream) {
        if (active.cancelled) break;
        if (chunk.type === "text-delta") {
          sendDelta(chunk.payload.text);
        } else if (chunk.type === "finish") {
          finished = true;
          sendDone();
        } else if (chunk.type === "error") {
          sendError(errorMessage(chunk.payload.error));
          finished = true;
        }
      }

      if (!finished && !active.cancelled) sendDone();
    } catch (error) {
      if (!active.cancelled) sendError(errorMessage(error));
    } finally {
      clearTimeout(active.timeout);
      activeRequests.delete(request.requestId);
    }

    return { requestId: request.requestId };
  });

  ipcMain.on(IPC_CHANNELS.aiChatCancel, (_event, requestId: string) => {
    const active = activeRequests.get(requestId);
    if (!active) return;
    active.cancelled = true;
    active.controller.abort();
  });
}