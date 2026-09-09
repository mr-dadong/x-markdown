import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { useDocumentAgent } from './useDocumentAgent';
import type { DocumentAgentApi, DocumentAgentEvent, DocumentAgentRequest, DocumentAgentResult, DocumentPatch } from '../types/documentAgent';
import { fingerprintDocument } from '../utils/documentAgentBlocks';

/** 可控 IPC：测试真实状态转换，不连接收费模型。 */
function setup() {
  const document = ref('旧名，正文');
  const id = ref<number | null>(1);
  let listener!: (event: DocumentAgentEvent) => void;
  let request!: DocumentAgentRequest;
  let resolve!: (result: DocumentAgentResult) => void;
  const cancelled: string[] = [];
  const api: DocumentAgentApi = {
    invoke: value => { request = value; return new Promise<DocumentAgentResult>(done => { resolve = done; }); },
    cancel: value => { cancelled.push(value); },
    onEvent: callback => { listener = callback; return () => {}; },
  };
  const scope = effectScope();
  const agent = scope.run(() => useDocumentAgent({
    getDocument: () => document.value, getDocumentId: () => id.value,
    getSelection: () => '', getModel: () => null,
    applyDocument: (expected, next) => {
      if (document.value !== expected) throw new Error('冲突');
      document.value = next;
    },
  }, api))!;
  const emit = (type: 'reasoning' | 'text', text: string) => listener({ type, text, requestId: request.requestId });
  const proposal: DocumentPatch = { id: 'p1', baseVersion: fingerprintDocument('旧名，正文'), start: 0, end: 2, before: '旧名', after: 'XMD', reason: '统一名称' };
  const propose = (patch: DocumentPatch = proposal) => listener({ requestId: request.requestId, type: 'patch', patch });
  const done = (): DocumentAgentResult => ({ requestId: request.requestId, type: 'done', issues: [] });
  const finish = () => { const result = done(); listener(result); resolve(result); };
  // 模拟 Electron 先返回 invoke 结果、稍后才派发同一个完成事件。
  const finishViaResult = () => resolve(done());
  const finishCancelled = () => resolve({ requestId: request.requestId, type: 'error', message: '任务已停止', terminationReason: 'cancelled' });
  const finishPartial = (message: string) => {
    const result: DocumentAgentResult = { requestId: request.requestId, type: 'done', issues: [], outcome: 'incomplete', message, terminationReason: 'cancelled' };
    listener(result);
    resolve(result);
  };
  const event = (value: DocumentAgentEvent) => listener({ ...value, requestId: request.requestId });
  return { event, agent, document, id, scope, emit, propose, finish, finishViaResult, finishCancelled, finishPartial, cancelled,
    resolve: () => resolve(undefined as never) };
}

