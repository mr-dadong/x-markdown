import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines } from './diffLines';

describe('行级 diff', () => {
    test('纯插入：旧内容为空时全部为新增行', () => {
        const lines = diffLines('', '## 新标题');
        assert.deepEqual(lines, [{ type: 'add', text: '## 新标题' }]);
    });
    test('纯删除：新内容为空时全部为删除行', () => {
        const lines = diffLines('# 重复标题', '');
        assert.deepEqual(lines, [{ type: 'remove', text: '# 重复标题' }]);
    });
    test('混合修改：保留上下文行，删除行在前新增行在后', () => {
        const lines = diffLines('第一段\n### 小节\n结尾', '第一段\n## 小节\n结尾');
        assert.deepEqual(lines, [
            { type: 'context', text: '第一段' },
            { type: 'remove', text: '### 小节' },
            { type: 'add', text: '## 小节' },
            { type: 'context', text: '结尾' },
        ]);
    });
    test('完全相同：全部为上下文行', () => {
        const lines = diffLines('甲\n乙', '甲\n乙');
        assert.deepEqual(lines, [
            { type: 'context', text: '甲' },
            { type: 'context', text: '乙' },
        ]);
    });
    test('中间插入一行：前后上下文保持不动', () => {
        const lines = diffLines('甲\n乙', '甲\n丙\n乙');
        assert.deepEqual(lines, [
            { type: 'context', text: '甲' },
            { type: 'add', text: '丙' },
            { type: 'context', text: '乙' },
        ]);
    });
});
