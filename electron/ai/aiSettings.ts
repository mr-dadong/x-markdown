import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";
import type {
  AiProvider,
  AiProviderConfig,
  AiProviderPublicConfig,
  AiPublicSettings,
  AiSettings,
  AiSettingsInput,
  AiStatus,
} from "../../src/types/ai";

const AI_SETTINGS_FILE = "ai-settings.json";

const defaultProviderConfig = (): AiProviderConfig => ({
  model: "",
  baseUrl: undefined,
  apiKey: undefined,
  customModels: [],
});

const defaultAiSettings = (): AiSettings => ({
  enabled: false,
  provider: "openai",
  providers: {
    openai: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
    anthropic: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
    deepseek: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
    minimax: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
    ollama: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
    custom: {
      model: "",
      baseUrl: undefined,
      apiKey: undefined,
      customModels: [],
    },
  },
  temperature: 0.7,
  maxTokens: 8192,
  timeoutMs: 30000,
  allowLocalRequests: false,
});

interface StoredAiSettings {
  config: Omit<AiSettings, "providers"> & {
    providers: Record<
      string,
      Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }
    >;
  };
  encryptedApiKeys: Record<string, string>;
}

let cachedSettings: AiSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), AI_SETTINGS_FILE);
}

export function normalizeSettings(
  input: Partial<AiSettings>,
  fallback: AiSettings = defaultAiSettings(),
): AiSettings {
  const provider = isAiProvider(input.provider)
    ? input.provider
    : fallback.provider;
  return {
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : fallback.enabled,
    provider,
    providers: normalizeProviders(
      input.providers,
      fallback.providers,
      provider,
    ),
    temperature:
      typeof input.temperature === "number"
        ? clampTemperature(input.temperature)
        : fallback.temperature,
    maxTokens:
      typeof input.maxTokens === "number" && input.maxTokens > 0
        ? Math.floor(input.maxTokens)
        : fallback.maxTokens,
    timeoutMs:
      typeof input.timeoutMs === "number" && input.timeoutMs > 0
        ? Math.floor(input.timeoutMs)
        : fallback.timeoutMs,
    allowLocalRequests:
      typeof input.allowLocalRequests === "boolean"
        ? input.allowLocalRequests
        : fallback.allowLocalRequests,
  };
}

function normalizeProviders(
  input: Record<string, AiProviderConfig> | undefined,
  fallback: Record<string, AiProviderConfig>,
  currentProvider: AiProvider,
): Record<string, AiProviderConfig> {
  if (!input) return fallback;
  const result: Record<string, AiProviderConfig> = { ...fallback };
  for (const key of Object.keys(input)) {
    const p = input[key];
    if (!p) continue;
    result[key] = {
      model:
        typeof p.model === "string" && p.model.trim()
          ? p.model.trim()
          : (fallback[key]?.model ?? ""),
      baseUrl:
        typeof p.baseUrl === "string" && p.baseUrl.trim()
          ? p.baseUrl.trim()
          : fallback[key]?.baseUrl,
      apiKey:
        typeof p.apiKey === "string" && p.apiKey.trim()
          ? p.apiKey.trim()
          : fallback[key]?.apiKey,
      customModels: Array.isArray(p.customModels)
        ? p.customModels.filter(
            (m): m is string => typeof m === "string" && m.trim().length > 0,
          )
        : (fallback[key]?.customModels ?? []),
    };
  }
  return result;
}

export function isAiProvider(value: unknown): value is AiProvider {
  return (
    value === "openai" ||
    value === "anthropic" ||
    value === "deepseek" ||
    value === "minimax" ||
    value === "ollama" ||
    value === "custom"
  );
}

function clampTemperature(value: number): number {
  return Math.min(2, Math.max(0, Number.isFinite(value) ? value : 0.7));
}

function storedApiKey(
  encryptedApiKeys: Record<string, string>,
  provider: string,
): string | undefined {
  const encrypted = encryptedApiKeys[provider];
  if (!encrypted) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return undefined;
  }
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法安全保存 API Key");
  }
  return safeStorage.encryptString(apiKey).toString("base64");
}

