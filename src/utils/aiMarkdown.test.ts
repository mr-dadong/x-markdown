import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeAiMarkdown } from "./aiMarkdown";

describe("normalizeAiMarkdown", () => {
  test("还原加粗标记的过度转义", () => {
    assert.equal(normalizeAiMarkdown("\\*\\*2\\*\\*"), "**2**");
    assert.equal(normalizeAiMarkdown("这是\\*\\*重点\\*\\*内容"), "这是**重点**内容");
  });

  test("还原斜体 / 删除线 / 行内代码 / 标题 / 列表的过度转义", () => {
    assert.equal(normalizeAiMarkdown("*\\~150M*"), "*~150M*");
    assert.equal(normalizeAiMarkdown("\\_斜体\\_"), "_斜体_");
    assert.equal(normalizeAiMarkdown("\\~\\~删除\\~\\~"), "~~删除~~");
    assert.equal(normalizeAiMarkdown("\\# 标题"), "# 标题");
    assert.equal(normalizeAiMarkdown("\\- 列表项"), "- 列表项");
  });

  test("行内代码中的内容保持原样", () => {
    assert.equal(normalizeAiMarkdown("使用 `\\*\\*bold\\*\\*` 语法"), "使用 `\\*\\*bold\\*\\*` 语法");
  });

  test("围栏代码块中的内容保持原样", () => {
    const source = "示例：\n```md\n\\*\\*2\\*\\*\n```\n结束 \\- 说明";
    assert.equal(normalizeAiMarkdown(source), "示例：\n```md\n\\*\\*2\\*\\*\n```\n结束 - 说明");
  });

  test("普通文本与合法转义不受影响", () => {
    assert.equal(normalizeAiMarkdown("C:\\code\\nb"), "C:\\code\\nb");
    assert.equal(normalizeAiMarkdown("LaTeX \\(x\\) 与 \\[y\\] 不变"), "LaTeX \\(x\\) 与 \\[y\\] 不变");
    assert.equal(normalizeAiMarkdown("无转义文本 **加粗** 正常"), "无转义文本 **加粗** 正常");
    assert.equal(normalizeAiMarkdown(""), "");
  });
});
