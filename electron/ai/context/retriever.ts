// 检索整合：切块 → 缓存索引 → BM25 排序 → token 预算内选块 → 组装上下文。
// 供 aiIpc 的 chat handler 在组装 system prompt 前调用。
import { chunkMarkdown, estimateTokens, shortHash } from "./chunker";
import { buildBm25Index, bm25Search } from "./bm25";
import { getIndex, setIndex } from "./indexCache";
import type { DocumentChunk, RetrievedContext, RetrievalOptions } from "./types";

/** 系统提示固定开销（角色描述 + 格式说明） */
const SYSTEM_OVERHEAD = 200;

/** token 预算分配：总预算 = 模型窗口 - 历史 - 输出 - 系统开销 */
function allocateBudget(opts: RetrievalOptions): {
  retrievedChunks: number;
  selection: number;
  cursor: number;
} {
  const available = Math.max(
    0,
    opts.contextWindow - opts.historyTokens - opts.maxOutputTokens - SYSTEM_OVERHEAD,
  );
  return {
    // 检索到的文档块：占可用预算 40%，硬上限 4000 token
    retrievedChunks: Math.min(available * 0.4, 4000),
    // 选区：15%，硬上限 1000 token
    selection: Math.min(available * 0.15, 1000),
    // 光标上下文：15%，硬上限 800 token
    cursor: Math.min(available * 0.15, 800),
  };
}

/** 找到包含指定字符偏移的块（半开区间 [startChar, endChar)） */
function findChunkAtOffset(chunks: DocumentChunk[], offset: number): DocumentChunk | undefined {
  return chunks.find((chunk) => offset >= chunk.startChar && offset < chunk.endChar);
}

/** 按 token 预算截断文本，末尾加省略提示（用于选区/光标上下文超预算时） */
function truncateToBudget(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  // 粗略按字符截断：中文约 1.5 字/token，英文约 4 字符/token，取保守的 3 字符/token 折算
  const maxChars = Math.floor(budget * 3);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…（内容过长已按预算截断）";
}

/** 主入口：给定用户消息、文档全文、选区与光标位置，返回预算内最相关的上下文 */
export function retrieve(opts: RetrievalOptions): RetrievedContext {
  const { query, documentText, selection, cursorOffset } = opts;

  // 1. 按内容 hash 取缓存索引，内容变了自动重建
  const docHash = shortHash(documentText);
  let index = getIndex(docHash);
  if (!index) {
    const chunks = chunkMarkdown(documentText);
    index = buildBm25Index(docHash, chunks);
    setIndex(index);
  }

  // 2. 预算分配
  const budget = allocateBudget(opts);

  // 3. BM25 排序
  const ranked = bm25Search(index, query);

  // 4. 强制包含：选区所在块 + 光标邻接块（不计入 Top-K 配额）
  const forcedChunks: DocumentChunk[] = [];
  if (selection.trim()) {
    const selectionStart = documentText.indexOf(selection);
    if (selectionStart >= 0) {
      const chunk = findChunkAtOffset(index.chunks, selectionStart);
      if (chunk) forcedChunks.push(chunk);
    }
  }
  if (cursorOffset !== null && cursorOffset >= 0 && cursorOffset < documentText.length) {
    const chunk = findChunkAtOffset(index.chunks, cursorOffset);
    if (chunk) forcedChunks.push(chunk);
  }
  const forcedIds = new Set(forcedChunks.map((chunk) => chunk.id));

  // 5. 按分数从高到低选块，累加到 retrievedChunks 预算
  const selected: DocumentChunk[] = [];
  let usedTokens = 0;
  // 强制块先放进去（可能使总 token 略超预算，优先保证"必含"）
  for (const chunk of forcedChunks) {
    if (!selected.some((c) => c.id === chunk.id)) {
      selected.push(chunk);
      usedTokens += chunk.tokenCount;
    }
  }
  // 再按相关性从高到低补块，直到预算用完
  for (const { chunk } of ranked) {
    if (forcedIds.has(chunk.id)) continue;
    if (usedTokens + chunk.tokenCount > budget.retrievedChunks) break;
    selected.push(chunk);
    usedTokens += chunk.tokenCount;
  }
  // 超预算时从最低分的块开始丢弃（保留强制块）
  if (usedTokens > budget.retrievedChunks) {
    // selected 前段是强制块，后段是按分数降序加入的；从尾部丢弃非强制块
    for (let i = selected.length - 1; i >= 0 && usedTokens > budget.retrievedChunks; i -= 1) {
      const chunk = selected[i];
      if (forcedIds.has(chunk.id)) continue;
      selected.splice(i, 1);
      usedTokens -= chunk.tokenCount;
    }
  }
  // 按 BM25 分数降序重排（强制块可能分数不高，但契约要求"已按相关性排序"）
  const scoreById = new Map(ranked.map(({ chunk, score }) => [chunk.id, score]));
  selected.sort((a, b) => (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0));

  // 6. 选区与光标上下文（各自独立标注，不混在文档块里）
  const selectionText = truncateToBudget(selection.trim(), budget.selection);
  const cursorChunk =
    cursorOffset !== null && cursorOffset >= 0 && cursorOffset < documentText.length
      ? findChunkAtOffset(index.chunks, cursorOffset)
      : undefined;
  const cursorContext = cursorChunk ? truncateToBudget(cursorChunk.text, budget.cursor) : "";

  return {
    chunks: selected,
    selection: selectionText,
    cursorContext,
    totalTokens: usedTokens + estimateTokens(selectionText) + estimateTokens(cursorContext),
    query,
  };
}
