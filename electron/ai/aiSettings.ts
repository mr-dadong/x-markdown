import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";
import type {
  AiProvider,
  AiPublicSettings,
  AiSettings,
  AiSettingsInput,
  AiStatus,
} from "../../src/types/ai";

const AI_SETTINGS_FILE = "ai-settings.json";

const defaultAiSettings = (): AiSettings => ({
  enabled: false,
  provider: "openai",
  model: "",
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30000,
  allowLocalRequests: false,
  customModels: [],
});

interface StoredAiSettings {
  config: Omit<AiSettings, "apiKey"> & {
    apiKey?: undefined;
  };
  encryptedApiKey?: string;
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
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : fallback.model,
    baseUrl: typeof input.baseUrl === "string" && input.baseUrl.trim()
      ? input.baseUrl.trim()
      : undefined,
    apiKey: typeof input.apiKey === "string" && input.apiKey.trim()
      ? input.apiKey.trim()
      : undefined,
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
    customModels: Array.isArray(input.customModels)
      ? input.customModels.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : fallback.customModels ?? [],
  };
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "openai" || value === "anthropic" || value === "ollama" || value === "custom";
}

function clampTemperature(value: number): number {
  return Math.min(2, Math.max(0, Number.isFinite(value) ? value : 0.7));
}

function storedApiKey(encryptedApiKey?: string): string | undefined {
  if (!encryptedApiKey) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encryptedApiKey, "base64"));
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
    const parsed = JSON.parse(raw) as Partial<StoredAiSettings>;
    if (!parsed.config || typeof parsed.config !== "object") return null;
    return {
      config: parsed.config as StoredAiSettings["config"],
      encryptedApiKey: typeof parsed.encryptedApiKey === "string"
        ? parsed.encryptedApiKey
        : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function mergeStoredSettings(): Promise<AiSettings> {
  const stored = await readStoredSettings();
  if (!stored) return defaultAiSettings();

  const apiKey = storedApiKey(stored.encryptedApiKey);
  return normalizeSettings({ ...stored.config, ...(apiKey ? { apiKey } : {}) });
}

export async function loadAiSettings(): Promise<AiSettings> {
  if (cachedSettings) return cachedSettings;

  const settings = await mergeStoredSettings();
  const envKey = envApiKey(settings.provider);
  cachedSettings = envKey ? { ...settings, apiKey: envKey } : settings;
  return cachedSettings;
}

export async function getAiSettings(): Promise<AiSettings> {
  return loadAiSettings();
}

export async function saveAiSettings(input: AiSettingsInput): Promise<AiPublicSettings> {
  const current = await loadAiSettings();
  const apiKeyChanged = input.apiKey != null;

  const settings = normalizeSettings({
    ...current,
    ...input,
    enabled: input.enabled ?? current.enabled,
    provider: input.provider ?? current.provider,
    model: input.model?.trim() || current.model,
    baseUrl: input.baseUrl === null
      ? undefined
      : input.baseUrl?.trim() || current.baseUrl,
    temperature: input.temperature ?? current.temperature,
    maxTokens: input.maxTokens ?? current.maxTokens,
    timeoutMs: input.timeoutMs ?? current.timeoutMs,
    allowLocalRequests: input.allowLocalRequests ?? current.allowLocalRequests,
    apiKey: apiKeyChanged
      ? input.apiKey?.trim() || undefined
      : current.apiKey,
  });

  const storedConfig: StoredAiSettings["config"] = {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
    allowLocalRequests: settings.allowLocalRequests,
    customModels: settings.customModels,
  };

  const stored: StoredAiSettings = { config: storedConfig };
  if (settings.apiKey) {
    stored.encryptedApiKey = encryptApiKey(settings.apiKey);
  }

  await fs.promises.mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporaryPath = `${settingsPath()}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(stored, null, 2), "utf-8");
  if (process.platform === "win32") {
    await fs.promises.rm(settingsPath(), { force: true });
  }
  await fs.promises.rename(temporaryPath, settingsPath());

  cachedSettings = settings;
  return toPublicSettings(settings);
}

export async function getAiStatus(): Promise<AiStatus> {
  const settings = await loadAiSettings();
  return {
    initialized: true,
    // allowLocalRequests 仅放宽 configured 判断（免 Key 的本地模型如 Ollama），不拦截网络请求
    configured:
      settings.enabled &&
      Boolean(settings.model) &&
      (Boolean(settings.apiKey) || settings.allowLocalRequests),
    provider: settings.provider,
    model: settings.model,
    hasApiKey: Boolean(settings.apiKey),
  };
}

export function toPublicSettings(settings: AiSettings): AiPublicSettings {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    hasApiKey: Boolean(settings.apiKey),
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
    allowLocalRequests: settings.allowLocalRequests,
    customModels: settings.customModels ?? [],
  };
}