describe('文档 Agent 审阅和生命周期', () => {
  test('思考增量独立展示，取消后忽略迟到思考，新任务清空旧思考', async () => {
    const state = setup();
    const task = state.agent.start('整理文档');
    state.emit('reasoning', '先检查标题');
    state.emit('reasoning', '，再统一术语');
    assert.equal(state.agent.reasoning.value, '先检查标题，再统一术语');
    assert.equal(state.agent.response.value, '');
    assert.equal(state.agent.phase.value, 'thinking');
    state.emit('text', '开始整理结果');
    assert.equal(state.agent.phase.value, 'writing');
    state.agent.cancel();
    state.emit('reasoning', '迟到内容');
    state.finishCancelled();
    await task;
    assert.equal(state.agent.reasoning.value, '先检查标题，再统一术语');
    const next = state.agent.start('新的任务');
    assert.equal(state.agent.reasoning.value, '');
    state.finish();
    await next;
    state.scope.stop();
  });
  test('部分接受、部分拒绝保持原文位置，待审阅期间不能覆盖任务', async () => {
    const state = setup();
    const task = state.agent.start('调整名称和正文');
    state.propose();
    state.propose({ id: 'p2', baseVersion: fingerprintDocument('旧名，正文'), start: 3, end: 5, before: '正文', after: '新的正文', reason: '补充内容' });
    state.finish();
    await task;
    assert.equal(await state.agent.start('另一个任务'), false);
    state.agent.accept('p2');
    state.agent.reject('p1');
    assert.equal(state.document.value, '旧名，新的正文');
    assert.equal(state.agent.status.value, 'done');
    state.agent.undo();
    assert.equal(state.document.value, '旧名，正文');
    assert.equal(state.agent.patches.value[0].decision, 'rejected');
    state.scope.stop();
  });
  test('拒绝结构修复后，检查结果对应实际保留的文档', async () => {
    const state = setup();
    state.document.value = '# 标题\n### 小节';
    const task = state.agent.start('修复标题');
    state.propose({ id: 'heading', baseVersion: fingerprintDocument('# 标题\n### 小节'), start: 5, end: 8, before: '###', after: '##', reason: '标题层级' });
    state.finish();
    await task;
    state.agent.reject();
    assert.equal(state.agent.issues.value.length, 1);
    assert.equal(state.agent.checkTarget.value, '当前文档');
    state.scope.stop();
  });
  test('生成期间不写入，接受后可撤销，拒绝不修改正文', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.agent.accept();
    assert.equal(state.document.value, '旧名，正文');
    state.finish();
    assert.equal(await task, true);
    assert.equal(state.agent.status.value, 'review');
    state.agent.accept();
    assert.equal(state.document.value, 'XMD，正文');
    state.agent.undo();
    assert.equal(state.document.value, '旧名，正文');
    state.agent.reject();
    assert.equal(state.document.value, '旧名，正文');
    assert.equal(state.agent.status.value, 'done');
    state.scope.stop();
  });
  test('取消后等待后台结束，没有建议时进入已停止状态', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.agent.cancel();
    assert.equal(state.agent.status.value, 'stopping');
    state.finishCancelled();
    assert.equal(await task, false);
    assert.equal(state.agent.status.value, 'cancelled');
    assert.equal(state.agent.patches.value.length, 0);
    assert.equal(state.cancelled.length, 1);
    state.scope.stop();
  });
  test('用户改动后再撤销，旧任务仍然失效', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.document.value = '用户的新文字';
    state.document.value = '旧名，正文';
    state.finish();
    await task;
    state.agent.accept();
    assert.equal(state.agent.status.value, 'conflict');
    assert.equal(state.document.value, '旧名，正文');
    state.scope.stop();
  });
  test('切换同内容的未保存标签页也不能应用旧任务', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.finish();
    await task;
    state.id.value = 2;
    state.agent.accept();
    assert.equal(state.agent.status.value, 'conflict');
    assert.equal(state.document.value, '旧名，正文');
    state.scope.stop();
  });
  test('接受后继续编辑，任务撤销不会覆盖新输入', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.finish();
    await task;
    state.agent.accept();
    state.document.value += '用户新增';
    state.agent.undo();
    assert.equal(state.document.value, 'XMD，正文用户新增');
    state.scope.stop();
  });
  test('IPC 无完成事件时明确失败', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.resolve();
    assert.equal(await task, false);
    assert.equal(state.agent.status.value, 'error');
    state.scope.stop();
  });
  test('取消完成后保留已验证建议，并以未完整结果开放审阅', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.agent.cancel();
    state.finishPartial('任务已停止，已保留 1 处建议');
    assert.equal(await task, true);
    assert.equal(state.agent.status.value, 'review');
    assert.equal(state.agent.canReview.value, true);
    state.agent.accept();
    assert.equal(state.document.value, 'XMD，正文');
    state.scope.stop();
  });
  test('拒绝不属于当前文档版本的修改，并停止后台任务', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose({ id: 'stale', baseVersion: 'stale-version', start: 0, end: 2, before: '旧名', after: 'XMD', reason: '过期修改' });
    assert.equal(state.agent.status.value, 'conflict');
    assert.equal(state.agent.patches.value.length, 0);
    assert.equal(state.cancelled.length, 1);
    state.resolve();
    await task;
    state.scope.stop();
  });
  test('IPC 完成返回值先于完成事件到达时仍进入审阅，不误报连接结束', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.propose();
    state.finishViaResult();
    assert.equal(await task, true);
    assert.equal(state.agent.status.value, 'review');
    assert.equal(state.agent.error.value, '');
    state.scope.stop();
  });
  test('清除本轮记录后回到初始状态，但不撤销已经接受的文档修改', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    assert.equal(state.agent.clear(), false);
    state.propose();
    state.finish();
    await task;
    state.agent.accept();
    assert.equal(state.document.value, 'XMD，正文');
    assert.equal(state.agent.clear(), true);
    assert.equal(state.agent.status.value, 'idle');
    assert.equal(state.agent.instruction.value, '');
    assert.equal(state.agent.patches.value.length, 0);
    assert.equal(state.document.value, 'XMD，正文');
    state.scope.stop();
  });
});

