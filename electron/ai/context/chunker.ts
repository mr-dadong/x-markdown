// Markdown 切块：把整篇文档切成语义完整的小块，供 BM25 检索使用。
// 切块策略（对应方案 3.2）：
//   1. 按标题层级（H1-H4）切分，记录 headingPath 标题路径
//   2. 单个块超过 MAX_CHUNK_TOKENS 时按 代码块 → 段落 → 句子 细分
//   3. 代码块不可分割（整块保留，即使超长）
//   4. 相邻块之间保留 1 句话重叠，避免关键信息恰好被切在边界上
import { createHash } from "node:crypto";
import type { DocumentChunk, DocumentChunkKind } from "./types";

/** 单块最大 token 数（方案 3.2 的 MAX_CHUNK_TOKENS） */
export const MAX_CHUNK_TOKENS = 512;

/** 估算 token 数：中文约 1.5 字/token，英文约 4 字符/token（方案 3.2 Step 3） */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** 计算文本的稳定 hash（SHA-256 前 12 位），用作块 id 与文档缓存键 */
export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** 标题行信息 */
interface HeadingLine {
  /** 标题级别 1-4 */
  level: number;
  /** 标题行文本（不含行尾换行） */
  text: string;
  /** 标题行在文档中的起始字符偏移 */
  start: number;
  /** 标题行结束字符偏移（不含换行符） */
  end: number;
}

/** 一个 section：从某个标题（或文档开头）到下一个标题前的内容 */
interface Section {
  /** 标题路径，如 ["# 用户指南", "## 安装"]；文档开头无标题时为 [] */
  headingPath: string[];
  /** section 起始偏移（含标题行） */
  start: number;
  /** section 结束偏移 */
  end: number;
}

/** 切分时用的原子单元：代码块 / 段落 / 句子 */
interface Unit {
  text: string;
  start: number;
  end: number;
  kind: DocumentChunkKind;
  tokens: number;
}

/** 用正则扫描所有标题行（H1-H4），记录级别与偏移 */
function findHeadings(text: string): HeadingLine[] {
  const headings: HeadingLine[] = [];
  const headingRe = /^#{1,4}\s.*$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(text)) !== null) {
    const line = match[0];
    // 计算 # 个数即标题级别
    const level = line.match(/^#+/)?.[0].length ?? 1;
    headings.push({
      level,
      text: line,
      start: match.index,
      end: match.index + line.length,
    });
  }
  return headings;
}

/** 按标题边界把文档切成 section 列表（含标题行之前的无标题前言） */
function buildSections(text: string, headings: HeadingLine[]): Section[] {
  const sections: Section[] = [];
  const stack: HeadingLine[] = [];
  let sectionStart = 0;
  let sectionHeadingPath: string[] = [];

  for (const heading of headings) {
    // 先结算上一个 section（从 sectionStart 到当前标题之前）
    if (heading.start > sectionStart) {
      sections.push({
        headingPath: [...sectionHeadingPath],
        start: sectionStart,
        end: heading.start,
      });
    }
    // 更新标题栈：遇到同级或更高级标题时弹出栈顶
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
    sectionHeadingPath = stack.map((h) => h.text);
    sectionStart = heading.start;
  }

  // 收尾：最后一个标题之后的剩余内容
  if (sectionStart < text.length) {
    sections.push({
      headingPath: [...sectionHeadingPath],
      start: sectionStart,
      end: text.length,
    });
  }
  return sections;
}

/** 根据块首行推断块类型 */
function detectKind(text: string): DocumentChunkKind {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const line = firstLine.trimStart();
  if (line.startsWith("```")) return "code";
  if (line.startsWith("|")) return "table";
  if (/^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line)) return "list";
  if (/^#{1,4}\s/.test(line)) return "heading";
  return "paragraph";
}

