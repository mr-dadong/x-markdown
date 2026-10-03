// 编译真实 Vue 设置脚本，子组件只替换显示部分，验证响应式状态与保存生命周期。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { installDomEnvironment } from '../domEnvironment.ts';
installDomEnvironment();
// Vue 的表单指令会检查原生控件类型，DOM 测试环境需要这些构造函数。
for (const name of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Document', 'ShadowRoot']) globalThis[name] = window[name];
const { createApp, nextTick } = await import('vue');
const sourceUrl = new URL('../../components/settings/AiSettingsPanel.vue', import.meta.url);
const temporaryUrl = new URL(`../../components/settings/.ai-panel-test-${process.pid}.ts`, import.meta.url);
const source = await fs.readFile(sourceUrl, 'utf8');
const descriptor = parse(source).descriptor;
const script = compileScript(descriptor, { id: 'settings-test' });
// 编译真实模板，验证按钮在 DOM 中可见；子组件只保留默认插槽。
const template = compileTemplate({ source: descriptor.template.content, filename: sourceUrl.pathname, id: 'settings-test', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const compiled = script.content
  .replace(/^import (\w+) from ['"][^'"]+(?:\.vue|\?raw)['"]$/gm, 'const $1 = { inheritAttrs: false, methods: { setModels() {} }, render() { return this.$slots.default?.() } }')
  .replace('export default ', 'const Panel = ')
  + '\n' + template.code + '\nPanel.render = render; export default Panel;';
let stored = { enabled: true, provider: 'openai', providers: { openai: { model: 'model-a', hasApiKey: false }, custom: { model: '', hasApiKey: false } }, temperature: 0.7, maxTokens: 1024, timeoutMs: 30000, agentMaxSteps: 12, agentTaskMs: 300000 };
let writes = [];
let release;
let fail = false;
window.electronAPI = { aiService: {
  getSettings: async () => structuredClone(stored),
  getStatus: async () => ({ configured: true }),
  saveSettings: async (input) => {
    writes.push(input);
    if (fail) throw new Error('磁盘写入失败');
    if (release) await new Promise((resolve) => { release = resolve });
    stored = { ...stored, ...input, providers: Object.fromEntries(Object.entries(input.providers).map(([id, config]) => [id, { ...config, apiKey: undefined, hasApiKey: Boolean(config.apiKey) }])) };
    return structuredClone(stored);
  },
} };
let app;
try {
  await fs.writeFile(temporaryUrl, compiled);
  const Panel = (await import(temporaryUrl.href)).default;
  app = createApp(Panel);
  const container = document.createElement('div');
  const vm = app.mount(container);
  await nextTick(); await nextTick();
  const state = vm.$.setupState;
  assert.equal(state.isDirty, false);
  state.apiKeyDraft = 'key-one';
  state.provider = 'custom';
  await nextTick();
  // 旧版自定义连接显示删除按钮，模型名称旁不再额外显示删除入口。
  assert.ok([...container.querySelectorAll('button')].some((button) => button.textContent === '删除此连接'));
  state.currentModel = 'typed-model';
  await nextTick();
  assert.equal([...container.querySelectorAll('button')].some((button) => button.textContent === '删除当前模型'), false);
  state.apiKeyDraft = 'key-two';
  assert.equal(state.isDirty, true);
  await state.flushNow();
  assert.equal(writes[0].providers.openai.apiKey, 'key-one');
  assert.equal(writes[0].providers.custom.apiKey, 'key-two');
  assert.equal(state.isDirty, false);
  // 自动保存完成后，立即保存仍可点击并产生真实保存与可见反馈。
  await nextTick();
  const saveButton = [...container.querySelectorAll('button')].find((button) => button.textContent === '立即保存');
  assert.equal(saveButton.disabled, false);
  assert.ok(saveButton.classList.contains('cursor-pointer'));
  const savedCount = writes.length;
  saveButton.click();
  await state.flushNow();
  await nextTick();
  assert.equal(writes.length, savedCount + 1);
  assert.ok(container.textContent.includes('AI 设置已保存'));
  // 通过真实 DOM 按钮删除旧版自定义连接。
  [...container.querySelectorAll('button')].find((button) => button.textContent === '删除此连接').click();
  assert.equal(state.providersConfig.custom, undefined);
  assert.equal(state.provider, 'openai');
  state.newTemplate = 'deepseek'; state.addConnection();
  const first = state.provider;
  state.addConnection();
  assert.notEqual(first, state.provider);
  assert.equal(state.connectionOptions.filter((option) => option.value.startsWith('deepseek:')).length, 2);
  // 删除当前自定义模型后，提交的模型名必须为空且模型列表同步移除。
  state.currentModel = 'custom-model';
  state.currentCustomModels = ['custom-model', 'another-model'];
  state.removeCustomModel('custom-model');
  assert.equal(state.currentModel, '');
  assert.deepEqual([...state.currentCustomModels], ['another-model']);
  release = true;
  const saving = state.flushNow();
  const closing = state.flushNow();
  assert.equal(saving, closing);
  release(); release = null;
  await closing;
  fail = true;
  state.currentName = '未保存名称';
  await assert.rejects(state.flushNow(), /磁盘写入失败/);
  assert.equal(state.isDirty, true);
  assert.equal(state.currentName, '未保存名称');
  assert.equal(state.hasError, true);
  state.resetToSaved();
  await nextTick();
  app.unmount();
} finally {
  // 仅完成正常验证后卸载，避免清理错误遮盖测试失败。
  await fs.unlink(temporaryUrl);
}
