import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentPatches, validateAgentDocument } from './documentAgent';
import type { DocumentPatch } from '../types/documentAgent';

// 用中文、插入、删除和长度变化验证原文坐标不会漂移。
const patch = (start: number, end: number, before: string, after: string): DocumentPatch => ({
  id: `${start}`, baseVersion: 'test-version', start, end, before, after, reason: '测试修改',
});
describe('文档 Agent 修改', () => {
  test('多处修改按原文坐标应用，未修改的代码块保持逐字一致', () => {
    const original = '旧名\n```js\nconst x = 1;\n```\n尾部';
    assert.equal(applyDocumentPatches(original, [patch(0, 2, '旧名', '新的名字'), patch(original.length - 2, original.length, '尾部', '')]),
      '新的名字\n```js\nconst x = 1;\n```\n');
  });
  test('支持空文档插入和末尾追加', () => {
    assert.equal(applyDocumentPatches('', [patch(0, 0, '', '# 标题')]), '# 标题');
    assert.equal(applyDocumentPatches('正文', [patch(2, 2, '', '\n结束')]), '正文\n结束');
  });
  test('拒绝过期原文、越界、重复插入和重叠修改', () => {
    assert.throws(() => applyDocumentPatches('abc', [patch(0, 1, 'x', 'y')]), /原文不匹配/);
    assert.throws(() => applyDocumentPatches('abc', [patch(-1, 1, '', 'y')]), /位置无效/);
    assert.throws(() => applyDocumentPatches('abc', [patch(0, 2, 'ab', 'x'), patch(1, 3, 'bc', 'y')]), /重叠/);
    assert.throws(() => applyDocumentPatches('abc', [patch(1, 1, '', 'x'), patch(1, 1, '', 'y')]), /重叠/);
  });
  test('检查围栏和标题，忽略代码块内部的标题文字', () => {
    assert.deepEqual(validateAgentDocument('# 标题\n```md\n#### 代码里的标题\n```\n## 正文'), []);
    assert.deepEqual(validateAgentDocument('# 标题\n### 跳级\n~~~js\nx'), ['第 2 行：标题从 1 级跳到 3 级', '第 3 行：代码围栏未闭合']);
    assert.deepEqual(validateAgentDocument('````md\n```\n````'), []);
  });
});
