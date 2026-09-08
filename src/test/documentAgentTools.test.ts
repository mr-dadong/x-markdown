import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDocumentAgentTools } from '../../electron/ai/documentAgentTools';
import { noopObserve } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { Agent } from '@mastra/core/agent';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import type { DocumentAgentEvent } from '../types/documentAgent';
import { applyDocumentPatches } from '../utils/documentAgent';
import { indexDocumentBlocks } from '../utils/documentAgentBlocks';

const context = { observe: noopObserve, requestContext: new RequestContext() };

// 直接使用已安装 Mastra 创建的工具，验证 Schema 与执行器的真实接口。
describe('文档 Agent 工具执行', () => {
  test('生产工具只暴露语义定位与修改接口', () => {
    const runtime = createDocumentAgentTools('正文', new AbortController().signal, () => {}, 'surface');
    assert.deepEqual(Object.keys(runtime.tools).sort(), [
      'find_in_document', 'finish_document_task', 'inspect_document', 'propose_semantic_edits', 'read_blocks', 'validate_document',
    ]);
  });
  test('真实 Agent 流能接收工具结果并继续下一轮', async () => {
    const runtime = createDocumentAgentTools('旧名', AbortSignal.timeout(10000), () => {}, 'loop');
    const blockId = indexDocumentBlocks('旧名')[0].id;
    let step = 0;
    // 使用 SDK 提供的模型替身，完整运行工具循环但不产生网络请求。
    const model = new MastraLanguageModelV2Mock({
      doStream: async options => {
        const current = step++;
        if (current === 0) assert.deepEqual(options.toolChoice, { type: 'tool', toolName: 'inspect_document' });
        if (current > 0) assert.ok(JSON.stringify(options.prompt).includes('tool-result'));
        return { stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (current < 2) {
            controller.enqueue({ type: 'tool-call', toolCallId: `call-${current}`,
              toolName: current === 0 ? 'inspect_document' : 'propose_semantic_edits',
              input: JSON.stringify(current === 0 ? {} : { operations: [{ type: 'replace_text', blockId, find: '旧名', replacement: 'XMD', reason: '统一名称' }] }) });
          } else {
            controller.enqueue({ type: 'text-start', id: 'text' });
            controller.enqueue({ type: 'text-delta', id: 'text', delta: '请审阅修改' });
            controller.enqueue({ type: 'text-end', id: 'text' });
          }
          controller.enqueue({ type: 'finish', finishReason: current < 2 ? 'tool-calls' : 'stop', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
          controller.close();
        } }) };
      },
    });
    const agent = new Agent({ id: 'loop-test', name: 'loop-test', model, instructions: '编辑文档', tools: runtime.tools });
    const stream = await agent.stream('统一名称', {
      maxSteps: 4, abortSignal: AbortSignal.timeout(10000),
      prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber === 0 ? { type: 'tool' as const, toolName: 'inspect_document' } : 'auto' as const }),
    });
    let finishReason = '';
    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'error') throw chunk.payload.error;
      if (chunk.type === 'finish') finishReason = chunk.payload.stepResult.reason;
    }
    assert.equal(step, 3);
    assert.equal(finishReason, 'stop');
    assert.equal(runtime.patches[0].after, 'XMD');
  });
  test('读取、分页搜索、提交修改、检查组成闭环', async () => {
    const events: DocumentAgentEvent[] = [];
    const runtime = createDocumentAgentTools('旧名，旧名\n# 标题\n### 小节', new AbortController().signal, event => events.push(event), 'task');
    const tools = runtime.legacyTools;
    assert.ok(tools.read_document.execute && tools.search_document.execute && tools.propose_document_patch.execute && runtime.tools.validate_document.execute);
    await tools.read_document.execute({ start: 0, end: 5 }, context);
    const results = await tools.search_document.execute({ query: '旧名', start: 0 }, context);
    assert.deepEqual(results, { matches: [
      { start: 0, end: 2, context: '旧名，旧名\n# 标题\n### 小节' },
      { start: 3, end: 5, context: '旧名，旧名\n# 标题\n### 小节' },
    ], nextStart: null });
    await tools.propose_document_patch.execute({ start: 0, end: 2, before: '旧名', after: 'XMD', reason: '统一名称' }, context);
    assert.equal(runtime.patches.length, 1);
    assert.equal(events.filter(event => event.type === 'patch').length, 1);
    assert.deepEqual(await runtime.tools.validate_document.execute({}, context), { issues: ['第 3 行：标题从 1 级跳到 3 级'] });
  });
  test('读取前不接受修改；取消后不允许继续调用工具', async () => {
    const controller = new AbortController();
    const runtime = createDocumentAgentTools('旧名', controller.signal, () => {}, 'task');
    assert.ok(runtime.legacyTools.propose_document_patch.execute && runtime.legacyTools.read_document.execute);
    await assert.rejects(runtime.legacyTools.propose_document_patch.execute({ start: 0, end: 2, before: '旧名', after: 'XMD', reason: '修改' }, context), /先调用/);
    controller.abort(new Error('取消测试'));
    await assert.rejects(runtime.legacyTools.read_document.execute({ start: 0, end: 2 }, context), /取消测试/);
    assert.equal(runtime.patches.length, 0);
  });
});

