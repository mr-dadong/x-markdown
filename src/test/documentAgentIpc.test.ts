import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 用独立 Bun 进程执行 IPC 测试替身，防止模块替换污染整个测试集。
test('取消后的最终补丁通过 IPC 交付，网络失败和超时正确区分', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/document-agent-ipc.mjs', import.meta.url))], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