function envApiKey(provider: AiProvider): string | undefined {
  const envNames: Record<AiProvider, string[]> = {
    openai: ["XMD_AI_API_KEY", "OPENAI_API_KEY"],
    anthropic: ["XMD_AI_API_KEY", "ANTHROPIC_API_KEY"],
    deepseek: ["XMD_AI_API_KEY", "DEEPSEEK_API_KEY"],
    minimax: ["XMD_AI_API_KEY", "MINIMAX_API_KEY"],
    ollama: ["XMD_AI_API_KEY", "OLLAMA_API_KEY"],
    custom: ["XMD_AI_API_KEY"],
  };
  for (const name of envNames[provider]) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

async function readStoredSettings(): Promise<StoredAiSettings | null> {
  try {
    const raw = await fs.promises.readFile(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    // 迁移旧格式：扁平 model/baseUrl/apiKey → 每个厂商独立配置
    if (parsed && typeof parsed === "object" && "config" in parsed) {
      const p = parsed as Record<string, unknown>;
      const config = p.config as Record<string, unknown> | undefined;
      if (
        config &&
        typeof config === "object" &&
        "provider" in config &&
        !("providers" in config)
      ) {
        // 旧格式：单套配置
        const oldProvider = String(config.provider ?? "openai");
        const oldModel = String(config.model ?? "");
        const oldBaseUrl =
          typeof config.baseUrl === "string" ? config.baseUrl : undefined;
        const oldCustomModels = Array.isArray(config.customModels)
          ? config.customModels.filter(
              (m): m is string => typeof m === "string",
            )
          : [];
        const oldEncryptedApiKey =
          typeof p.encryptedApiKey === "string" ? p.encryptedApiKey : undefined;
        const oldEncryptedApiKeys =
          typeof p.encryptedApiKeys === "object" && p.encryptedApiKeys !== null
            ? (p.encryptedApiKeys as Record<string, string>)
            : {};

        if (oldEncryptedApiKey && !oldEncryptedApiKeys[oldProvider]) {
          oldEncryptedApiKeys[oldProvider] = oldEncryptedApiKey;
        }

        const providers: Record<
          string,
          Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }
        > = {};
        for (const key of Object.keys(defaultAiSettings().providers)) {
          providers[key] = {
            model: key === oldProvider ? oldModel : "",
            baseUrl: key === oldProvider ? oldBaseUrl : undefined,
            customModels: key === oldProvider ? oldCustomModels : [],
          };
        }

        const migrated: StoredAiSettings = {
          config: {
            enabled:
              typeof config.enabled === "boolean" ? config.enabled : false,
            provider: oldProvider as AiProvider,
            providers,
            temperature:
              typeof config.temperature === "number" ? config.temperature : 0.7,
            maxTokens:
              typeof config.maxTokens === "number" ? config.maxTokens : 8192,
            timeoutMs:
              typeof config.timeoutMs === "number" ? config.timeoutMs : 30000,
            allowLocalRequests:
              typeof config.allowLocalRequests === "boolean"
                ? config.allowLocalRequests
                : false,
          },
          encryptedApiKeys: oldEncryptedApiKeys,
        };
        // 立即写入迁移后的格式
        await writeStoredSettings(migrated);
        return migrated;
      }
    }

    return parsed as StoredAiSettings;
  } catch {
    return null;
  }
}

async function writeStoredSettings(stored: StoredAiSettings): Promise<void> {
  await fs.promises.writeFile(
    settingsPath(),
    JSON.stringify(stored, null, 2),
    "utf-8",
  );
}

function resolveApiKeyForProvider(
  provider: AiProvider,
  stored: StoredAiSettings | null,
  config: AiProviderConfig,
): string | undefined {
  if (config.apiKey) return config.apiKey;
  const decrypted = stored
    ? storedApiKey(stored.encryptedApiKeys, provider)
    : undefined;
  if (decrypted) return decrypted;
  return envApiKey(provider);
}

export async function getAiSettings(): Promise<AiSettings> {
  if (cachedSettings) return cachedSettings;
  const stored = await readStoredSettings();
  if (!stored) {
    cachedSettings = defaultAiSettings();
    return cachedSettings;
  }
  const { config, encryptedApiKeys } = stored;
  const providers: Record<string, AiProviderConfig> = {};
  const defaultProviders = defaultAiSettings().providers;
  for (const key of Object.keys(defaultProviders)) {
    const storedConfig = config.providers[key];
    providers[key] = {
      model: storedConfig?.model ?? "",
      baseUrl: storedConfig?.baseUrl,
      // 密钥加密存放在 encryptedApiKeys，加载进内存时必须解密还原，
      // 否则重启后 hasApiKey、测试连接、Mastra 运行时都读不到已保存的密钥。
      apiKey: storedApiKey(encryptedApiKeys, key),
      customModels: storedConfig?.customModels ?? [],
    };
  }
  cachedSettings = {
    enabled: config.enabled,
    provider: isAiProvider(config.provider)
      ? config.provider
      : defaultAiSettings().provider,
    providers,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    allowLocalRequests: config.allowLocalRequests,
  };
  return cachedSettings;
}

export async function saveAiSettings(
  input: AiSettingsInput,
): Promise<AiPublicSettings> {
  const current = cachedSettings ?? (await getAiSettings());
  const merged = normalizeSettings(input, current);
  const stored = await readStoredSettings();
  const encryptedApiKeys: Record<string, string> = {
    ...(stored?.encryptedApiKeys ?? {}),
  };
  const providers: Record<
    string,
    Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }
  > = {};
  for (const key of Object.keys(merged.providers)) {
    const p = merged.providers[key];
    if (p.apiKey) {
      encryptedApiKeys[key] = encryptApiKey(p.apiKey);
    }
    providers[key] = {
      model: p.model,
      baseUrl: p.baseUrl,
      customModels: p.customModels,
    };
  }
  const toStore: StoredAiSettings = {
    config: {
      enabled: merged.enabled,
      provider: merged.provider,
      providers,
      temperature: merged.temperature,
      maxTokens: merged.maxTokens,
      timeoutMs: merged.timeoutMs,
      allowLocalRequests: merged.allowLocalRequests,
    },
    encryptedApiKeys,
  };
  await writeStoredSettings(toStore);
  cachedSettings = merged;
  return toPublicSettings(merged);
}

