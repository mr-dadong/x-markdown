// 文档索引的内存缓存：按文档内容 hash 缓存切块 + BM25 索引。
// 内容变了（hash 变了）自然失效，无需手动清理。
import type { DocumentIndex } from "./types";

/** 缓存的最大文档数，防止长时间使用后内存无限增长（超出丢最旧的） */
const MAX_ENTRIES = 20;

const cache = new Map<string, DocumentIndex>();

/** 按文档 hash 取索引；没有命中返回 undefined */
export function getIndex(docHash: string): DocumentIndex | undefined {
  return cache.get(docHash);
}

/** 存入索引；超过上限时淘汰最早放入的一条 */
export function setIndex(index: DocumentIndex): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(index.docHash, index);
}
