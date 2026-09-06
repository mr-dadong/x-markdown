import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { useDocumentAgent } from './useDocumentAgent';
import type { DocumentAgentApi, DocumentAgentEvent, DocumentAgentRequest, DocumentPatch } from '../types/documentAgent';

/** 可控 IPC：测试真实状态转换，不连接收费模型。 */
function setup() {
  const document = ref('旧名，正文');
  const id = ref<number | null>(1);
  let listener!: (event: DocumentAgentEvent) => void;
  let request!: DocumentAgentRequest;
  let resolve!: () => void;
  const cancelled: string[] = [];
  const api: DocumentAgentApi = {
    invoke: value => { request = value; return new Promise<void>(done => { resolve = done; }); },
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
  const proposal: DocumentPatch = { id: 'p1', start: 0, end: 2, before: '旧名', after: 'XMD', reason: '统一名称' };
  const propose = (patch: DocumentPatch = proposal) => listener({ requestId: request.requestId, type: 'patch', patch });
  const finish = () => { listener({ requestId: request.requestId, type: 'done', issues: [] }); resolve(); };
  return { agent, document, id, scope, emit, propose, finish, cancelled, resolve: () => resolve() };
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
    state.resolve();
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
    state.propose({ id: 'p2', start: 3, end: 5, before: '正文', after: '新的正文', reason: '补充内容' });
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
    state.propose({ id: 'heading', start: 5, end: 8, before: '###', after: '##', reason: '标题层级' });
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
  test('取消后忽略迟到完成和修改事件', async () => {
    const state = setup();
    const task = state.agent.start('统一名称');
    state.agent.cancel();
    state.propose();
    state.finish();
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
});