export async function getAiStatus(): Promise<AiStatus> {
  const settings = await getAiSettings();
  const config = currentProviderConfig(settings);
  const apiKey =
    config.apiKey ??
    resolveApiKeyForProvider(
      settings.provider,
      await readStoredSettings(),
      config,
    );
  return {
    initialized: true,
    configured:
      settings.enabled &&
      Boolean(config.model) &&
      (Boolean(apiKey) || settings.allowLocalRequests),
    provider: settings.provider,
    model: config.model,
    hasApiKey: Boolean(apiKey),
  };
}

/** 获取当前选中厂商的独立配置 */
export function currentProviderConfig(settings: AiSettings): AiProviderConfig {
  return settings.providers[settings.provider] ?? defaultProviderConfig();
}

/** 获取指定厂商的 API Key（优先用户配置，其次环境变量） */
export function resolveApiKey(
  settings: AiSettings,
  provider: string,
): string | undefined {
  const config = settings.providers[provider] ?? defaultProviderConfig();
  if (config.apiKey) return config.apiKey;
  return envApiKey(provider as AiProvider);
}

export function toPublicSettings(settings: AiSettings): AiPublicSettings {
  const providers: Record<string, AiProviderPublicConfig> = {};
  for (const key of Object.keys(settings.providers)) {
    const p = settings.providers[key];
    providers[key] = {
      model: p.model,
      baseUrl: p.baseUrl,
      hasApiKey: Boolean(p.apiKey) || Boolean(envApiKey(key as AiProvider)),
      customModels: p.customModels,
    };
  }
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    providers,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
    allowLocalRequests: settings.allowLocalRequests,
  };
}

/**
 * 把「当前表单草稿」和「磁盘上已经保存的配置」合并成一份可用于验证的临时设置，
 * 不会真正写入磁盘、也不污染 cachedSettings。合并规则：
 * - draft 里目标 provider 填了新 Key → 用草稿值。
 * - draft 里目标 provider 没填 Key → 沿用 base 已解密保存的 Key（= 留空保留原值语义）。
 * - 其它 provider 全部沿用 base，避免影响保存到磁盘上的值。
 */