// 新的阶段协议与旧的审阅、取消接口共同工作。
describe('Agent 阶段与修改预览', () => {
  test('实时动作和参数修正原因始终显示在当前状态中', async () => {
    const state = setup();
    const task = state.agent.start('整理文档');
    state.event({ requestId: '', type: 'activity', title: '正在分析第 1/2 批', detail: '本批 5 个文档块' });
    assert.equal(state.agent.currentActionTitle.value, '正在分析第 1/2 批');
    assert.equal(state.agent.currentActionDetail.value, '本批 5 个文档块');
    state.event({ requestId: '', type: 'progress', message: '工具参数需要修正：只有标题可以调整标题级别' });
    assert.equal(state.agent.currentActionTitle.value, '正在修正修改参数');
    assert.match(state.agent.currentActionDetail.value, /只有标题可以调整标题级别/);
    state.finish();
    await task;
    state.scope.stop();
  });

  test('文字增量不改变真实阶段，同 ID 修订替换预览，中断禁止应用', async () => {
    const state = setup();
    const task = state.agent.start('整理文档');
    state.event({ requestId: '', type: 'stage', stage: 'locate', state: 'done', message: '找到 2 处命中' });
    state.emit('reasoning', '准备修改');
    assert.equal(state.agent.stages.value.find(stage => stage.id === 'locate')?.detail, '找到 2 处命中');
    state.propose();
    state.propose({ id: 'p1', baseVersion: fingerprintDocument('旧名，正文'), start: 0, end: 2, before: '旧名', after: '新名称', reason: '修订名称' });
    assert.equal(state.agent.patches.value.length, 1);
    assert.equal(state.agent.patches.value[0].after, '新名称');
    state.event({ requestId: '', type: 'error', message: '模型无响应' });
    state.resolve();
    await task;
    assert.equal(state.agent.canReview.value, false);
    state.agent.accept();
    assert.equal(state.document.value, '旧名，正文');
    assert.ok(state.agent.endedAt.value > 0);
    state.scope.stop();
  });
  test('部分完成保留未解决目标，审阅操作不把任务改成全部完成', async () => {
    const state = setup();
    const task = state.agent.start('统一名称并核实事实');
    state.propose();
    state.event({ requestId: '', type: 'goals', goals: [{ id: 'goal-1', title: '核实事实', state: 'unresolved', detail: '没有外部资料' }] });
    state.event({ requestId: '', type: 'done', outcome: 'incomplete', issues: [] });
    state.resolve();
    await task;
    assert.equal(state.agent.canReview.value, true);
    state.agent.accept();
    assert.equal(state.agent.outcome.value, 'incomplete');
    assert.equal(state.agent.goals.value[0].state, 'unresolved');
    assert.equal(state.document.value, 'XMD，正文');
    state.scope.stop();
  });
});
