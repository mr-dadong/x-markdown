import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 测试替身放在独立进程，避免污染其他编辑器测试的 Electron 和 DOM。
const runFixture = (name: string, args: string[] = []): void => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url)), ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
};

test('重复厂商连接独立保存密钥，重启后恢复，并按厂商协议测试连接', { timeout: 20000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'xmd-ai-settings-'));
  try {
    runFixture('ai-settings', [directory, 'save']);
    runFixture('ai-settings', [directory, 'reload']);
    runFixture('ai-settings', [directory, 'verify-removal']);
  } finally {
    // 目录由本测试创建，仅删除本测试的临时配置。
    rmSync(directory, { recursive: true });
  }
});

test('首次加载后修改可保存，切换连接保留密钥，关闭等待保存，失败保留草稿', { timeout: 20000 }, () => {
  runFixture('ai-settings-panel');
});