/** 把一段文本切成长度不超过 MAX_CHUNK_TOKENS 的块（必要时按段落/句子细分） */
function splitLongText(
  text: string,
  baseOffset: number,
  headingPath: string[],
): DocumentChunk[] {
  // 先按代码块边界切分：代码块整体保留，不参与句子级细分
  const codeBlockRe = /```[\s\S]*?```/g;
  const parts: Array<{ text: string; start: number; kind: DocumentChunkKind }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), start: cursor, kind: "paragraph" });
    }
    parts.push({ text: match[0], start: match.index, kind: "code" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), start: cursor, kind: "paragraph" });
  }

  // 把非代码部分进一步切成"段落 → 句子"级别的原子单元
  const units: Unit[] = [];
  for (const part of parts) {
    if (part.kind === "code") {
      units.push({
        text: part.text,
        start: baseOffset + part.start,
        end: baseOffset + part.start + part.text.length,
        kind: "code",
        tokens: estimateTokens(part.text),
      });
      continue;
    }
    // 按空行分段落；段落仍超长时按句号分句
    const paragraphs = part.text.split(/\n\s*\n/);
    let paraStart = part.start;
    for (const para of paragraphs) {
      if (!para.trim()) {
        paraStart += para.length + 2;
        continue;
      }
      if (estimateTokens(para) <= MAX_CHUNK_TOKENS) {
        units.push({
          text: para,
          start: baseOffset + paraStart,
          end: baseOffset + paraStart + para.length,
          kind: "paragraph",
          tokens: estimateTokens(para),
        });
      } else {
        // 按句号（中文。！？ 英文.!?）细分，保留 1 句重叠
        const sentences = para.split(/(?<=[。！？.!?])\s*/).filter((s) => s.trim().length > 0);
        let current = "";
        let sentStart = paraStart;
        for (const sentence of sentences) {
          if (current && estimateTokens(current + sentence) > MAX_CHUNK_TOKENS) {
            units.push({
              text: current,
              start: baseOffset + sentStart,
              end: baseOffset + sentStart + current.length,
              kind: "paragraph",
              tokens: estimateTokens(current),
            });
            // 重叠：下一块从当前句开始（不算新 token 预算，因为会被下一块完整计入）
            sentStart += current.length;
            current = sentence;
          } else {
            current += sentence;
          }
        }
        if (current) {
          units.push({
            text: current,
            start: baseOffset + sentStart,
            end: baseOffset + sentStart + current.length,
            kind: "paragraph",
            tokens: estimateTokens(current),
          });
        }
      }
      paraStart += para.length + 2;
    }
  }

  // 把原子单元贪心打包成块，达到 MAX_CHUNK_TOKENS 就切块
  const chunks: DocumentChunk[] = [];
  let currentUnits: Unit[] = [];
  let currentTokens = 0;
  const flush = (): void => {
    if (currentUnits.length === 0) return;
    const start = currentUnits[0].start;
    const end = currentUnits[currentUnits.length - 1].end;
    const chunkText = text.slice(start - baseOffset, end - baseOffset);
    chunks.push({
      id: shortHash(chunkText),
      text: chunkText,
      headingPath: [...headingPath],
      startChar: start,
      endChar: end,
      tokenCount: estimateTokens(chunkText),
      kind: detectKind(chunkText),
    });
    currentUnits = [];
    currentTokens = 0;
  };
  for (const unit of units) {
    if (currentTokens + unit.tokens > MAX_CHUNK_TOKENS && currentUnits.length > 0) {
      // 切块前保留最后一句作为下一块开头（重叠 1 句），代码块除外
      const lastUnit = currentUnits[currentUnits.length - 1];
      flush();
      if (lastUnit.kind !== "code") {
        currentUnits.push(lastUnit);
        currentTokens = lastUnit.tokens;
      }
    }
    currentUnits.push(unit);
    currentTokens += unit.tokens;
  }
  flush();
  return chunks;
}

/** 处理一个 section：够小直接成块，否则细分 */
function chunkSection(text: string, section: Section): DocumentChunk[] {
  const sectionText = text.slice(section.start, section.end).trim();
  if (!sectionText) return [];
  if (estimateTokens(sectionText) <= MAX_CHUNK_TOKENS) {
    return [
      {
        id: shortHash(sectionText),
        text: sectionText,
        headingPath: [...section.headingPath],
        startChar: section.start,
        endChar: section.start + sectionText.length,
        tokenCount: estimateTokens(sectionText),
        kind: detectKind(sectionText),
      },
    ];
  }
  return splitLongText(sectionText, section.start, section.headingPath);
}

/** 主入口：把整篇 Markdown 文档切成文档块列表 */
export function chunkMarkdown(documentText: string): DocumentChunk[] {
  const headings = findHeadings(documentText);
  const sections = buildSections(documentText, headings);
  const chunks: DocumentChunk[] = [];
  for (const section of sections) {
    chunks.push(...chunkSection(documentText, section));
  }
  return chunks;
}
