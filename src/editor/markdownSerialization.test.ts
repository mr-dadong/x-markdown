import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCodeFence,
  createTableDelimiter,
  escapeTablePipes,
  parseTableAlignment,
  serializeFencedCodeBlock,
} from "./markdownSerialization";

describe("Markdown 表格序列化边界", () => {
  test("保留左中右对齐标记", () => {
    assert.equal(createTableDelimiter(parseTableAlignment("left")), ":---");
    assert.equal(createTableDelimiter(parseTableAlignment("center")), ":---:");
    assert.equal(createTableDelimiter(parseTableAlignment("right")), "---:");
    assert.equal(createTableDelimiter(parseTableAlignment(null)), "---");
  });

  test("只转义尚未转义的表格竖线", () => {
    assert.equal(escapeTablePipes("x|y"), "x\\|y");
    assert.equal(escapeTablePipes("x\\|y"), "x\\|y");
    assert.equal(escapeTablePipes("|x||y|"), "\\|x\\|\\|y\\|");
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
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n", ""), "```\n第一行\n第二行\n```");
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n\n", ""), "```\n第一行\n第二行\n\n```");
  });
});
