import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDocumentPatches } from '../utils/documentAgent';
import { describe, test } from 'node:test';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createAgentDeadline, extractDraftAfter, getDocumentAgentExecutionProfile, getDocumentAgentProviderOptions, runDocumentAgent, selectDocumentAgentBlocks } from '../../electron/ai/documentAgentRun';
import type { DocumentAgentEvent } from '../types/documentAgent';
import { fingerprintDocument, indexDocumentBlocks } from '../utils/documentAgentBlocks';

// 模型替身运行真正的 Mastra 循环，验证修改、收尾和最终事件。
const request = { requestId: 'run', instruction: '统一名称', document: '旧名', documentVersion: fingerprintDocument('旧名'), selection: '' };
const textBlockId = indexDocumentBlocks(request.document)[0].id;
const resultStream = (toolName?: string, input?: unknown) => new ReadableStream({ start(controller) {
  controller.enqueue({ type: 'stream-start', warnings: [] });
  if (toolName) controller.enqueue({ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) });
  else {
    controller.enqueue({ type: 'text-start', id: 'text' });
    controller.enqueue({ type: 'text-delta', id: 'text', delta: '请审阅修改' });
    controller.enqueue({ type: 'text-end', id: 'text' });
  }
  controller.enqueue({ type: 'finish', finishReason: toolName ? 'tool-calls' : 'stop', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
  controller.close();
} });
// 模拟厂商逐段返回工具参数，验证正文预览不是等工具完成后才出现。
const streamedToolCall = (toolName: string, input: string) => new ReadableStream({ start(controller) {
  const id = crypto.randomUUID();
  controller.enqueue({ type: 'stream-start', warnings: [] });
  controller.enqueue({ type: 'tool-input-start', id, toolName });
  const middle = Math.floor(input.length / 2);
  controller.enqueue({ type: 'tool-input-delta', id, delta: input.slice(0, middle) });
  controller.enqueue({ type: 'tool-input-delta', id, delta: input.slice(middle) });
  controller.enqueue({ type: 'tool-input-end', id });
  controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
  controller.close();
} });
// 输出被截断时不附带工具调用，用于验证宿主程序的有限恢复策略。
const lengthLimitedStream = () => new ReadableStream({ start(controller) {
  controller.enqueue({ type: 'stream-start', warnings: [] });
  controller.enqueue({ type: 'reasoning-start', id: 'reasoning' });
  controller.enqueue({ type: 'reasoning-delta', id: 'reasoning', delta: '尚未完成的分析' });
  controller.enqueue({ type: 'reasoning-end', id: 'reasoning' });
  controller.enqueue({ type: 'finish', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 1000, totalTokens: 1010 } });
  controller.close();
} });
const otherFinishStream = () => new ReadableStream({ start(controller) {
  controller.enqueue({ type: 'stream-start', warnings: [] });
  controller.enqueue({ type: 'finish', finishReason: 'other', usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } });
  controller.close();
} });
const outcomes = { outcomes: [{ id: 'goal-1', state: 'done', detail: '名称已统一为 XMD，等待审阅' }] };