function mergeDraftApiKeys(
  base: AiSettings,
  draftInput: Partial<AiSettings>,
): AiSettings["providers"] {
  const baseProviders = base.providers;
  const draftProviders = draftInput.providers ?? {};
  const merged: Record<string, AiProviderConfig> = { ...baseProviders };
  const targetProvider = isAiProvider(draftInput.provider)
    ? draftInput.provider
    : base.provider;
  for (const key of Object.keys({ ...baseProviders, ...draftProviders })) {
    const draftCfg = draftProviders[key];
    const baseCfg = baseProviders[key];
    const fallback: AiProviderConfig = baseCfg ?? defaultProviderConfig();
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

/**
 * 执行一次最小化的「真实请求级别」连通性验证：发 1 token 的聊天补全，
 * 看能否通过鉴权、连到 baseUrl、模型能干活。与 getStatus / 模型列表的区别：
 *   - getStatus 只看「字段齐不齐」，不访问网络。
 *   - 模型列表有些厂商（Anthropic、Ollama）走不同接口或硬编码，不代表聊天能成。
 *   - 这里直接 hit chat completions，max_tokens=1 把费用控制到极小，适合做「测试连接」按钮。
 */
export async function testAiConnection(
  draftInput?: Partial<AiSettings>,
): Promise<{
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs?: number;
  sampleTokenCount?: number;
  error?: string;
}> {
  const base = await getAiSettings();
  const settings = draftInput
    ? normalizeSettings(
        { ...draftInput, providers: mergeDraftApiKeys(base, draftInput) },
        base,
      )
    : base;
  const config = currentProviderConfig(settings);
  const provider = settings.provider;
  const model = config.model;

  if (!settings.enabled) {
    return {
      ok: false,
      provider,
      model,
      error: "AI 未启用，请先打开「启用 AI」开关。",
    };
  }
  if (!model.trim()) {
    return { ok: false, provider, model, error: "未选择模型名称。" };
  }
  const apiKey = config.apiKey ?? resolveApiKey(settings, provider);
  if (!apiKey && provider !== "ollama") {
    return { ok: false, provider, model, error: "API Key 未配置。" };
  }

  const baseUrl = ((): string => {
    if (config.baseUrl) return config.baseUrl.replace(/\/+$/, "");
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
        throw new Error("自定义提供方需要填写 API 地址。");
    }
  })();

  // Anthropic 使用独立消息格式与鉴权头。
  const buildRequest = (): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  } => {
    if (provider === "anthropic") {
      return {
        url: baseUrl.replace(/\/v1\/?$/, "") + "/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: {
          model,
          max_tokens: 1,
          temperature: 0,
          messages: [{ role: "user", content: "ping" }],
        },
      };
    }

    // Ollama、OpenAI 兼容家族、custom：都走 /chat/completions。
    const url =
      provider === "ollama"
        ? baseUrl.replace(/\/v1\/?$/, "") + "/v1/chat/completions"
        : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    return {
      url,
      headers,
      body: {
        model,
        max_tokens: 1,
        temperature: 0,
        stream: false,
        messages: [{ role: "user", content: "ping" }],
      },
    };
  };

  let requestTimeoutMs = settings.timeoutMs;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)
    requestTimeoutMs = 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
  const startedAt = Date.now();
  try {
    const { url, headers, body } = buildRequest();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let hint = `请求失败 (${response.status})`;
      if (text) {
        try {
          const parsed = JSON.parse(text) as {
            error?: unknown;
            message?: unknown;
          };
          const detail =
            (typeof parsed.error === "string" && parsed.error) ||
            (typeof parsed.message === "string" && parsed.message) ||
            (parsed.error &&
            typeof parsed.error === "object" &&
            typeof (parsed.error as { message?: unknown }).message === "string"
              ? (parsed.error as { message: string }).message
              : null);
          if (detail) hint += `：${detail}`;
          else hint += `：${text.slice(0, 200)}`;
        } catch {
          hint += `：${text.slice(0, 200)}`;
        }
      } else if (response.statusText) {
        hint += `：${response.statusText}`;
      }
      if (response.status === 401 || response.status === 403)
        hint += "（通常是 API Key 错误或被吊销）";
      if (response.status === 404)
        hint += "（通常是 baseUrl 或模型名写错，该端点不存在）";
      if (response.status === 429) hint += "（触发频率限制）";
      return { ok: false, provider, model, error: hint };
    }

    const data = (await response.json()) as unknown;
    let sampleCount = 0;
    if (
      data &&
      typeof data === "object" &&
      "choices" in data &&
      Array.isArray((data as { choices?: unknown[] }).choices) &&
      (data as { choices: unknown[] }).choices[0]
    ) {
      const choice = (
        data as { choices: Array<{ message?: { content?: unknown } }> }
      ).choices[0];
      const content = choice?.message?.content;
      if (typeof content === "string") sampleCount = content.trim() ? 1 : 0;
    }
    if (
      data &&
      typeof data === "object" &&
      "content" in data &&
      Array.isArray((data as { content?: unknown[] }).content)
    ) {
      const firstBlock = (
        data as { content: Array<{ type?: string; text?: unknown }> }
      ).content[0];
      if (
        firstBlock?.type === "text" &&
        typeof firstBlock.text === "string" &&
        firstBlock.text.trim()
      ) {
        sampleCount = 1;
      }
    }
    return {
      ok: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      sampleTokenCount: sampleCount,
    };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if ((error as Error | null)?.name === "AbortError") {
      message = `连接超时（${Math.round(requestTimeoutMs / 1000)}s 内未收到响应）：检查 baseUrl 是否可达或超时设置是否过小。`;
    } else if (
      /ECONNREFUSED|ENOTFOUND|fetch failed|networkerror|getaddrinfo/i.test(
        message,
      )
    ) {
      message = `无法连接到 ${baseUrl}：${message}（常见原因：baseUrl 写错、本机未开 Ollama、或需要公司代理）。`;
    }
    return { ok: false, provider, model, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}
