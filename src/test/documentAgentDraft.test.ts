import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDocumentAgentDraft } from '../../electron/ai/documentAgentDraft';
import { applyDocumentPatches } from '../utils/documentAgent';

// 使用实际最终文本验证坐标映射，不依赖内部位置数组。
describe('草稿转审阅差异', () => {
  test('不同位置的修改分别审阅，二次修订保留正确原文坐标', () => {
    const original = '甲段\n\n乙段\n\n丙段';
    const draft = createDocumentAgentDraft(original, 'draft');
    draft.edit('甲段', '第一段', false);
    draft.edit('丙段', '第三段', false);
    draft.edit('第一段', '修改后的第一段', false);
    assert.equal(draft.patches().length, 2);
    assert.equal(applyDocumentPatches(original, draft.patches()), '修改后的第一段\n\n乙段\n\n第三段');
  });
  test('Windows 换行、Unicode 和文档结尾保持正确', () => {
    const original = '# 标题\r\n\r\n你好😀\r\n';
    const draft = createDocumentAgentDraft(original, 'crlf');
    draft.edit('你好😀\n', '你好世界😀\n新增行\n', false);
    assert.equal(applyDocumentPatches(original, draft.patches()), '# 标题\r\n\r\n你好世界😀\r\n新增行\r\n');
  });
  test('混合换行文档中还原原文不会产生纯换行修改', () => {
    const original = '甲\r\n乙\r\n丙\n';
    const draft = createDocumentAgentDraft(original, 'mixed');
    draft.edit('丙\n', '新丙\n', false);
    draft.edit('新丙\n', '丙\n', false);
    assert.deepEqual(draft.patches(), []);
  });
  test('相邻修改、跨旧建议修改和整段删除合并为有效差异', () => {
    const original = 'abcdef';
    const draft = createDocumentAgentDraft(original, 'merge');
    draft.edit('b', 'BB', false);
    draft.edit('c', 'CC', false);
    draft.edit('aBBCCd', '第一段', false);
    draft.edit('ef', '', false);
    assert.equal(applyDocumentPatches(original, draft.patches()), '第一段');
    assert.equal(draft.patches().length, 1);
  });
  test('还原原文不留下无变化的审阅卡', () => {
    const draft = createDocumentAgentDraft('原文', 'revert');
    draft.edit('原文', '修改内容', false);
    draft.edit('修改内容', '原文', false);
    assert.deepEqual(draft.patches(), []);
  });
  test('全文重写后继续修订与删除全文', () => {
    const original = '第一节\n\n第二节';
    const draft = createDocumentAgentDraft(original, 'rewrite');
    draft.write('第二节\n\n第一节');
    draft.edit('第一节', '总结', false);
    assert.equal(applyDocumentPatches(original, draft.patches()), '第二节\n\n总结');
    draft.write('');
    assert.equal(applyDocumentPatches(original, draft.patches()), '');
  });
  test('大文档修改不依赖整篇 LCS，越过长度限制不会留下半次修改', () => {
    const original = '甲'.repeat(299999) + '乙';
    const draft = createDocumentAgentDraft(original, 'large');
    assert.throws(() => draft.edit('乙', '丙丙', false), /30 万/);
    assert.equal(draft.text(), original);
    draft.edit('乙', '丙', false);
    assert.equal(applyDocumentPatches(original, draft.patches()), '甲'.repeat(299999) + '丙');
  });
  test('多轮插入、删除、替换的最终差异始终能准确重建草稿', () => {
    const original = 'abcdefghijklmnopqrstuvwxyz';
    const draft = createDocumentAgentDraft(original, 'sequence');
    let expected = original;
    // 固定种子的操作序列覆盖大量交叉修改，失败时可稳定复现。
    let seed = 42;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let step = 0; step < 60; step++) {
      const start = random() % expected.length;
      const end = Math.min(expected.length, start + 1 + random() % 5);
      const before = expected.slice(start, end);
      const after = `[${step}]`;
      draft.edit(before, after, true);
      expected = expected.split(before).join(after);
      assert.equal(applyDocumentPatches(original, draft.patches()), expected);
    }
  });
});
