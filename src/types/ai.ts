export type AiProvider = "openai" | "anthropic" | "ollama" | "custom";

export type AiEditAction =
  | "polish"
  | "rewrite"
  | "summarize"
  | "translate"
  | "continue"
  | "explain-code"
  | "fix-code"
  | "outline"
  | "toc"
  | "table"
  | "callout"
  | "mermaid"
  | "frontmatter";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  allowLocalRequests: boolean;
  customModels?: string[];
}

export interface AiSettingsInput {
  enabled?: boolean;
  provider?: AiProvider;
  model?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  allowLocalRequests?: boolean;
  customModels?: string[];
}

export interface AiPublicSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  hasApiKey: boolean;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  allowLocalRequests: boolean;
  customModels: string[];
}

export interface AiStatus {
  initialized: boolean;
  configured: boolean;
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
}

export interface AiInvokeRequest {
  requestId: string;
  action: AiEditAction;
  selection?: string;
  documentContext?: string;
  options?: {
    language?: string;
    instruction?: string;
  };
}

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
}

export interface AiDoneEvent {
  requestId: string;
}

export interface AiErrorEvent {
  requestId: string;
  error: string;
}

export interface AiModelInfo {
  id: string;
  name?: string;
}

export interface AiFetchModelsResult {
  models: AiModelInfo[];
  error?: string;
}

export interface AiServiceApi {
  getSettings: () => Promise<AiPublicSettings>;
  saveSettings: (settings: AiSettingsInput) => Promise<AiPublicSettings>;
  getStatus: () => Promise<AiStatus>;
  fetchModels: () => Promise<AiFetchModelsResult>;
  invoke: (request: AiInvokeRequest) => Promise<{ requestId: string }>;
  cancel: (requestId: string) => void;
  onDelta: (callback: (event: AiDeltaEvent) => void) => () => void;
  onDone: (callback: (event: AiDoneEvent) => void) => () => void;
  onError: (callback: (event: AiErrorEvent) => void) => () => void;
}