// 使用独立进程验证真实保存与加载逻辑，Electron 安全存储只替换为可验证的测试实现。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mock } from 'bun:test';
const directory = process.argv[2];
mock.module('electron', () => ({ app: { getPath: () => directory }, safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
} }));
const { saveAiSettings, getAiSettings, getAiStatus, testAiConnection } = await import('../../../electron/ai/aiSettings.ts');
const first = 'anthropic:account-one';
const second = 'anthropic:account-two';
if (process.argv[3] === 'verify-removal') {
  // 重启后不能重新补回用户已删除的旧版自定义连接。
  assert.equal((await getAiSettings()).providers.custom, undefined);
} else if (process.argv[3] === 'reload') {
  const settings = await getAiSettings();
  assert.equal(settings.provider, second);
  assert.equal(settings.providers[first].apiKey, 'key-one');
  assert.equal(settings.providers[second].apiKey, 'key-two');
  assert.equal(settings.providers[second].name, '工作账号');
  // 删除当前选中模型时空字符串应落盘，旧 enabled=false 不再阻止使用。
  await saveAiSettings({ enabled: false, providers: { [second]: { model: '' } } });
  assert.equal((await getAiSettings()).providers[second].model, '');
  assert.equal((await getAiStatus()).configured, false);
  await saveAiSettings({ provider: first, removedProviders: [second, 'custom'] });
  assert.equal((await getAiStatus()).configured, true);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'ai-settings.json'), 'utf8'));
  assert.equal(stored.config.providers[second], undefined);
  assert.equal(stored.encryptedApiKeys[second], undefined);
} else {
  const saved = await saveAiSettings({ enabled: true, provider: second, providers: {
    [first]: { name: '个人账号', model: 'claude-a', baseUrl: 'https://one.example/v1', apiKey: 'key-one' },
    [second]: { name: '工作账号', model: 'claude-b', baseUrl: 'https://two.example/v1', apiKey: 'key-two' },
  } });
  assert.equal(saved.providers[first].hasApiKey, true);
  assert.equal(saved.providers[second].apiKey, undefined);
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })); };
  const result = await testAiConnection();
  assert.equal(result.ok, true);
  assert.equal(result.provider, second);
  assert.equal(request.url, 'https://two.example/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'key-two');
  assert.ok(request.options.signal);
  await saveAiSettings({ providers: { [second]: { name: '工作账号', model: 'claude-b' } } });
  assert.equal((await getAiSettings()).providers[second].apiKey, 'key-two');
}
