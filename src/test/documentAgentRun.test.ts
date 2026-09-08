import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createAgentDeadline, extractDraftAfter, getDocumentAgentExecutionProfile, runDocumentAgent } from '../../electron/ai/documentAgentRun';
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
        : current === 1 ? resultStream('validate_document', {})
        : current === 2 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'done', detail: '代码建议已生成' }] }) : resultStream() };
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
        : current === 1 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'done', detail: '代码建议已生成' }] }) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'draft' && event.text.includes('def sort')));
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
      if (current === 2) assert.deepEqual(options.toolChoice, { type: 'none' });
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 1 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 3);
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'complete'));
    assert.ok(events.some(event => event.type === 'stage' && event.stage === 'check' && event.state === 'done'));
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
  });
  test('模型跳过目标核对直接结束时不能发送成功', async () => {
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => ({ stream: resultStream() }) });
    await assert.rejects(runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) }), /未提交完整/);
    assert.equal(events.some(event => event.type === 'done'), false);
  });
  test('接近轮次预算时强制收尾，保留不完整结果而非成功', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const longDocument = '旧名'.repeat(6001);
    const longRequest = { ...request, document: longDocument, documentVersion: fingerprintDocument(longDocument) };
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (current === 14) assert.deepEqual(options.toolChoice, { type: 'none' });
      return { stream: current < 14 ? resultStream('find_in_document', { query: `名称${current}` })
        : resultStream() };
    } });
    await runDocumentAgent(longRequest, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 15);
    assert.ok(events.some(event => event.type === 'budget' && event.message.includes('预算已结束')));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'incomplete'));
  });
  test('工具验证失败后允许模型按错误原因修正，最终只保留有效修改', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async () => {
      const current = step++;
      return { stream: current === 0 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '错误', replacement: 'XMD', reason: '统一名称' }] })
        : current === 1 ? resultStream('propose_semantic_edits', { operations: [{ type: 'replace_text', blockId: textBlockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] })
        : current === 2 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.ok(events.some(event => event.type === 'progress' && event.message.includes('找不到待替换原文')));
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
    assert.ok(events.some(event => event.type === 'done'));
  });

  test('明确的短修改进入快速通道，检查类任务保持标准流程', () => {
    assert.equal(getDocumentAgentExecutionProfile({ ...request, instruction: '把旧名替换为 XMD' }), 'fast');
    assert.equal(getDocumentAgentExecutionProfile({ ...request, instruction: '检查全文标题结构并整理内容' }), 'standard');
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
