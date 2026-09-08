import MarkdownIt from 'markdown-it';

/** Agent 使用的顶层 Markdown 块，字符位置只在程序内部使用。 */
export interface DocumentAgentBlock {
  id: string;
  fingerprint: string;
  headingPath: string[];
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'quote' | 'table' | 'html' | 'divider' | 'other';
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
  preview: string;
  headingLevel?: number;
}

interface BlockToken {
  type: string;
  tag: string;
  nesting: number;
  map: [number, number] | null;
}

const parser = new MarkdownIt({ html: true });

/** 生成跨渲染进程和主进程一致的短指纹，用于识别任务快照与语义块。 */
export function fingerprintDocument(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

const blockType = (token: BlockToken): DocumentAgentBlock['type'] => {
  if (token.type === 'heading_open') return 'heading';
  if (token.type === 'paragraph_open') return 'paragraph';
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') return 'list';
  if (token.type === 'fence' || token.type === 'code_block') return 'code';
  if (token.type === 'blockquote_open') return 'quote';
  if (token.type === 'table_open') return 'table';
  if (token.type === 'html_block') return 'html';
  if (token.type === 'hr') return 'divider';
  return 'other';
};

/** 将 Markdown 顶层结构转换为任务内稳定 blockId，模型无需接触字符偏移。 */
export function indexDocumentBlocks(document: string): DocumentAgentBlock[] {
  if (!document) return [];
  const lineOffsets = [0];
  for (let index = 0; index < document.length; index++) {
    if (document[index] === '\n') lineOffsets.push(index + 1);
  }
  const tokens = parser.parse(document, {}) as BlockToken[];
  const blocks: DocumentAgentBlock[] = [];
  const headingPath: string[] = [];
  const duplicateAnchors = new Map<string, number>();
  let depth = 0;
  for (const token of tokens) {
    if (token.nesting < 0) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const topLevel = depth === 0 && token.map;
    if (topLevel) {
      const [startLine, endLine] = token.map!;
      const start = lineOffsets[startLine] ?? document.length;
      const end = lineOffsets[endLine] ?? document.length;
      const text = document.slice(start, end);
      const type = blockType(token);
      const heading = type === 'heading' ? /^ {0,3}(#{1,6})\s+/.exec(text) : null;
      const level = heading?.[1].length;
      // 标题自身使用父级路径；后续内容使用包含当前标题的完整路径。
      const parentPath = level ? headingPath.slice(0, level - 1) : [...headingPath];
      const fingerprint = fingerprintDocument(`${type}\n${parentPath.join('\n')}\n${text}`);
      const duplicate = (duplicateAnchors.get(fingerprint) ?? 0) + 1;
      duplicateAnchors.set(fingerprint, duplicate);
      blocks.push({
        id: `block-${type}-${fingerprint}-${duplicate}`,
        fingerprint,
        headingPath: parentPath,
        type,
        start,
        end,
        startLine: startLine + 1,
        endLine,
        text,
        preview: type === 'code' ? `代码块，共 ${text.length} 字符` : text.trim().replace(/\s+/g, ' ').slice(0, 160),
        ...(level ? { headingLevel: level } : {}),
      });
      if (level) {
        headingPath.length = level - 1;
        headingPath[level - 1] = text.replace(/^ {0,3}#{1,6}\s+/, '').trim();
      }
    }
    if (token.nesting > 0) depth++;
  }
  return blocks;
}
