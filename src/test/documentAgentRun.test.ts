import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createAgentDeadline, runDocumentAgent } from '../../electron/ai/documentAgentRun';
import type { DocumentAgentEvent } from '../types/documentAgent';

// 模型替身运行真正的 Mastra 循环，验证强制规划、收尾和最终事件。
const request = { requestId: 'run', instruction: '统一名称', document: '旧名', selection: '' };
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
const outcomes = { outcomes: [{ id: 'goal-1', state: 'done', detail: '名称已统一为 XMD，等待审阅' }] };

describe('Agent 分阶段执行', () => {
  test('规划、批量修改、最终核对和说明完整结束', async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (!current) {
        assert.deepEqual(options.toolChoice, { type: 'tool', toolName: 'plan_document_task' });
        assert.ok(JSON.stringify(options.prompt).includes('旧名'));
      }
      if (current === 3) assert.deepEqual(options.toolChoice, { type: 'none' });
      return { stream: current === 0 ? resultStream('plan_document_task', { goals: ['统一名称'] })
        : current === 1 ? resultStream('propose_document_patches', { patches: [{ start: 0, end: 2, before: '旧名', after: 'XMD', reason: '统一名称' }] })
        : current === 2 ? resultStream('finish_document_task', outcomes) : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 4);
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
    const model = new MastraLanguageModelV2Mock({ doStream: async options => {
      const current = step++;
      if (current === 14) assert.deepEqual(options.toolChoice, { type: 'tool', toolName: 'finish_document_task' });
      return { stream: current === 0 ? resultStream('plan_document_task', { goals: ['统一名称'] })
        : current < 14 ? resultStream('search_document', { query: `名称${current}`, start: 0 })
        : current === 14 ? resultStream('finish_document_task', { outcomes: [{ id: 'goal-1', state: 'unresolved', detail: '尚未找到目标内容' }] })
        : resultStream() };
    } });
    await runDocumentAgent(request, { model, timeoutMs: 10000, maxTokens: 1000, temperature: 0, controller: new AbortController(), report: event => events.push(event) });
    assert.equal(step, 16);
    assert.ok(events.some(event => event.type === 'budget' && event.message.includes('接近')));
    assert.ok(events.some(event => event.type === 'done' && event.outcome === 'incomplete'));
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
