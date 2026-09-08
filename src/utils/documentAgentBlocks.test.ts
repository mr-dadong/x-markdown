import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fingerprintDocument, indexDocumentBlocks } from './documentAgentBlocks';

describe('文档 Agent 语义块索引', () => {
  test('为标题、段落、列表和代码块生成稳定 blockId 与源码范围', () => {
    const document = '# 标题\n\n正文\n\n- 一\n- 二\n\n```js\nconst a = 1\n```';
    const blocks = indexDocumentBlocks(document);
    assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'code']);
    assert.ok(blocks.every(block => block.id.includes(block.fingerprint)));
    assert.equal(blocks[0].headingLevel, 1);
    assert.equal(document.slice(blocks[2].start, blocks[2].end), blocks[2].text);
  });

  test('空文档没有虚构块', () => {
    assert.deepEqual(indexDocumentBlocks(''), []);
  });

  test('前面插入无关章节后，原章节的语义块 ID 保持不变', () => {
    const original = '# 安装\n\n执行 npm install。\n\n# 使用\n\n执行 npm start。';
    const changed = '# 简介\n\n项目说明。\n\n' + original;
    const originalBlocks = indexDocumentBlocks(original);
    const changedBlocks = indexDocumentBlocks(changed);
    const originalUsage = originalBlocks.find(block => block.text.includes('npm start'))!;
    const changedUsage = changedBlocks.find(block => block.text.includes('npm start'))!;
    assert.equal(changedUsage.id, originalUsage.id);
    assert.deepEqual(changedUsage.headingPath, ['使用']);
  });

  test('文档指纹对相同内容稳定，对正文变化敏感', () => {
    assert.equal(fingerprintDocument('正文'), fingerprintDocument('正文'));
    assert.notEqual(fingerprintDocument('正文'), fingerprintDocument('正文。'));
  });
});