describe('Agent 分阶段执行', () => {
  test('空文档不提供无效读取工具，并能直接生成插入建议', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const emptyRequest = { ...request, instruction: '写一个冒泡排序的 Python 代码', document: '', documentVersion: fingerprintDocument('') };
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (current === 0) {
        assert.equal(options.tools?.some(tool => tool.name === 'read_blocks'), false);
        assert.equal(options.tools?.some(tool => tool.name === 'find_in_document'), false);
      }
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'append_document', content: '```python\ndef bubble_sort():\n    pass\n```', reason: '在空文档中写入代码' }] })
        : current === 1 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'done', detail: '代码建议已生成' }] }) : resultStream() };
    } });
    await runDocumentAgent(emptyRequest, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'patch' && event.patch.start === 0 && event.patch.end === 0));
  });
  test('工具参数流可以提取尚未结束的正文预览', () => {
    assert.equal(extractDraftAfter('{"start":0,"after":"```python\\ndef sort():\\n    return \\u4e2d'), '```python\ndef sort():\n    return 中');
  });
  test('修改工具逐段生成时发送正文预览事件', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const input = JSON.stringify({ operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: '```python\ndef sort():\n    return []\n```', reason: '改为示例代码' }] });
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      return { stream: current === 0 ? streamedToolCall('propose_semantic_edits', input)
        : current === 1 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '已完成修改' })
        : current === 2 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'done', detail: '代码建议已生成' }] }) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'draft' && event.text.includes('def sort')));
  });
  test('模型把工具调用写成正文时不转发协议原文', async () => {
    // 个别厂商会把工具调用写成 XML 正文；这种调用不会执行，界面也不应收到原文。
    const rawToolText = ['<tool_call>', '<function=complete_document_batch>', '<parameter=summary>已核对</parameter>', '</function>', '</tool_call>'].join('');
    const rawToolTextStream = () => new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'text' });
      controller.enqueue({ type: 'text-delta', id: 'text', delta: rawToolText });
      controller.enqueue({ type: 'text-end', id: 'text' });
      controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
      controller.close();
    } });
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      return { stream: current === 0 ? rawToolTextStream()
        : current === 1 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '名称已核对' })
        : current === 2 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(events.some(event => event.type === 'text' && event.text.includes('tool_call')), false);
    assert.ok(events.some(event => event.type === 'progress' && event.message.includes('该调用不会执行')));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
  });
  test('用户目标、批量修改、最终核对和说明完整结束', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (!current) {
        assert.deepEqual(options.toolChoice, { type: 'required' });
        assert.ok(JSON.stringify(options.prompt).includes('旧名'));
        assert.equal(options.tools?.some(tool => tool.name === 'read_blocks'), false);
        assert.equal(options.tools?.some(tool => tool.name === 'find_in_document'), false);
      }
      if (current === 2) assert.deepEqual(options.tools?.map(tool => tool.name), ['finish_document_task']);
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 1 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '名称已核对' })
        : current === 2 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 3);
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
    assert.ok(events.some(event => event.type === 'stage' && event.stage === 'check' && event.state === 'done'));
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
  });
  // 复现截图中的短文档：六个块不再拆批，也不强制单独校验和生成总结。
  test('短文档六个块只需修改、批次确认和目标收尾三轮', async () => {
    const document = Array.from({ length: 6 }, (_, index) => `段落 ${index + 1}`).join('\n\n');
    const blocks = indexDocumentBlocks(document);
    const events: DocumentAgentEvent[] = [];
    let step = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (current > 2) throw new Error('收尾后不应再次请求模型');
      if (current === 2) assert.ok(options.tools?.some(tool => tool.name === 'finish_document_task'));
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: blocks[0].id, find: '段落 1', replacement: '第一段', reason: '统一表达' }] })
        : current === 1 ? resultStream('complete_document_batch', { reviewedBlockIds: blocks.map(block => block.id), summary: '全部内容已核对' })
        : resultStream('finish_document_task', outcomes) };
    } });
    await runDocumentAgent({ ...request, document, documentVersion: fingerprintDocument(document) }, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 3);
    assert.ok(events.some(event => event.type === 'batch' && event.totalBatches === 1));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
  });
  // 使用用户的真实 TXT 复现：模型只能从实际收到的上下文获取目标，不能由测试暗中提供 ID。
  test('真实 TXT 的版本行可局部修改，收尾目标来自模型输入', async () => {
    const document = readFileSync(new URL('./fixtures/document-agent-plain-text.txt', import.meta.url), 'utf8');
    const blocks = indexDocumentBlocks(document);
    const events: DocumentAgentEvent[] = [];
    const instruction = '检查标题层级和文档结构，只修改必要位置，保留代码块。';
    let step = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      const prompt = options.prompt.map(message => typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')).join('\n');
      const goalLine = prompt.split('\n').find(line => line.startsWith('任务目标列表（收尾时原样使用 id）：'));
      assert.ok(goalLine, '模型必须收到真实的目标列表');
      const goals = JSON.parse(goalLine.slice(goalLine.indexOf('：') + 1)) as Array<{ id: string; title: string }>;
      assert.equal(goals.length, 1);
      assert.equal(goals[0].title, instruction);
      if (current === 0) {
        const operations = blocks.flatMap(block => [...block.text.matchAll(/^(?:v\.[^\r\n]*版本：|讨论内容：)\r?\n/gm)].map(match => ({ type: 'replace_text', blockId: block.id, find: match[0], replacement: `## ${match[0].trimEnd()}\n\n`, reason: '将分节标题独立为二级标题，保留版本号和正文' })));
        assert.equal(operations.length, 4);
        return { stream: resultStream('submit_document_review', { operations, reviewedBlockIds: blocks.map(block => block.id), outcomes: goals.map(goal => ({ id: goal.id, state: 'done', detail: '已生成四处分节标题建议，保留原始版本号和正文，等待审阅' })) }) };
      }
      throw new Error('短文档合并提交成功后不应再次请求模型');
    } });
    await runDocumentAgent({ ...request, instruction, document, documentVersion: fingerprintDocument(document) }, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 1);
    const patches = events.flatMap(event => event.type === 'patch' ? [event.patch] : []);
    assert.equal(patches.length, 4);
    assert.ok(events.some(event => event.type === 'batch' && event.completedBlocks === blocks.length && event.remainingBlocks === 0));
    assert.equal(applyDocumentPatches(document, patches), document.replace(/^(v\.[^\r\n]*版本：|讨论内容：)\r?\n/gm, '## $1\n\n'));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
    assert.equal(events.some(event => event.type === 'operation' && event.operation.state === 'error'), false);
  });
  test('模型跳过目标核对直接结束时不能发送成功', async () => {
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => ({ stream: resultStream() }) });
    await assert.rejects(runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) }), /没有调用工具推进任务/);
    assert.equal(events.some(event => event.type === 'done'), false);
  });
  test('接近轮次预算时强制收尾，保留不完整结果而非成功', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      step++;
      return { stream: resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] }) };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, agentMaxSteps: 1, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 1);
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'incomplete'));
  });
  test('工具验证失败后允许模型按错误原因修正，最终只保留有效修改', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '错误', replacement: 'XMD', reason: '统一名称' }] })
        : current === 1 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 2 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '名称已核对' })
        : current === 3 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'progress' && event.message.includes('找不到待替换原文')));
    assert.ok(events.some(event => event.type === 'activity' && event.title === '正在修正修改参数'));
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
    assert.ok(events.some(event => event.type === 'done'));
  });
  test('设置中的单次输出预算原样传给模型，不再按文档大小压低', async () => {
    let step = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      assert.equal(options.maxOutputTokens, 8192);
      const current = step++;
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 1 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '名称已核对' })
        : current === 2 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 8192, temperature: 0, controller: new AbortController(), report: () => {} });
    assert.equal(step, 3);
  });
  test('首次达到输出限制后缩短输出继续，并完成后续工具调用', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (current === 1) assert.ok(JSON.stringify(options.prompt).includes('上一轮因输出长度限制中断'));
      return { stream: current === 0 ? lengthLimitedStream()
        : current === 1 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 2 ? resultStream('complete_document_batch', { reviewedBlockIds: [textBlockId], summary: '名称已核对' })
        : current === 3 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, agentMaxSteps: 6, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'progress' && event.message.includes('达到单次输出限制')));
    assert.ok(events.some(event => event.type === 'done'));
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
  });
  test('连续两次达到输出限制后明确终止，不会无限重试', async () => {
    let requests = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      requests++;
      return { stream: lengthLimitedStream() };
    } });
    await assert.rejects(runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, agentMaxSteps: 6, controller: new AbortController(), report: () => {} }), /连续 2 次达到单次输出限制/);
    assert.equal(requests, 2);
  });
  test('未知结束原因原样显示，不使用模糊限制提示', async () => {
    const model = new MastraLanguageModelV2Mock({ doStream: async () => ({ stream: otherFinishStream() }) });
    await assert.rejects(runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: () => {} }), /模型结束原因：other/);
  });
  test('20 个无需修改的块按 4 个批次核对完成，不会因没有 Patch 停滞', async () => {
    const document = Array.from({ length: 20 }, (_, index) => `段落 ${index + 1} ${"正文".repeat(600)}`).join('\n\n');
    const blocks = indexDocumentBlocks(document);
    const batchIds = Array.from({ length: 4 }, (_, index) => blocks.slice(index * 5, index * 5 + 5).map(block => block.id));
    const events: DocumentAgentEvent[] = [];
    let step = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      return { stream: current < 4
        ? resultStream('complete_document_batch', { reviewedBlockIds: batchIds[current], summary: `第 ${current + 1} 批无需修改` })
        : current === 4 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'done', detail: '全文已核对，无需修改' }] }) : resultStream() };
    } });
    const batchRequest = { ...request, instruction: '检查全文表达', document, documentVersion: fingerprintDocument(document) };
    await runDocumentAgent(batchRequest, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, agentMaxSteps: 8, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 5);
    assert.ok(events.some(event => event.type === 'batch' && event.completedBlocks === 20 && event.remainingBlocks === 0));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
  });
  test('后续批次请求失败时保留前两批有效 Patch 并返回可审阅的未完成结果', async () => {
    const document = Array.from({ length: 11 }, (_, index) => `段落 ${index + 1} ${"正文".repeat(600)}`).join('\n\n');
    const blocks = indexDocumentBlocks(document);
    const batches = [blocks.slice(0, 5), blocks.slice(5, 10), blocks.slice(10)];
    const events: DocumentAgentEvent[] = [];
    let step = 0;
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      if (current === 4) throw new Error('第三批网络失败');
      if (current === 0 || current === 2) {
        const block = batches[current / 2][0];
        return { stream: resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: block.id, find: block.text.trim(), replacement: `${block.text.trim()}（已核对）`, reason: '补充核对标记' }] }) };
      }
      const batch = batches[(current - 1) / 2];
      return { stream: resultStream('complete_document_batch', { reviewedBlockIds: batch.map(block => block.id), summary: '本批已处理' }) };
    } });
    const batchRequest = { ...request, instruction: '检查全文表达', document, documentVersion: fingerprintDocument(document) };
    await runDocumentAgent(batchRequest, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, agentMaxSteps: 10, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(events.filter(event => event.type === 'patch').length, 2);
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'incomplete' && event.message?.includes('第三批网络失败')));
  });

  // 短格式任务关闭已知 MiMo 模型的深度思考，不改变其他模型和复杂任务。
  test('MiMo 短格式任务显式关闭深度思考，复杂任务保留原配置', () => {
    const simple = { ...request, instruction: '检查标题层级和文档结构' };
    assert.deepEqual(getDocumentAgentProviderOptions(simple, { id: 'custom/mimo-v2.5-pro' }), { custom: { thinking: { type: 'disabled' } } });
    assert.equal(getDocumentAgentProviderOptions({ ...simple, instruction: '深度分析文章结构' }, { id: 'custom/mimo-v2.5-pro' }), undefined);
    assert.equal(getDocumentAgentProviderOptions({ ...simple, document: '字'.repeat(12001) }, { id: 'custom/mimo-v2.5-pro' }), undefined);
    assert.equal(getDocumentAgentProviderOptions(simple, { id: 'custom/other-model' }), undefined);
    assert.equal(getDocumentAgentProviderOptions(simple, {}), undefined);
  });
  test('明确的短修改进入快速通道，检查类任务保持标准流程', () => {
    assert.equal(getDocumentAgentExecutionProfile({ ...request, instruction: '把旧名替换为 XMD' }), 'fast');
    assert.equal(getDocumentAgentExecutionProfile({ ...request, instruction: '检查全文标题结构并整理内容' }), 'standard');
  });
  test('大文档定向任务优先选中选区所在块，全文任务仍保留原顺序', () => {
    const document = Array.from({ length: 60 }, (_, index) => `${'普通内容'.repeat(60)} ${index === 42 ? '火星术语' : index}`).join('\n\n');
    const blocks = indexDocumentBlocks(document);
    const targeted = { ...request, instruction: '替换火星术语', document, documentVersion: fingerprintDocument(document), selection: '火星术语' };
    assert.equal(selectDocumentAgentBlocks(targeted, blocks)[0], blocks[42].id);
    assert.deepEqual(selectDocumentAgentBlocks({ ...targeted, instruction: '检查全文术语', selection: '' }, blocks), blocks.map(block => block.id));
  });
  test('厂商不响应 AbortSignal 时取消仍然结束等待', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      started();
      return { stream: new ReadableStream() };
    } });
    const task = runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller, report: () => {} });
    await ready;
    controller.abort(new Error('用户停止'));
    await assert.rejects(task, /用户停止/);
  });
});

// 用很短的真实计时验证三种预算相互独立，不连接外部服务。
describe('Agent 独立超时', () => {
  test('没有输出触发无响应超时', async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(controller, { idleMs: 20, stepMs: 500, taskMs: 1000 }, () => '定位内容');
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    assert.match(controller.signal.reason.message, /定位内容.*未返回数据/);
    deadline.dispose();
  });
  test('持续输出不会重置单轮期限', async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(controller, { idleMs: 1000, stepMs: 40, taskMs: 2000 }, () => '生成修改');
    const timer = setInterval(deadline.activity, 5);
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    clearInterval(timer);
    assert.match(controller.signal.reason.message, /本轮请求/);
    deadline.dispose();
  });
  test('不断进入下一轮也不能重置总预算', async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(controller, { idleMs: 1000, stepMs: 1000, taskMs: 40 }, () => '检查结果');
    const timer = setInterval(deadline.startStep, 5);
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    clearInterval(timer);
    assert.match(controller.signal.reason.message, /总时间预算/);
    deadline.dispose();
  });
});
