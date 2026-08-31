import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type IpcMainEvent } from "electron";
import { IPC_CHANNELS } from "../../../src/constants/ipcChannels";
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
  AiModelInfo,
  AiProvider,
  AiProviderConfig,
  AiSettings,
  AiSettingsInput,
} from "../../../src/types/ai";
import { getAiSettings, currentProviderConfig, saveAiSettings, toPublicSettings, testAiConnection, resolveApiKey, normalizeSettings, isAiProvider } from "../aiSettings";
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
  "ai-write",
]);

function assertInvokeRequest(value: unknown): asserts value is AiInvokeRequest {
  if (!value || typeof value !== "object") throw new Error("AI 请求格式不正确");
  const request = value as Partial<AiInvokeRequest>;
  // ai-write 支持纯指令编写：空文档、无选区时只携带 instruction 也能发起请求
  const hasContext =
    typeof request.selection === "string" || typeof request.documentContext === "string";
  const hasInstruction =
    typeof request.options?.instruction === "string" && request.options.instruction.trim() !== "";
  if (
    typeof request.requestId !== "string" ||
    !request.requestId ||
    typeof request.action !== "string" ||
    !EDIT_ACTIONS.has(request.action) ||
    (!hasContext && !hasInstruction)
  ) {
    throw new Error("AI 请求格式不正确");
  }
}

function errorMessage(error: unknown): string {
return error instanceof Error ? error.message : String(error);
}

function timeoutMessage(timeoutMs: number): string {
return `请求超时：AI 未在 ${Math.round(timeoutMs / 1000)} 秒内完成响应，可在 AI 设置中调大超时时间后重试`;
}

