import { createTool } from '@mastra/core/tools';
import type { DocumentAgentEvent, DocumentPatch } from '../../src/types/documentAgent';
import { applyDocumentPatches, validateAgentDocument } from '../../src/utils/documentAgent';

/** 每个任务单独创建工具闭包，文档和修改不会串到其他请求。 */
export function createDocumentAgentTools(document: string, signal: AbortSignal,
  report: (event: DocumentAgentEvent) => void, requestId: string) {
  const patches: DocumentPatch[] = [];
  let calls = 0;
  let reads = 0;
  const progress = (message: string): void => {
    signal.throwIfAborted();
    if (++calls > 48) throw new Error('已达到 48 次工具调用限制，请缩小任务范围');
    report({ requestId, type: 'progress', message });
  };
  // JSON Schema 由现有 Mastra 处理；执行器仍显式验证参数，不猜测默认值。
  const read = createTool({
    id: 'read_document',
    description: '读取任务原文。start/end 是字符偏移，end 不包含在内。每次最多 12000 字符；首次可用 start=0,end=0 获取长度和标题。所有修改坐标始终基于原文。',
    inputSchema: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } }, required: ['start', 'end'], additionalProperties: false },
    execute: async (value: unknown) => {
      progress('正在读取当前文档');
      if (!value || typeof value !== 'object') throw new Error('读取参数无效');
      const input = value as { start: number; end: number };
      const { start, end } = input;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > document.length || end - start > 12000) throw new Error('读取范围无效，每次最多读取 12000 字符');
      reads++;
      const headings = [...document.matchAll(/^ {0,3}#{1,6}\s+.+$/gm)].slice(0, 100).map(match => ({ text: match[0], start: match.index }));
      return { length: document.length, start, end, text: document.slice(start, end), headings };
    },
  });
  const search = createTool({
    id: 'search_document',
    description: '在任务原文中精确搜索文本。返回最多 30 个命中及字符位置；使用 start 继续搜索。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, start: { type: 'integer' } }, required: ['query', 'start'], additionalProperties: false },
    execute: async (value: unknown) => {
      progress('正在搜索文档内容');
      if (!value || typeof value !== 'object') throw new Error('搜索参数无效');
      const input = value as { query: string; start: number };
      if (typeof input.query !== 'string' || !input.query || !Number.isInteger(input.start) || input.start < 0 || input.start > document.length) throw new Error('搜索文字和起点无效');
      const matches: Array<{ start: number; end: number; context: string }> = [];
      let offset = document.indexOf(input.query, input.start);
      while (offset !== -1 && matches.length < 30) {
        matches.push({ start: offset, end: offset + input.query.length, context: document.slice(Math.max(0, offset - 80), offset + input.query.length + 80) });
        offset = document.indexOf(input.query, offset + input.query.length);
      }
      return { matches, nextStart: offset === -1 ? null : offset };
    },
  });
  const propose = createTool({
    id: 'propose_document_patch',
    description: '提交一处待审阅修改，不会写入编辑器。start/end/before 必须对应任务原文。插入时 start=end,before=""；删除时 after=""。各修改不能重叠，重做同一区域前应重新开始任务。',
    inputSchema: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' }, before: { type: 'string' }, after: { type: 'string' }, reason: { type: 'string' } }, required: ['start', 'end', 'before', 'after', 'reason'], additionalProperties: false },
    execute: async (value: unknown) => {
      progress('正在生成局部修改');
      if (!value || typeof value !== 'object') throw new Error('修改参数无效');
      const input = value as Omit<DocumentPatch, 'id'>;
      if (!reads) throw new Error('必须先调用 read_document 读取原文');
      if (typeof input.before !== 'string' || typeof input.after !== 'string' || typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('修改必须包含原文、新内容和原因');
      if (patches.length >= 30 || input.after.length > 20000) throw new Error('单次任务最多 30 处修改，每处新内容最多 20000 字符');
      const patch: DocumentPatch = { ...input, id: `${requestId}-${patches.length + 1}` };
      applyDocumentPatches(document, [...patches, patch]);
      patches.push(patch);
      report({ requestId, type: 'patch', patch });
      return { id: patch.id, status: '等待用户审阅，尚未写入文档' };
    },
  });
  const validate = createTool({
    id: 'validate_document',
    description: '检查全部建议应用后的 Markdown 标题层级和代码围栏。只检查结构，不验证文章事实。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      progress('正在检查修改后的文档结构');
      return { issues: validateAgentDocument(applyDocumentPatches(document, patches)) };
    },
  });
  return { tools: { read_document: read, search_document: search, propose_document_patch: propose, validate_document: validate }, patches, hasRead: () => reads > 0 };
}