// 批量提交与修订必须保持原文坐标契约，并以整批验证结果为准。
describe('分阶段 Agent 的修改与目标', () => {
  test('按 blockId 原子提交标题与块内文字修改，不让模型接触字符坐标', async () => {
    const document = 'v.2.9 版本：\n\n正文使用旧名称。';
    const events: DocumentAgentEvent[] = [];
    const runtime = createDocumentAgentTools(document, new AbortController().signal, event => events.push(event), 'semantic');
    const [heading, paragraph] = indexDocumentBlocks(document);
    runtime.overview();
    await runtime.tools.propose_semantic_edits.execute!({ operations: [
      { type: 'set_heading_level', blockId: heading.id, level: 1, reason: '设置版本标题' },
      { type: 'replace_text', blockId: paragraph.id, find: '旧名称', replacement: 'XMD', reason: '统一名称' },
    ] }, context);
    assert.equal(applyDocumentPatches(document, runtime.patches), '# v.2.9 版本：\n\n正文使用XMD。');
    assert.equal(events.filter(event => event.type === 'patch').length, 2);
  });
  test('语义批量中任一块无效时整批不提交，并保护代码块局部替换', async () => {
    const document = '正文\n\n```js\nconst a = 1\n```';
    const runtime = createDocumentAgentTools(document, new AbortController().signal, () => {}, 'atomic');
    const [paragraph, code] = indexDocumentBlocks(document);
    runtime.overview();
    const result = await runtime.tools.propose_semantic_edits.execute!({ operations: [
      { type: 'replace_text', blockId: paragraph.id, find: '正文', replacement: '新正文', reason: '更新正文' },
      { type: 'replace_text', blockId: code.id, find: 'a', replacement: 'b', reason: '修改代码' },
    ] }, context) as { ok: false; error: { code: string } };
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CODE_BLOCK_PROTECTED');
    assert.equal(runtime.patches.length, 0);
  });
  test('批量中一处原文不匹配时整批失败，不发送半批预览', async () => {
    const events: DocumentAgentEvent[] = [];
    const runtime = createDocumentAgentTools('甲乙', new AbortController().signal, event => events.push(event), 'batch');
    runtime.overview();
    await assert.rejects(runtime.legacyTools.propose_document_patches.execute!({ patches: [
      { start: 0, end: 1, before: '甲', after: 'A', reason: '替换甲' },
      { start: 1, end: 2, before: '错误', after: 'B', reason: '替换乙' },
    ] }, context), /原文在文档中不存在/);
    assert.equal(runtime.patches.length, 0);
    assert.equal(events.filter(event => event.type === 'patch').length, 0);
    assert.ok(events.some(event => event.type === 'operation' && event.operation.state === 'error'));
  });
  test('模型字符坐标不准确时按唯一原文重新定位，重复原文则明确拒绝', async () => {
    const runtime = createDocumentAgentTools('\uFEFFv.2.9 版本：\n正文', new AbortController().signal, () => {}, 'locate');
    runtime.overview();
    await runtime.legacyTools.propose_document_patch.execute!({ start: 0, end: 9, before: 'v.2.9 版本：', after: '# v.2.9 版本', reason: '改为标题' }, context);
    assert.equal(runtime.patches[0].start, 1);
    assert.equal(runtime.patches[0].end, 10);

    const repeated = createDocumentAgentTools('标题\n标题', new AbortController().signal, () => {}, 'ambiguous');
    repeated.overview();
    await assert.rejects(repeated.legacyTools.propose_document_patch.execute!({ start: 1, end: 3, before: '标题', after: '# 标题', reason: '改为标题' }, context), /出现多次/);
  });
  test('修订使用同一 ID，最终检查重新检查修订后的内容', async () => {
    const runtime = createDocumentAgentTools('# 标题\n### 小节', new AbortController().signal, () => {}, 'revise');
    runtime.overview();
    await runtime.legacyTools.plan_document_task.execute!({ goals: ['修复标题'] }, context);
    await runtime.legacyTools.propose_document_patches.execute!({ patches: [
      { start: 5, end: 8, before: '###', after: '####', reason: '调整层级' },
    ] }, context);
    assert.deepEqual(await runtime.tools.validate_document.execute!({}, context), { issues: ['第 2 行：标题从 1 级跳到 4 级'] });
    const id = runtime.patches[0].id;
    await runtime.legacyTools.revise_document_patch.execute!({ id, start: 5, end: 8, before: '###', after: '##', reason: '修复跳级' }, context);
    assert.equal(runtime.patches.length, 1);
    assert.equal(runtime.patches[0].id, id);
    await runtime.tools.finish_document_task.execute!({ outcomes: [{ id: 'goal-1', state: 'done', detail: '建议将三级标题调整为二级' }] }, context);
    assert.deepEqual(runtime.getIssues(), []);
    assert.equal(runtime.getOutcome(), 'complete');
    await assert.rejects(runtime.legacyTools.read_document.execute!({ start: 0, end: 1 }, context), /已收尾/);
  });
  test('同一搜索第三次无进展停止，新增修改后允许重新检查', async () => {
    const runtime = createDocumentAgentTools('旧名', new AbortController().signal, () => {}, 'repeat');
    runtime.overview();
    await runtime.legacyTools.search_document.execute!({ query: '旧名', start: 0 }, context);
    await runtime.legacyTools.search_document.execute!({ query: '旧名', start: 0 }, context);
    await assert.rejects(runtime.legacyTools.search_document.execute!({ query: '旧名', start: 0 }, context), /重复 3 次/);
    await runtime.legacyTools.propose_document_patch.execute!({ start: 0, end: 2, before: '旧名', after: 'XMD', reason: '统一名称' }, context);
    await runtime.legacyTools.search_document.execute!({ query: '旧名', start: 0 }, context);
  });
  test('必须核对每个目标，预算收尾不能被标记成全部完成', async () => {
    const runtime = createDocumentAgentTools('正文', new AbortController().signal, () => {}, 'goals');
    runtime.overview();
    await runtime.legacyTools.plan_document_task.execute!({ goals: ['检查标题', '检查术语'] }, context);
    const invalid = await runtime.tools.finish_document_task.execute!({ outcomes: [{ id: 'goal-1', state: 'done', detail: '无标题' }] }, context) as { ok: false; error: { code: string; retryable: boolean } };
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'INVALID_INPUT');
    assert.equal(invalid.error.retryable, true);
    assert.equal(runtime.isComplete(), false);
    runtime.close('接近预算');
    await runtime.tools.finish_document_task.execute!({ outcomes: [
      { id: 'goal-1', state: 'done', detail: '无标题' },
      { id: 'goal-2', state: 'done', detail: '未发现术语问题' },
    ] }, context);
    assert.equal(runtime.getOutcome(), 'incomplete');
  });
  test('同一语义工具错误连续三次后停止重试并保留未完成状态', async () => {
    const runtime = createDocumentAgentTools('正文', new AbortController().signal, () => {}, 'retry-limit');
    runtime.initializeGoal('替换不存在的内容');
    const blockId = indexDocumentBlocks('正文')[0].id;
    const executeInvalid = () => runtime.tools.propose_semantic_edits.execute!({ operations: [
      { type: 'replace_text', blockId, find: '不存在', replacement: '新内容', reason: '测试纠错上限' },
    ] }, context) as Promise<{ ok: false; error: { attempt: number; retryable: boolean } }>;
    assert.deepEqual((await executeInvalid()).error, { code: 'TEXT_NOT_FOUND', message: `${blockId} 中找不到待替换原文`, hint: '调用 read_blocks 重新读取该块后修正 find', attempt: 1, retryable: true });
    assert.equal((await executeInvalid()).error.retryable, true);
    const third = await executeInvalid();
    assert.equal(third.error.attempt, 3);
    assert.equal(third.error.retryable, false);
    assert.equal(runtime.isComplete(), true);
    assert.equal(runtime.getOutcome(), 'incomplete');
    assert.equal(runtime.patches.length, 0);
  });
  test('重复提交已成功的语义修改时只拒绝新调用，不复制已有建议', async () => {
    const document = '旧名';
    const runtime = createDocumentAgentTools(document, new AbortController().signal, () => {}, 'duplicate-edit');
    const blockId = indexDocumentBlocks(document)[0].id;
    const operation = { type: 'replace_text', blockId, find: '旧名', replacement: 'XMD', reason: '统一名称' };
    await runtime.tools.propose_semantic_edits.execute!({ operations: [operation] }, context);
    const repeated = await runtime.tools.propose_semantic_edits.execute!({ operations: [operation] }, context) as { ok: false; error: { code: string } };
    assert.equal(repeated.error.code, 'OVERLAPPING_EDIT');
    assert.equal(runtime.patches.length, 1);
  });
  test('预算到达时直接结束并标记未核对目标，不再等待模型选择收尾工具', async () => {
    const events: DocumentAgentEvent[] = [];
    const runtime = createDocumentAgentTools('正文', new AbortController().signal, event => events.push(event), 'budget');
    runtime.overview();
    await runtime.legacyTools.plan_document_task.execute!({ goals: ['检查标题'] }, context);
    runtime.finishAtBudget('达到执行预算');
    assert.equal(runtime.isComplete(), true);
    assert.equal(runtime.goals[0].state, 'unresolved');
    assert.equal(runtime.getOutcome(), 'incomplete');
    assert.ok(events.some(event => event.type === 'goals' && event.goals[0].state === 'unresolved'));
  });
});
