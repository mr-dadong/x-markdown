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
    openai: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
    anthropic: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
    deepseek: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
    minimax: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
    ollama: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
    custom: { model: "", baseUrl: undefined, apiKey: undefined, customModels: [] },
  },
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30000,
  allowLocalRequests: false,
});

interface StoredAiSettings {
  config: Omit<AiSettings, "providers"> & {
    providers: Record<string, Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }>;
  };
  encryptedApiKeys: Record<string, string>;
}

let cachedSettings: AiSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), AI_SETTINGS_FILE);
}

function normalizeSettings(
  input: Partial<AiSettings>,
  fallback: AiSettings = defaultAiSettings(),
): AiSettings {
  const provider = isAiProvider(input.provider) ? input.provider : fallback.provider;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallback.enabled,
    provider,
    providers: normalizeProviders(input.providers, fallback.providers, provider),
    temperature: typeof input.temperature === "number"
      ? clampTemperature(input.temperature)
      : fallback.temperature,
    maxTokens: typeof input.maxTokens === "number" && input.maxTokens > 0
      ? Math.floor(input.maxTokens)
      : fallback.maxTokens,
    timeoutMs: typeof input.timeoutMs === "number" && input.timeoutMs > 0
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
      model: typeof p.model === "string" && p.model.trim() ? p.model.trim() : (fallback[key]?.model ?? ""),
      baseUrl: typeof p.baseUrl === "string" && p.baseUrl.trim()
        ? p.baseUrl.trim()
        : (fallback[key]?.baseUrl),
      apiKey: typeof p.apiKey === "string" && p.apiKey.trim()
        ? p.apiKey.trim()
        : (fallback[key]?.apiKey),
      customModels: Array.isArray(p.customModels)
        ? p.customModels.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
        : (fallback[key]?.customModels ?? []),
    };
  }
  return result;
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "openai" || value === "anthropic" || value === "deepseek" || value === "minimax" || value === "ollama" || value === "custom";
}

function clampTemperature(value: number): number {
  return Math.min(2, Math.max(0, Number.isFinite(value) ? value : 0.7));
}

function storedApiKey(encryptedApiKeys: Record<string, string>, provider: string): string | undefined {
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
      if (config && typeof config === "object" && "provider" in config && !("providers" in config)) {
        // 旧格式：单套配置
        const oldProvider = String(config.provider ?? "openai");
        const oldModel = String(config.model ?? "");
        const oldBaseUrl = typeof config.baseUrl === "string" ? config.baseUrl : undefined;
        const oldCustomModels = Array.isArray(config.customModels) ? config.customModels.filter((m): m is string => typeof m === "string") : [];
        const oldEncryptedApiKey = typeof p.encryptedApiKey === "string" ? p.encryptedApiKey : undefined;
        const oldEncryptedApiKeys = typeof p.encryptedApiKeys === "object" && p.encryptedApiKeys !== null
          ? (p.encryptedApiKeys as Record<string, string>) : {};

        if (oldEncryptedApiKey && !oldEncryptedApiKeys[oldProvider]) {
          oldEncryptedApiKeys[oldProvider] = oldEncryptedApiKey;
        }

        const providers: Record<string, Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }> = {};
        for (const key of Object.keys(defaultAiSettings().providers)) {
          providers[key] = {
            model: key === oldProvider ? oldModel : "",
            baseUrl: key === oldProvider ? oldBaseUrl : undefined,
            customModels: key === oldProvider ? oldCustomModels : [],
          };
        }

        const migrated: StoredAiSettings = {
          config: {
            enabled: typeof config.enabled === "boolean" ? config.enabled : false,
            provider: oldProvider as AiProvider,
            providers,
            temperature: typeof config.temperature === "number" ? config.temperature : 0.7,
            maxTokens: typeof config.maxTokens === "number" ? config.maxTokens : 2048,
            timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : 30000,
            allowLocalRequests: typeof config.allowLocalRequests === "boolean" ? config.allowLocalRequests : false,
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
  await fs.promises.writeFile(settingsPath(), JSON.stringify(stored, null, 2), "utf-8");
}

function resolveApiKeyForProvider(
  provider: AiProvider,
  stored: StoredAiSettings | null,
  config: AiProviderConfig,
): string | undefined {
  if (config.apiKey) return config.apiKey;
  const decrypted = stored ? storedApiKey(stored.encryptedApiKeys, provider) : undefined;
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
    const encrypted = encryptedApiKeys[key];
    const apiKey = storedConfig?.apiKey ?? (encrypted ? undefined : undefined);
    const env = envApiKey(key as AiProvider);
    providers[key] = {
      model: storedConfig?.model ?? "",
      baseUrl: storedConfig?.baseUrl,
      apiKey: storedConfig?.apiKey ?? undefined,
      customModels: storedConfig?.customModels ?? [],
    };
  }
  cachedSettings = {
    enabled: config.enabled,
    provider: isAiProvider(config.provider) ? config.provider : defaultAiSettings().provider,
    providers,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    allowLocalRequests: config.allowLocalRequests,
  };
  return cachedSettings;
}

export async function saveAiSettings(input: AiSettingsInput): Promise<AiPublicSettings> {
  const current = cachedSettings ?? await getAiSettings();
  const merged = normalizeSettings(input, current);
  const stored = await readStoredSettings();
  const encryptedApiKeys: Record<string, string> = { ...(stored?.encryptedApiKeys ?? {}) };
  const providers: Record<string, Omit<AiProviderConfig, "apiKey"> & { apiKey?: undefined }> = {};
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
  const apiKey = config.apiKey ?? resolveApiKeyForProvider(settings.provider, await readStoredSettings(), config);
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
export function resolveApiKey(settings: AiSettings, provider: string): string | undefined {
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