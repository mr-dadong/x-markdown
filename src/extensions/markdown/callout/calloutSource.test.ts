import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calloutToMarkdown } from "./calloutSource";

describe("calloutToMarkdown", () => {
  test("生成 > 引用块格式", () => {
    const markdown = calloutToMarkdown({
      calloutType: "TIP",
      fold: "+",
      title: "提示",
      body: "第一行\n第二行",
    });
    assert.equal(markdown, "> [!TIP]+ 提示\n> 第一行\n> 第二行");
  });

  test("空行正文用单独的 > 占位", () => {
    const markdown = calloutToMarkdown({
      calloutType: "NOTE",
      fold: "",
      title: "",
      body: "第一行\n\n第二行",
    });
    assert.equal(markdown, "> [!NOTE]\n> 第一行\n>\n> 第二行");
  });

  test("标题为空时不写标题", () => {
    const markdown = calloutToMarkdown({
      calloutType: "WARNING",
      fold: "-",
      title: "",
      body: "正文",
    });
    assert.equal(markdown, "> [!WARNING]-\n> 正文");
  });

  test("fold 只接受 + 与 -，其余视为不折叠", () => {
    const markdown = calloutToMarkdown({
      calloutType: "NOTE",
      fold: "x",
      title: "标题",
      body: "",
    });
    assert.equal(markdown, "> [!NOTE] 标题");
  });
});
