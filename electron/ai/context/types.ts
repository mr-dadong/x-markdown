// 检索模块的类型定义：文档块、文档索引、检索结果、检索选项。
// 这些类型只在主进程使用（切块/检索是 CPU 密集任务，放主进程不阻塞编辑器 UI）。

/** 文档块的类型标记，用于提示模型片段属于哪种内容 */
export type DocumentChunkKind = "heading" | "paragraph" | "code" | "list" | "table";

/** 单个文档块：从整篇 Markdown 中切出的一段语义完整的内容 */
export interface DocumentChunk {
  /** 块内容的稳定 hash（SHA-256 前 12 位），用于缓存失效判断 */
  id: string;
  /** 块的纯文本内容（不含标题行，标题行在 headingPath 里） */
  text: string;
  /** 标题路径，如 ["# 用户指南", "## 安装"]，让模型知道片段在文档中的位置 */
  headingPath: string[];
  /** 块在原始文档中的起始字符偏移（含标题行），用于"光标邻接块"判断和引用溯源 */
  startChar: number;
  /** 块在原始文档中的结束字符偏移（不含，半开区间 [startChar, endChar)） */
  endChar: number;
  /** 估算 token 数（中文约 1.5 字/token，英文约 4 字符/token） */
  tokenCount: number;
  /** 块类型标记 */
  kind: DocumentChunkKind;
}

/** 文档索引（内存缓存，按内容 hash 失效） */
export interface DocumentIndex {
  /** 整篇文档内容的 SHA-256 前 12 位，内容变了就重建索引 */
  docHash: string;
  /** 切好的文档块 */
  chunks: DocumentChunk[];
  /** 倒排索引：term → chunkId[]（BM25 用，算每个词的文档频率） */
  invertedIndex: Map<string, string[]>;
  /** 词频表：term → chunkId → 出现次数（BM25 用，算每个块内词频） */
  termFrequencies: Map<string, Map<string, number>>;
  /** 每个块的词元总数（BM25 用，算文档长度） */
  docLengths: Map<string, number>;
  /** 所有块的平均词元数（BM25 用） */
  avgDocLength: number;
  /** 索引创建时间，便于排查缓存问题 */
  createdAt: number;
}

/** 检索结果：预算内最相关的文档块 + 选区 + 光标上下文 */
export interface RetrievedContext {
  /** 命中的块（已按相关性排序，已截断到预算内） */
  chunks: DocumentChunk[];
  /** 当前选区文本（始终包含，不受检索影响） */
  selection: string;
  /** 光标周围的上下文（始终包含，来自光标所在块） */
  cursorContext: string;
  /** 本次注入的文档内容总 token 估算（块 + 选区 + 光标） */
  totalTokens: number;
  /** 本次检索使用的 query（用户消息 + 最近对话） */
  query: string;
}

/** 检索选项：调用方（aiIpc）在发起 chat 请求时组装传入 */
export interface RetrievalOptions {
  /** 用户当前消息 + 最近对话（BM25 的相关性依据） */
  query: string;
  /** 完整文档文本（Markdown 源码，切块/检索都在主进程做） */
  documentText: string;
  /** 当前选区文本；为空表示没有选区 */
  selection: string;
  /** 光标在文档中的字符偏移；为 null 表示没有光标信息 */
  cursorOffset: number | null;
  /** 模型的 context window 大小（token） */
  contextWindow: number;
  /** 对话历史已占用的 token 估算 */
  historyTokens: number;
  /** 最大输出 token */
  maxOutputTokens: number;
}
