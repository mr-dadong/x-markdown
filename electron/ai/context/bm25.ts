// BM25 关键词检索（Phase 1，零依赖实现）。
// 分词策略：中文按连续汉字做 bigram 滑动窗口，英文/数字按非字母数字切分并转小写。
// 检索公式：BM25 标准公式，k1 = 1.5、b = 0.75。
import type { DocumentChunk, DocumentIndex } from "./types";

/** BM25 词频饱和参数（越大越不敏感于词频） */
const K1 = 1.5;
/** BM25 文档长度归一化参数（越大越惩罚长文档） */
const B = 0.75;

/** 把文本切成检索词：中文 bigram + 英文单词（小写） */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cjkRe = /[\u4e00-\u9fff]+/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = cjkRe.exec(text)) !== null) {
    // 汉字之间的英文/数字部分按空格与标点切分
    pushEnglishTokens(tokens, text.slice(last, match.index));
    const cjk = match[0];
    if (cjk.length === 1) {
      tokens.push(cjk);
    } else {
      // bigram 滑动窗口：如 "文档切块" → 文档、档切、切块
      for (let i = 0; i < cjk.length - 1; i += 1) {
        tokens.push(cjk.slice(i, i + 2));
      }
    }
    last = match.index + cjk.length;
  }
  pushEnglishTokens(tokens, text.slice(last));
  return tokens;
}

/** 英文/数字部分按非字母数字切分并转小写（统一大小写便于匹配） */
function pushEnglishTokens(tokens: string[], text: string): void {
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word) tokens.push(word);
  }
}

/** 从文档块构建 BM25 倒排索引（含词频表与文档长度统计） */
export function buildBm25Index(docHash: string, chunks: DocumentChunk[]): DocumentIndex {
  const invertedIndex = new Map<string, string[]>();
  const termFrequencies = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();

  for (const chunk of chunks) {
    const terms = tokenize(chunk.text);
    docLengths.set(chunk.id, terms.length);
    const freq = new Map<string, number>();
    for (const term of terms) {
      freq.set(term, (freq.get(term) ?? 0) + 1);
    }
    termFrequencies.set(chunk.id, freq);
    // 倒排：term → 包含该词的块 id 列表
    for (const term of freq.keys()) {
      const list = invertedIndex.get(term);
      if (list) list.push(chunk.id);
      else invertedIndex.set(term, [chunk.id]);
    }
  }

  const totalTerms = [...docLengths.values()].reduce((sum, len) => sum + len, 0);
  const avgDocLength = chunks.length > 0 ? totalTerms / chunks.length : 0;

  return {
    docHash,
    chunks,
    invertedIndex,
    termFrequencies,
    docLengths,
    avgDocLength,
    createdAt: Date.now(),
  };
}

/**
 * BM25 打分并排序，返回按分数从高到低的块列表。
 * score = Σ IDF(qi) · tf·(k1+1) / (tf + k1·(1 - b + b·dl/avgdl))
 */
export function bm25Search(
  index: DocumentIndex,
  query: string,
): Array<{ chunk: DocumentChunk; score: number }> {
  if (index.chunks.length === 0) return [];

  // query 词去重，避免重复词拉高总分数
  const queryTerms = [...new Set(tokenize(query))];
  const totalChunks = index.chunks.length;
  const scores = new Map<string, number>();

  for (const term of queryTerms) {
    const postings = index.invertedIndex.get(term);
    if (!postings || postings.length === 0) continue;

    // IDF：包含该词的块越少，权重越高
    const docFreq = postings.length;
    const idf = Math.log((totalChunks - docFreq + 0.5) / (docFreq + 0.5) + 1);

    for (const chunkId of postings) {
      const tf = index.termFrequencies.get(chunkId)?.get(term) ?? 0;
      if (tf === 0) continue;
      const docLength = index.docLengths.get(chunkId) ?? 0;
      const denominator =
        tf + K1 * (1 - B + B * (docLength / (index.avgDocLength || 1)));
      const termScore = idf * ((tf * (K1 + 1)) / denominator);
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + termScore);
    }
  }

  return index.chunks
    .map((chunk) => ({ chunk, score: scores.get(chunk.id) ?? 0 }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
}
