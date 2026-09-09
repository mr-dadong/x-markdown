import { createTool } from '@mastra/core/tools';
import type { DocumentAgentEvent, DocumentAgentGoal, DocumentAgentOperation, DocumentAgentStage, DocumentPatch } from '../../src/types/documentAgent';
import { applyDocumentPatches, validateAgentDocument } from '../../src/utils/documentAgent';
import { fingerprintDocument, indexDocumentBlocks } from '../../src/utils/documentAgentBlocks';

type DocumentAgentToolErrorCode = 'INVALID_INPUT' | 'BLOCK_NOT_FOUND' | 'TEXT_NOT_FOUND' | 'AMBIGUOUS_TEXT' | 'CODE_BLOCK_PROTECTED' | 'BLOCK_CHANGED' | 'OVERLAPPING_EDIT';

/** 可修正的工具参数错误会结构化返回给模型，不让一次参数失误中断整个任务。 */
class DocumentAgentToolInputError extends Error {
  constructor(public code: DocumentAgentToolErrorCode, message: string, public hint: string) {
    super(message);
  }
}

/** 每个任务独立保存原文、建议和目标；所有修改仍以原文坐标为准。 */
export function createDocumentAgentTools(document: string, signal: AbortSignal,
  report: (event: DocumentAgentEvent) => void, requestId: string) {
  const patches: DocumentPatch[] = [];
  const goals: DocumentAgentGoal[] = [];
  let calls = 0;
  let reads = 0;
  let revision = 0;
  let validatedRevision = -1;
  let completed = false;
  let closingReason = '';
  let finalIssues: string[] = [];
  // 批次状态只由宿主程序和工具更新，模型文字不能推进任务。
  const batches: string[][] = [];
  let batchIndex = 0;
  const completedBlockIds = new Set<string>();
  let checkpointRevision = 0;
  const patchBlockIds = new Map<string, string>();
  const checkpoints: Array<{ revision: number; patchIds: string[]; completedBlockIds: string[]; goals: DocumentAgentGoal[] }> = [];
  const saveCheckpoint = (): void => {
    checkpointRevision++;
    checkpoints.push({ revision: checkpointRevision, patchIds: patches.map(patch => patch.id), completedBlockIds: [...completedBlockIds], goals: goals.map(goal => ({ ...goal })) });
  };
  const documentVersion = fingerprintDocument(document);
  const blocks = indexDocumentBlocks(document);
  const blockMap = new Map(blocks.map(block => [block.id, block]));
  // 同样的读取或搜索连续多次出现且没有新增修改，说明任务没有推进。
  const repetitions = new Map<string, number>();
  const inputFailures = new Map<string, number>();
  const stage = (value: DocumentAgentStage, state: 'running' | 'done', message: string): void => {
    report({ requestId, type: 'stage', stage: value, state, message });
  };
  const begin = (value: DocumentAgentStage, title: string): DocumentAgentOperation => {
    signal.throwIfAborted();
    if (completed) throw new Error('任务已收尾，不能继续执行工具');
    if (++calls > 48) throw new Error('工具调用预算已耗尽，任务未完成；已生成建议保留供查看');
    stage(value, 'running', title);
    const operation: DocumentAgentOperation = { id: `${requestId}-op-${calls}`, stage: value, title, detail: '', state: 'running', startedAt: Date.now() };
    report({ requestId, type: 'operation', operation });
    return operation;
  };
  // 工具结束后更新同一条记录，显示真实结果与耗时；错误不吞掉。
  const execute = async <T>(value: DocumentAgentStage, title: string, action: () => { result: T; detail: string }): Promise<T> => {
    const operation = begin(value, title);
    try {
      const { result, detail } = action();
      report({ requestId, type: 'operation', operation: { ...operation, state: 'done', detail, endedAt: Date.now() } });
      stage(value, 'done', detail);
      return result;
    } catch (error) {
      report({ requestId, type: 'operation', operation: { ...operation, state: 'error', detail: error instanceof Error ? error.message : String(error), endedAt: Date.now() } });
      throw error;
    }
  };
  const checkRepeat = (key: string): void => {
    const count = (repetitions.get(key) ?? 0) + 1;
    repetitions.set(key, count);
    if (count >= 3) throw new Error('检测到相同操作重复 3 次且没有新增修改，任务已停止。请调整目标后重新执行');
  };
  const executeProduction = async <T>(value: DocumentAgentStage, title: string,
    action: () => { result: T; detail: string }): Promise<T | { ok: false; error: { code: DocumentAgentToolErrorCode; message: string; hint: string; attempt: number; retryable: boolean } }> => {
    const operation = begin(value, title);
    try {
      const { result, detail } = action();
      // 定位工具成功不代表修改错误已经解决；只有成功提交修改才重置纠错计数。
      if (value === 'edit') inputFailures.clear();
      report({ requestId, type: 'operation', operation: { ...operation, state: 'done', detail, endedAt: Date.now() } });
      stage(value, 'done', detail);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      report({ requestId, type: 'operation', operation: { ...operation, state: 'error', detail, endedAt: Date.now() } });
      if (!(error instanceof DocumentAgentToolInputError)) throw error;
      const key = `${error.code}:${error.message}`;
      const attempt = (inputFailures.get(key) ?? 0) + 1;
      inputFailures.set(key, attempt);
      const retryable = attempt < 3;
      report({ requestId, type: 'progress', message: retryable
        ? `工具参数需要修正：${error.message}；${error.hint}`
        : `同一工具错误已出现 3 次，停止重试：${error.message}` });
      report({ requestId, type: 'activity', title: retryable ? '正在修正修改参数' : '参数修正未成功', detail: retryable
        ? `${error.message}；${error.hint}；下一轮将重新提交`
        : `${error.message}；已停止重复尝试` });
      if (!retryable) {
        closingReason = `同一工具参数连续失败 3 次：${error.message}`;
        finalIssues = validateAgentDocument(applyDocumentPatches(document, patches));
        goals.forEach(goal => {
          if (goal.state === 'pending') { goal.state = 'unresolved'; goal.detail = closingReason; }
        });
        completed = true;
        report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      }
      return { ok: false, error: { code: error.code, message: error.message, hint: error.hint, attempt, retryable } };
    }
  };
  const getBlock = (id: unknown) => {
    if (typeof id !== 'string') throw new DocumentAgentToolInputError('BLOCK_NOT_FOUND', '文档块不存在', '重新调用 inspect_document 或 find_in_document 获取有效 blockId');
    const block = blockMap.get(id);
    if (!block) throw new DocumentAgentToolInputError('BLOCK_NOT_FOUND', '文档块不存在', '重新调用 inspect_document 或 find_in_document 获取有效 blockId');
    return block;
  };
  const headings = [...document.matchAll(/^ {0,3}#{1,6}\s+.+$/gm)].slice(0, 100).map(match => ({ text: match[0], start: match.index }));
  const read = createTool({
    id: 'read_document',
    description: '读取任务原文，start/end 为字符偏移，end 不含在内。每次最多 12000 字符。概览已包含开头正文，只读取尚未提供的必要区域。',
    inputSchema: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } }, required: ['start', 'end'], additionalProperties: false },
    execute: async (value: unknown) => execute('locate', '读取文档', () => {
      if (!value || typeof value !== 'object') throw new Error('读取参数无效');
      const { start, end } = value as { start: number; end: number };
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > document.length || end - start > 12000) throw new Error('读取范围无效，每次最多读取 12000 字符');
      checkRepeat(`read:${start}:${end}`);
      reads++;
      return { result: { length: document.length, start, end, text: document.slice(start, end), headings }, detail: `已读取字符 ${start}–${end}，共 ${end - start} 字符` };
    }),
  });
  const search = createTool({
    id: 'search_document',
    description: '在任务原文精确搜索，返回最多 30 个命中及位置；用 nextStart 继续分页，避免重复同一查询。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, start: { type: 'integer' } }, required: ['query', 'start'], additionalProperties: false },
    execute: async (value: unknown) => execute('locate', '搜索内容', () => {
      if (!value || typeof value !== 'object') throw new Error('搜索参数无效');
      const input = value as { query: string; start: number };
      if (typeof input.query !== 'string' || !input.query || !Number.isInteger(input.start) || input.start < 0 || input.start > document.length) throw new Error('搜索文字和起点无效');
      checkRepeat(`search:${input.start}:${input.query}`);
      const matches: Array<{ start: number; end: number; context: string }> = [];
      let offset = document.indexOf(input.query, input.start);
      while (offset !== -1 && matches.length < 30) {
        matches.push({ start: offset, end: offset + input.query.length, context: document.slice(Math.max(0, offset - 80), offset + input.query.length + 80) });
        offset = document.indexOf(input.query, offset + input.query.length);
      }
      return { result: { matches, nextStart: offset === -1 ? null : offset }, detail: `“${input.query.slice(0, 80)}”找到 ${matches.length} 处${offset === -1 ? '' : '，还有更多结果'}` };
    }),
  });
  const patchProperties = { start: { type: 'integer' }, end: { type: 'integer' }, before: { type: 'string' }, after: { type: 'string' }, reason: { type: 'string' } } as const;
  const requiredPatch = ['start', 'end', 'before', 'after', 'reason'];
  const checkPatch = (value: unknown, id: string): DocumentPatch => {
    if (!reads) throw new Error('必须先调用 read_document 读取原文');
    if (!value || typeof value !== 'object') throw new Error('修改参数无效');
    const input = value as Omit<DocumentPatch, 'id'>;
    if (typeof input.before !== 'string' || typeof input.after !== 'string' || typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('修改必须包含原文、新内容和原因');
    if (input.after.length > 20000) throw new Error('每处新内容最多 20000 字符');
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end)) throw new Error('修改位置必须是整数');
    // 模型只提供位置提示；原文只出现一次时由程序精确定位，避免模型手算字符偏移造成误报。
    if (input.before && document.slice(input.start, input.end) !== input.before) {
      const first = document.indexOf(input.before);
      if (first < 0) throw new Error('修改原文在文档中不存在，请复制完整原文');
      if (document.indexOf(input.before, first + input.before.length) >= 0) throw new Error('修改原文在文档中出现多次，请提供准确位置');
      return { start: first, end: first + input.before.length, before: input.before, after: input.after, reason: input.reason, id, baseVersion: documentVersion };
    }
    return { start: input.start, end: input.end, before: input.before, after: input.after, reason: input.reason, id, baseVersion: documentVersion };
  };
  const commit = (next: DocumentPatch[], changed: DocumentPatch[]): void => {
    if (next.length > 30) throw new Error('单次任务最多 30 处修改');
    // 先检查整批，再一次性更新，任何一处失败都不会留下半批建议。
    applyDocumentPatches(document, next);
    patches.splice(0, patches.length, ...next);
    revision++;
    validatedRevision = -1;
    repetitions.clear();
    changed.forEach(patch => report({ requestId, type: 'patch', patch }));
  };
  const propose = createTool({
    id: 'propose_document_patch',
    description: '提交一处待审阅修改。before 必须逐字复制原文；start/end 作为位置提示，原文唯一时程序会精确定位。各处不能重叠；修改已有建议使用 revise_document_patch。多处修改优先使用批量工具。',
    inputSchema: { type: 'object', properties: patchProperties, required: requiredPatch, additionalProperties: false },
    execute: async (value: unknown) => execute('edit', '生成局部修改', () => {
      const patch = checkPatch(value, `${requestId}-${patches.length + 1}`);
      commit([...patches, patch], [patch]);
      return { result: { id: patch.id, status: '等待用户审阅，尚未写入文档' }, detail: `已生成第 ${patches.length} 处建议：${patch.reason}` };
    }),
  });
  const batch = createTool({
    id: 'propose_document_patches',
    description: '一次提交多处不重叠修改，减少模型往返。before 必须逐字复制原文，程序根据唯一原文精确定位；整批验证通过才保留。',
    inputSchema: { type: 'object', properties: { patches: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: patchProperties, required: requiredPatch, additionalProperties: false } } }, required: ['patches'], additionalProperties: false },
    execute: async (value: unknown) => execute('edit', '批量生成修改', () => {
      const input = value as { patches?: unknown[] };
      if (!input || !Array.isArray(input.patches) || !input.patches.length || input.patches.length > 30) throw new Error('批量修改需包含 1–30 处建议');
      const added = input.patches.map((item, index) => checkPatch(item, `${requestId}-${patches.length + index + 1}`));
      commit([...patches, ...added], added);
      return { result: { ids: added.map(patch => patch.id) }, detail: `新增 ${added.length} 处建议，共 ${patches.length} 处，尚未写入` };
    }),
  });
  const revise = createTool({
    id: 'revise_document_patch',
    description: '按 id 替换已有建议，原文坐标不变更规则。用于根据检查结果修正建议，不必重启任务。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...patchProperties }, required: ['id', ...requiredPatch], additionalProperties: false },
    execute: async (value: unknown) => execute('edit', '修订已有建议', () => {
      const input = value as { id?: string };
      const index = patches.findIndex(patch => patch.id === input?.id);
      if (index < 0) throw new Error('待修订的建议不存在');
      const patch = checkPatch(value, patches[index].id);
      if (patch.start === patches[index].start && patch.end === patches[index].end && patch.after === patches[index].after) throw new Error('修订没有产生正文变化');
      const next = [...patches];
      next[index] = patch;
      commit(next, [patch]);
      return { result: { id: patch.id }, detail: `已修订第 ${index + 1} 处建议：${patch.reason}` };
    }),
  });
  const validate = createTool({
    id: 'validate_document',
    description: '检查全部建议应用后的标题层级与代码围栏，不验证文章事实。检查发现的问题可用修订工具修复。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => execute('check', '检查文档结构', () => {
      checkRepeat(`validate:${revision}`);
      const issues = validateAgentDocument(applyDocumentPatches(document, patches));
      validatedRevision = revision;
      return { result: { issues }, detail: issues.length ? `发现 ${issues.length} 个结构问题` : '标题层级和代码围栏检查通过' };
    }),
  });
  const inspect = createTool({
    id: 'inspect_document',
    description: '查看当前快照的顶层 Markdown 结构。返回稳定 blockId、类型、行号和预览；后续修改必须使用 blockId。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => executeProduction('locate', '查看文档结构', () => ({
      result: { documentVersion, length: document.length, blocks: blocks.map(block => ({ id: block.id, fingerprint: block.fingerprint, headingPath: block.headingPath, type: block.type, startLine: block.startLine, endLine: block.endLine, preview: block.preview, length: block.text.length, ...(block.headingLevel ? { headingLevel: block.headingLevel } : {}) })) },
      detail: `已识别 ${blocks.length} 个文档块`,
    })),
  });
  const readBlocks = createTool({
    id: 'read_blocks',
    description: '按 blockId 读取准确原文。一次最多读取 20 个块且合计不超过 12000 字符。',
    inputSchema: { type: 'object', properties: { blockIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } } }, required: ['blockIds'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('locate', '读取文档块', () => {
      const input = value as { blockIds?: unknown[] };
      const blockIds = input?.blockIds;
      if (!Array.isArray(blockIds) || !blockIds.length || blockIds.length > 20) throw new DocumentAgentToolInputError('INVALID_INPUT', '请提供 1–20 个文档块', 'blockIds 必须是 inspect_document 返回的字符串数组');
      const selected = blockIds.map(getBlock);
      if (selected.reduce((total, block) => total + block.text.length, 0) > 12000) throw new DocumentAgentToolInputError('INVALID_INPUT', '文档块合计最多读取 12000 字符', '减少本次 blockIds 数量后重试');
      reads++;
      return { result: { blocks: selected.map(block => ({ id: block.id, type: block.type, text: block.text })) }, detail: `已读取 ${selected.length} 个文档块` };
    }),
  });
  const findInDocument = createTool({
    id: 'find_in_document',
    description: '在全文或指定 blockId 中精确查找文字，返回所属文档块和块内第几次出现，不返回字符偏移。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, blockIds: { type: 'array', maxItems: 20, items: { type: 'string' } } }, required: ['query'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('locate', '查找文档内容', () => {
      const input = value as { query?: unknown; blockIds?: unknown[] };
      const query = input?.query;
      if (typeof query !== 'string' || !query) throw new DocumentAgentToolInputError('INVALID_INPUT', '查找文字不能为空', '提供需要精确查找的 query');
      const scope = input.blockIds?.length ? input.blockIds.map(getBlock) : blocks;
      const matches: Array<{ blockId: string; occurrence: number; context: string }> = [];
      for (const block of scope) {
        let offset = block.text.indexOf(query);
        let occurrence = 1;
        while (offset >= 0 && matches.length < 30) {
          matches.push({ blockId: block.id, occurrence, context: block.text.slice(Math.max(0, offset - 60), offset + query.length + 60) });
          offset = block.text.indexOf(query, offset + query.length);
          occurrence++;
        }
      }
      return { result: { matches }, detail: `“${query.slice(0, 80)}”找到 ${matches.length} 处` };
    }),
  });

  type SemanticOperation = {
    type?: 'replace_text' | 'replace_block' | 'set_heading_level' | 'insert_before' | 'insert_after' | 'delete_block' | 'append_document';
    blockId?: string; find?: string; replacement?: string; expected?: string; content?: string;
    occurrence?: number; level?: number; reason?: string;
  };
  // 标题工具只接受真实标题或单行段落，将合法块直接写入模型可见的参数约束。
  const headingBlockIds = blocks.filter(block => block.type === 'heading' || (block.type === 'paragraph' && !block.text.trimEnd().includes('\n'))).map(block => block.id);
  // 普通批次和短文档整次提交共用操作定义，防止两种入口的编辑规则不一致。
  const operationSchema: NonNullable<Parameters<typeof createTool>[0]['inputSchema']> = { type: 'object', properties: {
      type: { type: 'string', enum: ['replace_text', 'replace_block', ...(headingBlockIds.length ? ['set_heading_level'] : []), 'insert_before', 'insert_after', 'delete_block', 'append_document'] },
      blockId: { type: 'string' }, find: { type: 'string' }, replacement: { type: 'string' }, expected: { type: 'string' }, content: { type: 'string' }, occurrence: { type: 'integer' }, level: { type: 'integer', minimum: 1, maximum: 6 }, reason: { type: 'string' },
    }, required: ['type', 'reason'], additionalProperties: false,
    // 按操作类型声明必填参数，让模型生成时就知道 replacement 等字段不可省略。
    anyOf: [
      { properties: { type: { enum: ['replace_text'] } }, required: ['blockId', 'find', 'replacement'] },
      { properties: { type: { enum: ['replace_block'] } }, required: ['blockId', 'expected', 'replacement'] },
      { properties: { type: { enum: ['delete_block'] } }, required: ['blockId', 'expected'] },
      ...(headingBlockIds.length ? [{ properties: { type: { enum: ['set_heading_level'] }, blockId: { enum: headingBlockIds } }, required: ['blockId', 'level'] }] : []),
      { properties: { type: { enum: ['insert_before', 'insert_after'] } }, required: ['blockId', 'content'] },
      { properties: { type: { enum: ['append_document'] } }, required: ['content'] },
    ] };
  // 校验整批修改后再提交，任一操作失败都不会留下半批建议。
  const submitEdits = (value: unknown) => {
      const input = value as { operations?: SemanticOperation[] };
      const operations = input?.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > 5) throw new DocumentAgentToolInputError('INVALID_INPUT', '语义修改需包含 1–5 项操作', '把修改拆成小批次，每次提供不超过 5 项操作');
      const added = operations.map((operation, index): DocumentPatch => {
        const reason = operation.reason;
        if (typeof reason !== 'string' || !reason.trim()) throw new DocumentAgentToolInputError('INVALID_INPUT', `第 ${index + 1} 项修改缺少原因`, '为该操作提供简短 reason');
        const id = `${requestId}-${patches.length + index + 1}`;
        if (operation.type === 'append_document') {
          const content = operation.content;
          if (typeof content !== 'string' || !content) throw new DocumentAgentToolInputError('INVALID_INPUT', '追加内容不能为空', '在 content 中提供完整 Markdown');
          const separator = document && !document.endsWith('\n') ? '\n\n' : document.endsWith('\n\n') || !document ? '' : '\n';
          return { id, baseVersion: documentVersion, start: document.length, end: document.length, before: '', after: separator + content, reason };
        }
        if (batches.length && !batches[batchIndex]?.includes(operation.blockId ?? '')) throw new DocumentAgentToolInputError('INVALID_INPUT', '修改目标不属于当前批次', '只修改当前批次提供的 blockId，其他内容将在后续批次处理');
        const block = getBlock(operation.blockId);
        if (operation.type === 'replace_text') {
          if (block.type === 'code') throw new DocumentAgentToolInputError('CODE_BLOCK_PROTECTED', '代码块不能局部替换', '用户明确要求修改代码时，使用 replace_block 并提供完整 expected');
          const find = operation.find;
          const replacement = operation.replacement;
          if (typeof find !== 'string' || !find || typeof replacement !== 'string') throw new DocumentAgentToolInputError('INVALID_INPUT', 'replace_text 必须提供 find 和 replacement', '从目标块复制准确 find，并提供 replacement');
          const positions: number[] = [];
          let position = block.text.indexOf(find);
          while (position >= 0) { positions.push(position); position = block.text.indexOf(find, position + find.length); }
          if (!positions.length) throw new DocumentAgentToolInputError('TEXT_NOT_FOUND', `${block.id} 中找不到待替换原文`, '调用 read_blocks 重新读取该块后修正 find');
          const selected = operation.occurrence === undefined ? (positions.length === 1 ? positions[0] : -1) : positions[operation.occurrence - 1];
          if (selected === undefined || selected < 0) throw new DocumentAgentToolInputError('AMBIGUOUS_TEXT', `${block.id} 中原文出现多次`, '根据 find_in_document 结果提供从 1 开始的 occurrence');
          return { id, baseVersion: documentVersion, start: block.start + selected, end: block.start + selected + find.length, before: find, after: replacement, reason };
        }
        if (operation.type === 'set_heading_level') {
          const level = operation.level;
          if (!Number.isInteger(level) || level! < 1 || level! > 6) throw new DocumentAgentToolInputError('INVALID_INPUT', '标题级别必须是 1–6', '提供 level 1 到 6');
          const marker = /^(\uFEFF? {0,3})(#{1,6})(?=\s)/.exec(block.text);
          if (marker) return { id, baseVersion: documentVersion, start: block.start + marker[1].length, end: block.start + marker[1].length + marker[2].length, before: marker[2], after: '#'.repeat(level!), reason };
          if (block.type !== 'paragraph' || block.text.trimEnd().includes('\n')) throw new DocumentAgentToolInputError('INVALID_INPUT', '只有标题或单行段落可以调整标题级别', '改用 replace_block，或选择正确的标题/单行段落 blockId');
          const prefix = /^(\uFEFF? {0,3})/.exec(block.text)![1];
          return { id, baseVersion: documentVersion, start: block.start + prefix.length, end: block.start + prefix.length, before: '', after: `${'#'.repeat(level!)} `, reason };
        }
        if (operation.type === 'replace_block' || operation.type === 'delete_block') {
          if (operation.expected !== block.text) throw new DocumentAgentToolInputError('BLOCK_CHANGED', `${block.id} 的 expected 与完整块原文不一致`, '调用 read_blocks 重新读取完整块原文后重试');
          if (operation.type === 'replace_block' && typeof operation.replacement !== 'string') throw new DocumentAgentToolInputError('INVALID_INPUT', 'replace_block 必须提供 replacement', '提供完整的新块内容');
          return { id, baseVersion: documentVersion, start: block.start, end: block.end, before: block.text, after: operation.type === 'delete_block' ? '' : operation.replacement!, reason };
        }
        if (operation.type === 'insert_before' || operation.type === 'insert_after') {
          const insertContent = operation.content;
          if (typeof insertContent !== 'string' || !insertContent) throw new DocumentAgentToolInputError('INVALID_INPUT', '插入内容不能为空', '在 content 中提供完整 Markdown');
          const start = operation.type === 'insert_before' ? block.start : block.end;
          const content = insertContent.trimEnd();
          const after = operation.type === 'insert_before' || start < document.length ? `${content}\n\n` : `${document.endsWith('\n') ? '' : '\n\n'}${content}`;
          return { id, baseVersion: documentVersion, start, end: start, before: '', after, reason };
        }
        throw new DocumentAgentToolInputError('INVALID_INPUT', `第 ${index + 1} 项语义修改类型无效`, '使用工具说明列出的操作类型');
      });
      try {
        commit([...patches, ...added], added);
        added.forEach((patch, index) => patchBlockIds.set(patch.id, operations[index].blockId ?? 'document'));
        saveCheckpoint();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new DocumentAgentToolInputError('OVERLAPPING_EDIT', message, '移除已经成功提交的操作，只保留尚未完成且互不重叠的修改');
      }
      return { result: { ids: added.map(patch => patch.id) }, detail: `已生成 ${added.length} 处精准修改，尚未写入` };
  };
  const semanticEdit = createTool({
    id: 'propose_semantic_edits',
    description: '提交当前一小批语义修改，每次最多 5 项。使用 blockId 定位，不提供字符坐标。replace_text 精确替换块内文字；set_heading_level 调整标题或将单行段落设为标题；replace_block 必须提供完整 expected 和 replacement，delete_block 必须提供完整 expected；insert_before/insert_after/append_document 插入完整 Markdown。还有内容时分多轮提交，不要在调用工具前输出长篇分析。',
    inputSchema: { type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 5, items: operationSchema } }, required: ['operations'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('edit', '生成精准修改', () => submitEdits(value)),
  });
  const completeBatch = createTool({
    id: 'complete_document_batch',
    description: '确认当前批次已经核对完毕。reviewedBlockIds 必须完整包含当前批次全部 blockId；即使无需修改也必须调用。summary 简短说明本批结果。',
    inputSchema: { type: 'object', properties: {
      reviewedBlockIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      summary: { type: 'string' },
    }, required: ['reviewedBlockIds', 'summary'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('edit', '完成当前文档批次', () => {
      const input = value as { reviewedBlockIds?: unknown[]; summary?: unknown };
      const current = batches[batchIndex] ?? [];
      if (!Array.isArray(input.reviewedBlockIds) || input.reviewedBlockIds.length !== current.length ||
          !current.every(id => input.reviewedBlockIds!.includes(id))) throw new DocumentAgentToolInputError('INVALID_INPUT', '必须核对当前批次的全部文档块', '按当前批次原样提供全部 reviewedBlockIds');
      if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 500) throw new DocumentAgentToolInputError('INVALID_INPUT', '批次结论无效', '提供不超过 500 字的非空 summary');
      current.forEach(id => completedBlockIds.add(id));
      batchIndex++;
      saveCheckpoint();
      const next = batches[batchIndex] ?? [];
      return { result: { goals: goals.map(goal => ({ id: goal.id, title: goal.title })), nextAction: batchIndex >= batches.length ? 'finish_document_task' : 'review_next_batch', completedBlockIds: [...completedBlockIds], nextBatch: next.map(id => {
        const block = blockMap.get(id)!;
        return { id: block.id, type: block.type, headingPath: block.headingPath, text: block.text };
      }) }, detail: `已核对 ${completedBlockIds.size} 个文档块，剩余 ${batches.slice(batchIndex).flat().length} 个` };
    }),
  });
  const plan = createTool({
    id: 'plan_document_task',
    description: '首先把用户请求拆成 1–6 个可核对目标，不增加用户未要求的工作。目标一经建立不得删除或改写。',
    inputSchema: { type: 'object', properties: { goals: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } } }, required: ['goals'], additionalProperties: false },
    execute: async (value: unknown) => execute('understand', '明确任务目标', () => {
      const input = value as { goals?: unknown[] };
      if (goals.length) throw new Error('任务目标已经建立');
      if (!input || !Array.isArray(input.goals) || !input.goals.length || input.goals.length > 6 || !input.goals.every(goal => typeof goal === 'string' && goal.trim().length > 0 && goal.length <= 300)) throw new Error('请提供 1–6 个简短目标');
      goals.push(...(input.goals as string[]).map((title, index) => ({ id: `goal-${index + 1}`, title, state: 'pending' as const, detail: '' })));
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      return { result: { goals }, detail: `已明确 ${goals.length} 项目标` };
    }),
  });
  // 收尾元数据先校验，防止修改成功后才发现目标列表缺失。
  const checkOutcomes = (input: { outcomes?: Array<{ id: string; state: 'done' | 'unresolved'; detail: string }> }) => {
      if (!goals.length || !input || !Array.isArray(input.outcomes) || input.outcomes.length !== goals.length || new Set(input.outcomes.map(item => item.id)).size !== goals.length) throw new DocumentAgentToolInputError('INVALID_INPUT', '必须逐项报告全部任务目标', `必须提供 ${goals.length} 项 outcomes，目标列表：${JSON.stringify(goals.map(goal => ({ id: goal.id, title: goal.title })))}；每项包含原始 id、state（done 或 unresolved）和中文 detail，不能把文档条目拆成任务目标`);
      const next = goals.map(goal => {
        const outcome = input.outcomes!.find(item => item.id === goal.id);
        if (!outcome || !['done', 'unresolved'].includes(outcome.state) || typeof outcome.detail !== 'string' || !outcome.detail.trim() || outcome.detail.length > 2000) throw new DocumentAgentToolInputError('INVALID_INPUT', '目标完成状态或说明无效', `目标 id 必须原样使用 ${goal.id}，state 使用 done 或 unresolved，并提供非空中文 detail`);
        return { ...goal, ...outcome };
      });
    return next;
  };
  const outcomesSchema = { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['done', 'unresolved'] }, detail: { type: 'string' } }, required: ['id', 'state', 'detail'], additionalProperties: false } } satisfies NonNullable<Parameters<typeof createTool>[0]['inputSchema']>;
  const finish = createTool({
    id: 'finish_document_task',
    description: '结束任务前必须逐项报告全部目标：done 表示建议已准备好或经核对无需修改，unresolved 表示未解决。detail 说明依据或阻碍，不能把达到预算当作成功。此工具会对最终建议重新运行结构检查，调用后不能再修改。',
    inputSchema: { type: 'object', properties: { outcomes: outcomesSchema }, required: ['outcomes'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('check', '核对目标与最终修改', () => {
      const input = value as { outcomes?: Array<{ id: string; state: 'done' | 'unresolved'; detail: string }> };
      // 不允许模型跳过尚未核对的批次就声明任务完成。
      if (batchIndex < batches.length) throw new DocumentAgentToolInputError('INVALID_INPUT', '还有文档批次未核对', '先调用 complete_document_batch 核对全部批次，再提交目标结论');
      const next = checkOutcomes(input);
      finalIssues = validateAgentDocument(applyDocumentPatches(document, patches));
      validatedRevision = revision;
      goals.splice(0, goals.length, ...next);
      completed = true;
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      return { result: { issues: finalIssues, goals, closingReason }, detail: `已核对 ${goals.length} 项目标、${patches.length} 处建议；结构问题 ${finalIssues.length} 个` };
    }),
  });
  // 短文档把编辑、批次确认和目标结论放在同一次模型回复中，省去两次网络往返。
  const submitReview = createTool({
    id: 'submit_document_review',
    description: '短文档优先使用：一次提交本次剩余修改和最终结论。operations 使用语义修改规则，每次最多 5 项，无需修改时传 []；reviewedBlockIds 完整包含当前批次全部块；outcomes 按已提供的目标列表原样填写 id、state 和中文 detail。程序自动检查结构并结束任务，不必再调用确认批次或收尾工具。',
    inputSchema: { type: 'object', properties: {
      operations: { type: 'array', minItems: 0, maxItems: 5, items: operationSchema },
      reviewedBlockIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      outcomes: outcomesSchema,
    }, required: ['operations', 'reviewedBlockIds', 'outcomes'], additionalProperties: false },
    execute: async (value: unknown) => executeProduction('check', '提交修改与核对结论', () => {
      const input = value as { operations?: SemanticOperation[]; reviewedBlockIds?: string[]; outcomes?: Array<{ id: string; state: 'done' | 'unresolved'; detail: string }> };
      if (batches.length > 1) throw new DocumentAgentToolInputError('INVALID_INPUT', '此工具仅用于单批短文档', '多批文档按批次提交并核对');
      const current = batches[batchIndex] ?? [];
      if (!Array.isArray(input?.reviewedBlockIds) || input.reviewedBlockIds.length !== current.length || !current.every(id => input.reviewedBlockIds!.includes(id))) throw new DocumentAgentToolInputError('INVALID_INPUT', '必须核对当前批次的全部文档块', `reviewedBlockIds 必须为 ${JSON.stringify(current)}`);
      const next = checkOutcomes(input);
      if (!Array.isArray(input.operations) || input.operations.length > 5) throw new DocumentAgentToolInputError('INVALID_INPUT', '修改列表无效', 'operations 提供 0–5 项语义修改');
      if (input.operations.length) submitEdits(input);
      current.forEach(id => completedBlockIds.add(id));
      batchIndex = batches.length;
      finalIssues = validateAgentDocument(applyDocumentPatches(document, patches));
      validatedRevision = revision;
      goals.splice(0, goals.length, ...next);
      completed = true;
      saveCheckpoint();
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      return { result: { issues: finalIssues, goals }, detail: `已核对全文并生成 ${patches.length} 处建议；结构问题 ${finalIssues.length} 个` };
    }),
  });
  return {
    tools: { submit_document_review: submitReview, inspect_document: inspect, read_blocks: readBlocks, find_in_document: findInDocument, propose_semantic_edits: semanticEdit, complete_document_batch: completeBatch, validate_document: validate, finish_document_task: finish },
    // 旧坐标工具不再暴露给生产 Agent，仅供兼容性测试确认旧审阅契约没有被破坏。
    legacyTools: { read_document: read, search_document: search, propose_document_patch: propose, propose_document_patches: batch, revise_document_patch: revise, plan_document_task: plan },
    patches, goals, hasRead: () => reads > 0, isComplete: () => completed,
    hasPatches: () => patches.length > 0,
    needsValidation: () => patches.length > 0 && validatedRevision !== revision,
    initializeBatches: (blockIds: string[], size = 5): void => {
      if (batches.length) throw new Error('文档批次已经初始化');
      for (let index = 0; index < blockIds.length; index += size) batches.push(blockIds.slice(index, index + size));
    },
    currentBatchIds: () => [...(batches[batchIndex] ?? [])],
    currentBatchNumber: () => batches.length ? Math.min(batchIndex + 1, batches.length) : 0,
    totalBatches: () => batches.length,
    completedBlockCount: () => completedBlockIds.size,
    remainingBlockCount: () => batches.slice(batchIndex).flat().length,
    allBatchesComplete: () => batchIndex >= batches.length,
    needsBatchCompletion: () => batches.length > 0 && batchIndex < batches.length,
    checkpointRevision: () => checkpointRevision,
    latestCheckpoint: () => checkpoints.at(-1),
    patchSummary: () => patches.map(patch => ({ id: patch.id, blockId: patchBlockIds.get(patch.id) ?? 'document', reason: patch.reason })),
    batchContext: (): string => JSON.stringify((batches[batchIndex] ?? []).map(id => {
      const block = blockMap.get(id)!;
      return { id: block.id, type: block.type, headingPath: block.headingPath, startLine: block.startLine, endLine: block.endLine, canSetHeadingLevel: headingBlockIds.includes(block.id), text: block.text };
    })),
    getIssues: () => finalIssues,
    getClosingReason: () => closingReason,
    getOutcome: (): 'complete' | 'incomplete' => closingReason || goals.some(goal => goal.state !== 'done') || finalIssues.length ? 'incomplete' : 'complete',
    // 用户请求本身就是最准确的任务目标，生产流程无需再让模型拆分一次。
    initializeGoal: (title: string): void => {
      if (goals.length) throw new Error('任务目标已经建立');
      goals.push({ id: 'goal-1', title, state: 'pending', detail: '' });
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
    },
    close: (reason: string): void => { closingReason = reason; },
    // 达到预算时由程序确定性收尾，避免模型继续调用已经停用的旧工具而直接报错。
    finishAtBudget: (reason: string): void => {
      closingReason = reason;
      finalIssues = validateAgentDocument(applyDocumentPatches(document, patches));
      goals.forEach(goal => {
        if (goal.state === 'pending') {
          goal.state = 'unresolved';
          goal.detail = reason;
        }
      });
      completed = true;
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      stage('check', 'done', `执行预算已结束，保留 ${patches.length} 处建议供审阅`);
    },
    // 主程序直接提供概览，减少一次模型为了读取概览而发起的往返。
    overview: (): string => {
      reads++;
      stage('locate', 'done', `已提供文档概览和开头 ${Math.min(document.length, 12000)} 字符，共 ${document.length} 字符`);
      return JSON.stringify({ documentVersion, length: document.length, blocks: blocks.map(block => ({ id: block.id, fingerprint: block.fingerprint, headingPath: block.headingPath, type: block.type, startLine: block.startLine, endLine: block.endLine, preview: block.preview, ...(block.headingLevel ? { headingLevel: block.headingLevel } : {}) })), start: 0, end: Math.min(document.length, 12000), text: document.slice(0, 12000) });
    },
  };
}
