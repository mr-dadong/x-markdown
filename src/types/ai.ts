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
  // Chat 多轮对话
  chatInvoke: (request: AiChatRequest) => Promise<{ requestId: string }>;
  chatCancel: (requestId: string) => void;
  onChatDelta: (callback: (event: AiChatDeltaEvent) => void) => () => void;
  onChatDone: (callback: (event: AiChatDoneEvent) => void) => () => void;
  onChatError: (callback: (event: AiChatErrorEvent) => void) => () => void;
}

// ─── Chat 多轮对话类型 ───────────────────────────────────────────────

export type AiChatRole = 'user' | 'assistant' | 'system'

export interface AiChatMessage {
  id: string
  role: AiChatRole
  content: string
  timestamp: number
}

export interface AiChatRequest {
  requestId: string
  messages: Array<{ role: AiChatRole; content: string }>
  documentContext?: string
  selection?: string
  options?: {
    temperature?: number
    maxTokens?: number
  }
}

export interface AiChatDeltaEvent {
  requestId: string
  delta: string
}

export interface AiChatDoneEvent {
  requestId: string
}

export interface AiChatErrorEvent {
  requestId: string
  error: string
}