function resolveBaseUrl(provider: string, customBaseUrl?: string): string {
  if (customBaseUrl) return customBaseUrl.replace(/\/+$/, "");
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "minimax":
      return "https://api.minimax.io/v1";
    case "ollama":
      return "http://localhost:11434/v1";
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
  // Ollama 原生 /api/tags 接口需要不带 /v1 的根地址
  const rootUrl = baseUrl.replace(/\/v1\/?$/, "");
  const url = `${rootUrl}/api/tags`;
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

async function fetchModels(settingsInput?: AiSettingsInput): Promise<AiFetchModelsResult> {
  try {
    const base = await getAiSettings();
    const settings = settingsInput
      ? normalizeSettings(
          { ...settingsInput, providers: mergeDraftApiKeys(base, settingsInput) },
          base,
        )
      : base;
    const config = currentProviderConfig(settings);
    // config.apiKey 已含草稿 Key 或解密后的已存 Key；这里只是兜底再解析环境变量。
    const apiKey = config.apiKey ?? resolveApiKey(settings, settings.provider);
    const baseUrl = resolveBaseUrl(settings.provider, config.baseUrl);

    let models: AiModelInfo[];
    switch (settings.provider) {
      case "ollama":
        models = await fetchOllamaModels(baseUrl);
        break;
      case "anthropic":
        models = await fetchAnthropicModels();
        break;
      default:
        models = await fetchOpenAiModels(baseUrl, apiKey);
        break;
    }

    return { models };
  } catch (error) {
    return { models: [], error: errorMessage(error) };
  }
}

/**
 * 草稿合并规则：
 * - draft 中目标 provider 显式带 apiKey（用户输入了新 Key）→ 用草稿值。
 * - draft 中目标 provider 没带 apiKey（留空 = 保留原值语义）→ 回退到 base 里
 *   的已保存 Key（getAiSettings 已完成解密）。
 * - 其它 provider 一律沿用 base 值，避免草稿误覆盖其它厂商的配置。
 */
function mergeDraftApiKeys(
  base: AiSettings,
  draft: AiSettingsInput,
): AiSettings["providers"] {
  const baseProviders = base.providers;
  const draftProviders = draft.providers ?? {};
  const merged: Record<string, AiProviderConfig> = { ...baseProviders };
  const targetProvider = isAiProvider(draft.provider) ? draft.provider : base.provider;
  for (const key of Object.keys({ ...baseProviders, ...draftProviders })) {
    const draftCfg = draftProviders[key];
    const baseCfg = baseProviders[key];
    const fallback: AiProviderConfig = baseCfg ?? {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    };
    if (!draftCfg) {
      merged[key] = fallback;
      continue;
    }
    const draftKey =
      typeof draftCfg.apiKey === "string" && draftCfg.apiKey.trim()
        ? draftCfg.apiKey.trim()
        : undefined;
    const resolvedKey =
      key === targetProvider && draftKey ? draftKey : fallback.apiKey;
    merged[key] = {
      model:
        typeof draftCfg.model === "string" && draftCfg.model.trim()
          ? draftCfg.model.trim()
          : fallback.model,
      baseUrl:
        typeof draftCfg.baseUrl === "string" && draftCfg.baseUrl.trim()
          ? draftCfg.baseUrl.trim()
          : fallback.baseUrl,
      apiKey: resolvedKey,
      customModels: Array.isArray(draftCfg.customModels)
        ? draftCfg.customModels.filter(
            (m): m is string => typeof m === "string" && m.trim().length > 0,
          )
        : (fallback.customModels ?? []),
    };
  }
  return merged;
}

export function registerAiIpc(options: { getMainWindow: () => BrowserWindow | null }): void {
  const { getMainWindow } = options;

  // 单窗口桌面应用：校验 AI IPC 请求来自主窗口渲染进程
  function validateSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
    const mainWindow = getMainWindow();
    if (mainWindow && event.sender !== mainWindow.webContents) {
      throw new Error("未授权的 AI 请求来源");
    }
  }

  ipcMain.handle(IPC_CHANNELS.aiGetSettings, async (event) => {
    validateSender(event);
    const settings = await getAiSettings();
    return toPublicSettings(settings);
  });

  ipcMain.handle(
    IPC_CHANNELS.aiSaveSettings,
    async (event, input: AiSettingsInput) => {
      validateSender(event);
      return saveAiSettings(input);
    },
  );

  ipcMain.handle(IPC_CHANNELS.aiGetStatus, async (event) => {
    validateSender(event);
    return getAiAgentStatus();
  });

  ipcMain.handle(IPC_CHANNELS.aiFetchModels, async (event) => {
    validateSender(event);
    return fetchModels();
  });

  ipcMain.handle(
    IPC_CHANNELS.aiFetchModelsWithDraft,
    async (event, draft: AiSettingsInput) => {
      validateSender(event);
      return fetchModels(draft);
    },
  );

  ipcMain.handle(IPC_CHANNELS.aiTestConnection, async (event) => {
    validateSender(event);
    try {
      return await testAiConnection();
    } catch (error) {
      return {
        ok: false,
        provider: 'openai' as AiProvider,
        model: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.aiTestConnectionWithDraft,
    async (event, draft: AiSettingsInput) => {
      validateSender(event);
      try {
        return await testAiConnection(draft);
      } catch (error) {
        return {
          ok: false,
          provider: (draft?.provider ?? 'openai') as AiProvider,
          model: String(draft?.providers?.[draft.provider ?? '']?.model ?? ''),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.aiInvoke, async (event, value: unknown) => {
    validateSender(event);
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
          console.error('[aiIpc] error:', chunk.payload.error);
          sendError(errorMessage(chunk.payload.error));
          finished = true;
        }
      }

      if (!finished && !active.cancelled) {
        sendDone();
      }
    } catch (error) {
      console.error('[aiIpc] catch error:', error);
      if (!active.cancelled) sendError(errorMessage(error));
    } finally {
      clearTimeout(active.timeout);
      activeRequests.delete(request.requestId);
    }

    return { requestId: request.requestId };
  });

  ipcMain.on(IPC_CHANNELS.aiCancel, (event, requestId: string) => {
    validateSender(event);
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
    // 模型覆盖参数为可选；携带时必须是去除空白后非空的字符串
    if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim())) {
      throw new Error("Chat 请求的模型参数不正确");
    }
  }

  ipcMain.handle(IPC_CHANNELS.aiChatInvoke, async (event, value: unknown) => {
    validateSender(event);
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
    const sendReasoningDelta = (delta: string): void => {
      const event: AiChatReasoningDeltaEvent = { requestId: request.requestId, delta };
      getMainWindow()?.webContents.send(IPC_CHANNELS.aiChatStreamReasoningDelta, event);
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
      const agent = await getChatAgent(request.model);

      // 系统提示通过 system 参数传入，消息列表只保留 user/assistant 对话历史
      const systemPrompt = buildChatSystemPrompt(request);
      const messages = request.messages
        .filter((m) => m.role !== "system")
        .map((m, i) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          id: `chat-msg-${i}`,
          createdAt: new Date(),
        }));

      const stream = await agent.stream(messages, {
        system: systemPrompt,
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
        } else if (chunk.type === "reasoning-delta") {
          // 思考模型的推理增量（如 DeepSeek-R1、o 系列、Claude thinking）
          sendReasoningDelta(chunk.payload.text);
        } else if (chunk.type === "finish") {
          finished = true;
          sendDone();
        } else if (chunk.type === "error") {
          sendError(errorMessage(chunk.payload.error));
          finished = true;
        } else if (chunk.type === "abort") {
          // 流被 abortSignal 中断：用户主动取消时前端已自行收尾；
          // 否则是超时触发，需显式告知前端，避免静默当作正常完成
          if (!active.cancelled) {
            sendError(timeoutMessage(settings.timeoutMs));
            finished = true;
          }
        }
      }

      if (!finished && !active.cancelled) {
        // 兑底：即使流未发出 abort chunk，只要信号已触发中断就报超时而非静默完成
        if (controller.signal.aborted) {
          sendError(timeoutMessage(settings.timeoutMs));
        } else {
          sendDone();
        }
      }
    } catch (error) {
      if (!active.cancelled) sendError(errorMessage(error));
    } finally {
      clearTimeout(active.timeout);
      activeRequests.delete(request.requestId);
    }

    return { requestId: request.requestId };
  });

  ipcMain.on(IPC_CHANNELS.aiChatCancel, (event, requestId: string) => {
    validateSender(event);
    const active = activeRequests.get(requestId);
    if (!active) return;
    active.cancelled = true;
    active.controller.abort();
  });
}