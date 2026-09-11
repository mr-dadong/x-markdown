// 独立进程内替换 Electron 和模型执行器，避免影响其他测试加载的真实模块。
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
const handlers = new Map();
const ipcMain = { handle: (name, callback) => handlers.set(name, callback), on: () => {} };
mock.module('electron', () => ({ ipcMain }));
mock.module('../../../electron/ai/aiSettings.ts', () => ({ getAiSettings: async () => ({ enabled: true, timeoutMs: 1000, maxTokens: 1000, temperature: 0 }) }));
mock.module('../../../electron/ai/mastra.ts', () => ({ buildModelConfig: () => ({}) }));
let mode = 'partial';
mock.module('../../../electron/ai/documentAgentRun.ts', () => ({ runDocumentAgent: async (request, options) => {
  if (mode === 'error') { const error = new Error('网络连接失败'); options.controller.abort(error); throw error; }
  if (mode === 'timeout') { const error = new Error('模型超时'); error.name = 'TimeoutError'; options.controller.abort(error); throw error; }
  options.controller.abort(new Error('任务已停止'));
  options.report({ requestId: request.requestId, type: 'patch', patch: { id: 'p1', baseVersion: request.documentVersion, start: 0, end: 2, before: '原文', after: '新文', reason: '修改' } });
  options.report({ requestId: request.requestId, type: 'done', outcome: 'incomplete', issues: [], message: '任务已停止' });
} }));
const { registerDocumentAgentIpc } = await import('../../../electron/ai/ipc/documentAgentIpc.ts');
const { IPC_CHANNELS } = await import('../../constants/ipcChannels.ts');
const { fingerprintDocument } = await import('../../utils/documentAgentBlocks.ts');
registerDocumentAgentIpc(() => {});
const sent = [];
const sender = { id: 1, once: () => {}, removeListener: () => {}, isDestroyed: () => false, send: (_, event) => sent.push(event) };
const invoke = handlers.get(IPC_CHANNELS.documentAgentInvoke);
const request = { requestId: 'ipc', instruction: '修改文档', document: '原文', documentVersion: fingerprintDocument('原文'), selection: '' };
const result = await invoke({ sender }, request);
assert.equal(result.outcome, 'incomplete');
assert.deepEqual(sent.map(event => event.type), ['patch', 'done']);
mode = 'error';
assert.equal((await invoke({ sender }, request)).terminationReason, 'error');
mode = 'timeout';
assert.equal((await invoke({ sender }, request)).terminationReason, 'timeout');
