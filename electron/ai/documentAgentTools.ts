import { createTool } from '@mastra/core/tools';
import type { DocumentAgentEvent, DocumentAgentGoal, DocumentAgentOperation, DocumentAgentStage, DocumentPatch } from '../../src/types/documentAgent';
import { applyDocumentPatches, validateAgentDocument } from '../../src/utils/documentAgent';

/** 每个任务独立保存原文、建议和目标；所有修改仍以原文坐标为准。 */
export function createDocumentAgentTools(document: string, signal: AbortSignal,
  report: (event: DocumentAgentEvent) => void, requestId: string) {
  const patches: DocumentPatch[] = [];
  const goals: DocumentAgentGoal[] = [];
  let calls = 0;
  let reads = 0;
  let revision = 0;
  let completed = false;
  let closingReason = '';
  let finalIssues: string[] = [];
  // 同样的读取或搜索连续多次出现且没有新增修改，说明任务没有推进。
  const repetitions = new Map<string, number>();
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
    return { start: input.start, end: input.end, before: input.before, after: input.after, reason: input.reason, id };
  };
  const commit = (next: DocumentPatch[], changed: DocumentPatch[]): void => {
    if (next.length > 30) throw new Error('单次任务最多 30 处修改');
    // 先检查整批，再一次性更新，任何一处失败都不会留下半批建议。
    applyDocumentPatches(document, next);
    patches.splice(0, patches.length, ...next);
    revision++;
    repetitions.clear();
    changed.forEach(patch => report({ requestId, type: 'patch', patch }));
  };
  const propose = createTool({
    id: 'propose_document_patch',
    description: '提交一处待审阅修改，坐标与 before 必须对应原文。各处不能重叠；修改已有建议使用 revise_document_patch。多处修改优先使用批量工具。',
    inputSchema: { type: 'object', properties: patchProperties, required: requiredPatch, additionalProperties: false },
    execute: async (value: unknown) => execute('edit', '生成局部修改', () => {
      const patch = checkPatch(value, `${requestId}-${patches.length + 1}`);
      commit([...patches, patch], [patch]);
      return { result: { id: patch.id, status: '等待用户审阅，尚未写入文档' }, detail: `已生成第 ${patches.length} 处建议：${patch.reason}` };
    }),
  });
  const batch = createTool({
    id: 'propose_document_patches',
    description: '一次提交多处不重叠修改，减少模型往返。整批验证通过才保留，坐标均基于原文。',
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
      return { result: { issues }, detail: issues.length ? `发现 ${issues.length} 个结构问题` : '标题层级和代码围栏检查通过' };
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
  const finish = createTool({
    id: 'finish_document_task',
    description: '结束任务前必须逐项报告全部目标：done 表示建议已准备好或经核对无需修改，unresolved 表示未解决。detail 说明依据或阻碍，不能把达到预算当作成功。此工具会对最终建议重新运行结构检查，调用后不能再修改。',
    inputSchema: { type: 'object', properties: { outcomes: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['done', 'unresolved'] }, detail: { type: 'string' } }, required: ['id', 'state', 'detail'], additionalProperties: false } } }, required: ['outcomes'], additionalProperties: false },
    execute: async (value: unknown) => execute('check', '核对目标与最终修改', () => {
      const input = value as { outcomes?: Array<{ id: string; state: 'done' | 'unresolved'; detail: string }> };
      if (!goals.length || !input || !Array.isArray(input.outcomes) || input.outcomes.length !== goals.length || new Set(input.outcomes.map(item => item.id)).size !== goals.length) throw new Error('必须逐项报告全部任务目标');
      const next = goals.map(goal => {
        const outcome = input.outcomes!.find(item => item.id === goal.id);
        if (!outcome || !['done', 'unresolved'].includes(outcome.state) || typeof outcome.detail !== 'string' || !outcome.detail.trim() || outcome.detail.length > 2000) throw new Error('目标完成状态或说明无效');
        return { ...goal, ...outcome };
      });
      finalIssues = validateAgentDocument(applyDocumentPatches(document, patches));
      goals.splice(0, goals.length, ...next);
      completed = true;
      report({ requestId, type: 'goals', goals: goals.map(goal => ({ ...goal })) });
      return { result: { issues: finalIssues, goals, closingReason }, detail: `已核对 ${goals.length} 项目标、${patches.length} 处建议；结构问题 ${finalIssues.length} 个` };
    }),
  });
  return {
    tools: { read_document: read, search_document: search, propose_document_patch: propose, propose_document_patches: batch, revise_document_patch: revise, validate_document: validate, plan_document_task: plan, finish_document_task: finish },
    patches, goals, hasRead: () => reads > 0, isComplete: () => completed,
    getIssues: () => finalIssues,
    getOutcome: (): 'complete' | 'incomplete' => closingReason || goals.some(goal => goal.state !== 'done') || finalIssues.length ? 'incomplete' : 'complete',
    close: (reason: string): void => { closingReason = reason; },
    // 主程序直接提供概览，减少一次模型为了读取概览而发起的往返。
    overview: (): string => {
      reads++;
      stage('locate', 'done', `已提供文档概览和开头 ${Math.min(document.length, 12000)} 字符，共 ${document.length} 字符`);
      return JSON.stringify({ length: document.length, headings, start: 0, end: Math.min(document.length, 12000), text: document.slice(0, 12000) });
    },
  };
}
