import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope } from 'vue';
import { useDocumentAgent } from '../composables/useDocumentAgent';
import type { DocumentAgentEvent, DocumentAgentRequest, DocumentAgentResult } from '../types/documentAgent';

// 用实际页面状态验证快照撤回、运行期间只预览，以及完成后的接受操作。
test('草稿快照即时显示且撤回不留下旧卡片', async () => {
  let document = '旧名';
  let receive!: (event: DocumentAgentEvent) => void;
  let request!: DocumentAgentRequest;
  let finish!: (event: DocumentAgentResult) => void;
  const scope = effectScope();
  const agent = scope.run(() => useDocumentAgent({
    getDocument: () => document, getDocumentId: () => 1, getSelection: () => '', getModel: () => null,
    applyDocument: (expected, next) => { assert.equal(document, expected); document = next; },
  }, {
    invoke: value => { request = value; return new Promise(resolve => { finish = resolve; }); },
    cancel: () => {}, onEvent: callback => { receive = callback; return () => {}; },
  }))!;
  try {
    const running = agent.start('统一名称');
    const patch = { id: 'p', baseVersion: request.documentVersion, start: 0, end: 2, before: '旧名', after: '新名', reason: '统一名称' };
    receive({ requestId: request.requestId, type: 'patches', patches: [patch] });
    assert.equal(agent.pending.value.length, 1);
    agent.accept();
    assert.equal(document, '旧名');
    receive({ requestId: request.requestId, type: 'patches', patches: [] });
    assert.equal(agent.pending.value.length, 0);
    assert.equal(agent.timeline.value.filter(item => item.kind === 'patch').length, 0);
    receive({ requestId: request.requestId, type: 'patches', patches: [patch] });
    finish({ requestId: request.requestId, type: 'done', issues: [], outcome: 'complete' });
    await running;
    agent.accept();
    assert.equal(document, '新名');
  } finally { scope.stop(); }
});
