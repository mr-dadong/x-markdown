import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  blockFractionToSourceLine,
  findBlockIndexByLine,
  getTopLevelBlockRanges,
  mapBlockIndex,
  sourceLineToBlockFraction,
} from "./viewSync";

describe("顶层块行范围解析", () => {
  test("段落与标题各占一个顶层块", () => {
    const markdown = "# 标题\n\n第一段。\n\n第二段。";
    assert.deepEqual(getTopLevelBlockRanges(markdown), [
      { startLine: 0, endLine: 1 },
      { startLine: 2, endLine: 3 },
      { startLine: 4, endLine: 5 },
    ]);
  });

  test("列表整体算一个顶层块，内部项不单独计数", () => {
    const markdown = "开头。\n\n- 项目一\n- 项目二\n  - 嵌套项\n\n结尾。";
    const ranges = getTopLevelBlockRanges(markdown);
    assert.equal(ranges.length, 3);
    // markdown-it 的列表行范围会包含紧随其后的空行。
    assert.deepEqual(ranges[1], { startLine: 2, endLine: 6 });
  });

  test("引用块整体算一个顶层块", () => {
    const markdown = "> 第一行\n> 第二行\n\n之后。";
    const ranges = getTopLevelBlockRanges(markdown);
    assert.equal(ranges.length, 2);
    assert.deepEqual(ranges[0], { startLine: 0, endLine: 2 });
  });

  test("围栏代码与表格各算一个顶层块", () => {
    const markdown = "```js\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    const ranges = getTopLevelBlockRanges(markdown);
    assert.equal(ranges.length, 2);
    assert.deepEqual(ranges[0], { startLine: 0, endLine: 3 });
    assert.deepEqual(ranges[1], { startLine: 4, endLine: 7 });
  });

  test("空内容不产生顶层块", () => {
    assert.deepEqual(getTopLevelBlockRanges(""), []);
    assert.deepEqual(getTopLevelBlockRanges("\n\n   \n"), []);
  });
});

describe("块序号映射", () => {
  test("数量一致时直接对齐并钳制越界序号", () => {
    assert.equal(mapBlockIndex(2, 5, 5), 2);
    assert.equal(mapBlockIndex(9, 5, 5), 4);
    assert.equal(mapBlockIndex(-1, 5, 5), 0);
  });

  test("数量不一致时直接按序号对齐并钳制", () => {
    // 渲染视图比源码多一个结尾空段落：6 个块映射到 5 个块。
    assert.equal(mapBlockIndex(0, 6, 5), 0);
    assert.equal(mapBlockIndex(5, 6, 5), 4);
    assert.equal(mapBlockIndex(2, 6, 5), 2);
  });

  test("往返映射可逆：共有块渲染→源码→渲染回到同一块", () => {
    // 渲染视图 6 块（含结尾空段落）、源码 5 块是常见形态。
    // 两侧共有的前 5 个块必须严格可逆。
    for (let index = 0; index < 5; index += 1) {
      const toSource = mapBlockIndex(index, 6, 5);
      assert.equal(mapBlockIndex(toSource, 5, 6), index);
    }
    // 结尾空段落没有源码对应位置，钳制到最后一个内容块。
    assert.equal(mapBlockIndex(5, 6, 5), 4);
    // 数量完全一致时显然可逆。
    for (let index = 0; index < 5; index += 1) {
      assert.equal(mapBlockIndex(mapBlockIndex(index, 5, 5), 5, 5), index);
    }
  });

  test("任一侧为空时返回 0", () => {
    assert.equal(mapBlockIndex(3, 0, 5), 0);
    assert.equal(mapBlockIndex(3, 5, 0), 0);
  });
});

describe("源码行与块内比例互换", () => {
  const ranges = [
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 6 },
    { startLine: 7, endLine: 8 },
  ];

  test("行号换算为块序号与块内偏移比例", () => {
    assert.deepEqual(sourceLineToBlockFraction(ranges, 0), { index: 0, fraction: 0 });
    // 第 4 行落在块 1（2~6 行）的正中间。
    assert.deepEqual(sourceLineToBlockFraction(ranges, 4), { index: 1, fraction: 0.5 });
    // 行号超出末尾时归入最后一个块并钳制比例。
    assert.deepEqual(sourceLineToBlockFraction(ranges, 999), { index: 2, fraction: 1 });
  });

  test("块序号与比例换算回源码行号", () => {
    assert.equal(blockFractionToSourceLine(ranges, 1, 0.5), 4);
    assert.equal(blockFractionToSourceLine(ranges, 2, 0), 7);
    // 跨一行的小数行号由调用方取整，这里保留小数保证往返可逆。
    assert.equal(blockFractionToSourceLine(ranges, 0, 0.8), 0.8);
    // 零跨度块（合成边界数据）始终对齐块首行。
    assert.equal(blockFractionToSourceLine([{ startLine: 3, endLine: 3 }], 0, 0.8), 3);
    // 越界序号与比例都被钳制。
    assert.equal(blockFractionToSourceLine(ranges, 99, 2), 8);
    assert.equal(blockFractionToSourceLine(ranges, -1, -2), 0);
  });

  test("行号与比例往返换算不漂移", () => {
    for (const line of [0, 2, 3.5, 5.9, 7]) {
      const { index, fraction } = sourceLineToBlockFraction(ranges, line);
      const back = blockFractionToSourceLine(ranges, index, fraction);
      assert.ok(Math.abs(back - line) < 1e-9, `第 ${line} 行往返后变为 ${back}`);
    }
  });

  test("空范围一律返回起点", () => {
    assert.deepEqual(sourceLineToBlockFraction([], 3), { index: 0, fraction: 0 });
    assert.equal(blockFractionToSourceLine([], 0, 0), 0);
  });
});

describe("按行号查找顶层块", () => {
  const ranges = [
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 6 },
    { startLine: 7, endLine: 8 },
  ];

  test("行落在块范围内返回对应序号", () => {
    assert.equal(findBlockIndexByLine(ranges, 0), 0);
    assert.equal(findBlockIndexByLine(ranges, 4), 1);
    assert.equal(findBlockIndexByLine(ranges, 7), 2);
  });

  test("行号在块之间的空行上时归入后一个块，超出末尾时归入最后一个块", () => {
    assert.equal(findBlockIndexByLine(ranges, 1), 1);
    assert.equal(findBlockIndexByLine(ranges, 6), 2);
    assert.equal(findBlockIndexByLine(ranges, 999), 2);
  });
});
