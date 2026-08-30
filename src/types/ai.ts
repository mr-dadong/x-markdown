export type AiProvider = "openai" | "anthropic" | "deepseek" | "minimax" | "ollama" | "custom";

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
  | "frontmatter"
  | "ai-write";

/** 每个厂商独立的配置（完整版，含 apiKey，仅主进程使用） */
export interface AiProviderConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  customModels?: string[];
}

/** 展现在渲染进程的厂商配置（不含 apiKey，仅含 hasApiKey 标记） */
export interface AiProviderPublicConfig {
  model: string;
  baseUrl?: string;
  hasApiKey: boolean;
  customModels?: string[];
}

export interface AiSettings {
  enabled: boolean;
  /** 当前选中的厂商 */
  provider: AiProvider;
  /** 每个厂商独立存储的配置 */
  providers: Record<string, AiProviderConfig>;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  allowLocalRequests: boolean;
}

export interface AiSettingsInput {
  enabled?: boolean;
  provider?: AiProvider;
  providers?: Record<string, AiProviderConfig>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  allowLocalRequests?: boolean;
}

export interface AiPublicSettings {
  enabled: boolean;
  provider: AiProvider;
  /** 每个厂商的公开配置（不含 apiKey） */
  providers: Record<string, AiProviderPublicConfig>;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  allowLocalRequests: boolean;
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

export interface AiTestConnectionResult {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs?: number;
  sampleTokenCount?: number;
  error?: string;
}

export interface AiServiceApi {
  getSettings: () => Promise<AiPublicSettings>;
  saveSettings: (settings: AiSettingsInput) => Promise<AiPublicSettings>;
  getStatus: () => Promise<AiStatus>;
  fetchModels: () => Promise<AiFetchModelsResult>;
  /**
   * 使用当前表单草稿（未保存）获取模型列表，不会把草稿真正写入磁盘，
   * 也不会触发缓存快照、选区工具栏状态同步等副作用。
   */
  fetchModelsWithDraft: (draft: AiSettingsInput) => Promise<AiFetchModelsResult>;
  testConnection: () => Promise<AiTestConnectionResult>;
  /**
   * 使用当前表单草稿（未保存）跑一次 1 token 连通性测试，
   * 不会把草稿落盘，确保「点测试」与「点保存再用」行为完全一致。
   */
  testConnectionWithDraft: (draft: AiSettingsInput) => Promise<AiTestConnectionResult>;
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
  /** 仅模型名（不含厂商前缀）；缺省或空表示使用设置页当前厂商的模型 */
  model?: string
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