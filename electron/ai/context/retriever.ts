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
  // 用同一套 token 估算寻找可容纳的前缀，中文不能按英文字符比例截断。
  const suffix = "\n…（内容过长已按预算截断）";
  if (budget < estimateTokens(suffix)) return "";
  let start = 0;
  let end = text.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    if (estimateTokens(text.slice(0, middle) + suffix) <= budget) start = middle;
    else end = middle - 1;
  }
  return text.slice(0, start) + suffix;
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

  // 短文档直接给模型原文，是否读到正文不再取决于问题中的关键词。
  const fullDocumentTokens = estimateTokens(documentText);
  if (documentText.trim() && fullDocumentTokens <= budget.retrievedChunks) {
    const selectionText = truncateToBudget(selection.trim(), budget.selection);
    return {
      fullDocument: documentText,
      chunks: [],
      selection: selectionText,
      cursorContext: "",
      totalTokens: fullDocumentTokens + estimateTokens(selectionText),
      query,
    };
  }

  // 长文档先给标题目录，模型可以区分全文结构和实际读取到的正文片段。
  const headings = [...new Set(index.chunks.flatMap((chunk) => chunk.headingPath))];
  const documentOutline = truncateToBudget(headings.join("\n"), Math.min(400, budget.retrievedChunks * 0.2));
  const chunkBudget = budget.retrievedChunks - estimateTokens(documentOutline);

  // 3. BM25 排序
  const ranked = bm25Search(index, query);
  // 全局问题按原文顺序取分布在全文中的片段，避免只看到关键词集中的章节。
  const isOverview = /总结|概括|概述|全文|整篇|文档.*(?:讲|内容|主题)|summary|summarize|overview/i.test(query);
  const sampleCount = Math.min(8, index.chunks.length);
  const overviewChunks = isOverview ? Array.from({ length: sampleCount }, (_, position) => {
    const indexPosition = sampleCount === 1 ? 0 : Math.round(position * (index.chunks.length - 1) / (sampleCount - 1));
    const chunk = index.chunks[indexPosition];
    // 每个样本分配相同预算，让文档末尾也有机会进入模型上下文。
    const text = truncateToBudget(chunk.text, chunkBudget / sampleCount);
    return { chunk: { ...chunk, text, tokenCount: estimateTokens(text) }, score: 0 };
  }).filter(({ chunk }) => chunk.text.trim()) : [];
  const candidates = isOverview ? overviewChunks : ranked;

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
  for (const { chunk } of candidates) {
    if (forcedIds.has(chunk.id)) continue;
    if (usedTokens + chunk.tokenCount > chunkBudget) continue;
    selected.push(chunk);
    usedTokens += chunk.tokenCount;
  }
  // 超预算时从最低分的块开始丢弃（保留强制块）
  if (usedTokens > chunkBudget) {
    // selected 前段是强制块，后段是按分数降序加入的；从尾部丢弃非强制块
    for (let i = selected.length - 1; i >= 0 && usedTokens > chunkBudget; i -= 1) {
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
    documentOutline,
    chunks: selected,
    selection: selectionText,
    cursorContext,
    totalTokens: usedTokens + estimateTokens(documentOutline) + estimateTokens(selectionText) + estimateTokens(cursorContext),
    query,
  };
}
