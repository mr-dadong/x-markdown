import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCodeFence,
  createTableDelimiter,
  escapeTablePipes,
  hasEscapedCodePipes,
  getTableCodePipeStyles,
  getTableDelimiterWidths,
  renderMarkdownTable,
  restoreTableBackticks,
  serializeFencedCodeBlock,
} from "./markdownSerialization";

describe("Markdown 表格序列化边界", () => {
  test("保留左中右对齐标记", () => {
    assert.equal(createTableDelimiter("left"), ":---");
    assert.equal(createTableDelimiter("center"), ":---:");
    assert.equal(createTableDelimiter("right"), "---:");
    assert.equal(createTableDelimiter(null), "---");
  });

  test("只转义普通文本中尚未转义的表格竖线", () => {
    assert.equal(escapeTablePipes("x|y"), "x\\|y");
    assert.equal(escapeTablePipes("x\\|y"), "x\\|y");
    assert.equal(escapeTablePipes("|x||y|"), "\\|x\\|\\|y\\|");
    assert.equal(escapeTablePipes("`a | b`"), "`a | b`");
    assert.equal(escapeTablePipes("`a | b`", true), "`a \\| b`");
    assert.equal(escapeTablePipes("`a \\ | b` | 文字"), "`a \\ | b` \\| 文字");
  });

  test("识别表格原本采用的代码竖线转义风格", () => {
    assert.equal(hasEscapedCodePipes("| `a \\| b` |"), true);
    assert.equal(hasEscapedCodePipes("| `a | b` |"), false);
    assert.equal(hasEscapedCodePipes("| a \\| b |"), false);
  });

  test("逐个单元格记录混合代码竖线风格", () => {
    assert.deepEqual(
      getTableCodePipeStyles([
        "| A | B |",
        "| --- | --- |",
        "| `a \\| b` | `c | d` |",
      ].join("\n")),
      [
        [false, false],
        [true, false],
      ],
    );
  });

  test("记录原分隔行每列的连字符数量", () => {
    assert.deepEqual(
      getTableDelimiterWidths([
        "| A | B | C |",
        "| :----: | --- | ------: |",
      ].join("\n")),
      [4, 3, 6],
    );
    // 没有分隔行或列数不足时返回空记录，序列化时回退到列宽
    assert.deepEqual(getTableDelimiterWidths("| A |"), []);
    assert.deepEqual(getTableDelimiterWidths("| A |\n| --- |"), [3]);
  });

  test("重新生成表格时仅移除孤立反引号的转义", () => {
    assert.equal(restoreTableBackticks("b\\`"), "b`");
    assert.equal(restoreTableBackticks("b\\``"), "b``");
    assert.equal(restoreTableBackticks("\\`字面量\\`"), "\\`字面量\\`");
    assert.equal(restoreTableBackticks("`code`"), "`code`");
  });

  test("整表计算列宽后稳定输出，不串入其他单元格内容", () => {
    assert.equal(
      renderMarkdownTable([
        [
          { content: "原文", alignment: null },
          { content: "此列应为空", alignment: null },
          { content: "", alignment: null },
        ],
        [
          { content: "`a \\ | b`", alignment: null },
          { content: "", alignment: null },
          { content: "", alignment: null },
        ],
        [
          { content: "b`", alignment: null },
          { content: "", alignment: null },
          { content: "", alignment: null },
        ],
      ]),
      [
        "| 原文      | 此列应为空 |     |",
        "| --------- | ---------- | --- |",
        "| `a \\ | b` |            |     |",
        "| b`        |            |     |",
      ].join("\n"),
    );
  });

  test("提供原始宽度时分隔行按原样输出，不再拉伸到列宽", () => {
    assert.equal(
      renderMarkdownTable(
        [
          [
            { content: "名称", alignment: "center" },
            { content: "数量", alignment: "right" },
          ],
          [
            { content: "苹果", alignment: "center" },
            { content: "1", alignment: "right" },
          ],
        ],
        [4, 4],
      ),
      [
        "| 名称 | 数量 |",
        "| :----: | ----: |",
        "| 苹果 | 1    |",
      ].join("\n"),
    );
  });

});

describe("Markdown 代码块序列化边界", () => {
  test("围栏长度始终可以包住代码内容", () => {
    assert.equal(createCodeFence("普通代码"), "```");
    assert.equal(createCodeFence("包含 ``` 围栏"), "````");
    assert.equal(createCodeFence("包含 ````` 围栏"), "``````");
  });

  test("准确保留代码内容的尾随换行数量", () => {
    assert.equal(serializeFencedCodeBlock("第一行\n第二行", "text"), "```text\n第一行\n第二行\n```");
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n", ""), "```\n第一行\n第二行\n\n```");
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n\n", ""), "```\n第一行\n第二行\n\n\n```");
  });
});
