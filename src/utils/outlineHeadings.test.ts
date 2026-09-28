import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findActiveHeadingByLine, scanOutlineHeadings } from "./outlineHeadings";

/*
 * 大纲标题扫描是大纲面板、点击跳转和“当前标题高亮”共用的顺序来源：
 * 扫描结果必须与解析器认出的标题节点一致，否则跳转与高亮都会整体错位。
 */

describe("扫描 Markdown 标题", () => {
  test("ATX 标题按出现顺序返回行号、级别与可见文字", () => {
    const headings = scanOutlineHeadings("# 一级\n\n正文\n\n### 三级 **加粗**\n");

    assert.deepEqual(headings, [
      { line: 0, level: 1, text: "一级" },
      { line: 4, level: 3, text: "三级 加粗" },
    ]);
  });

  test("下划线式标题也算标题（解析器同样会把它变成标题节点）", () => {
    const headings = scanOutlineHeadings("一级标题\n====\n\n正文\n\n二级标题\n----\n");

    assert.deepEqual(headings, [
      { line: 0, level: 1, text: "一级标题" },
      { line: 5, level: 2, text: "二级标题" },
    ]);
  });

  test("代码围栏里的 # 不是标题，闭合的那组 # 不算正文", () => {
    const headings = scanOutlineHeadings(
      "```shell\n# 这是注释\n```\n\n## 真标题 ##\n\n~~~\n# 也不是标题\n~~~\n\n# 尾部标题\n",
    );

    assert.deepEqual(headings, [
      { line: 4, level: 2, text: "真标题" },
      { line: 10, level: 1, text: "尾部标题" },
    ]);
  });

  test("水平线不会被当成下划线式标题", () => {
    // 空行后的 --- 是水平线；列表项后的 --- 也不是 setext 下划线
    const headings = scanOutlineHeadings("正文\n\n---\n\n- 列表项\n---\n");

    assert.deepEqual(headings, []);
  });

  test("CRLF 换行不影响行号", () => {
    const headings = scanOutlineHeadings("# 一级\r\n\r\n正文\r\n\r\n## 二级\r\n");

    assert.deepEqual(headings, [
      { line: 0, level: 1, text: "一级" },
      { line: 4, level: 2, text: "二级" },
    ]);
  });
});

describe("按光标行匹配当前标题", () => {
  const headings = [
    { line: 0, level: 1, text: "一级" },
    { line: 5, level: 2, text: "二级" },
    { line: 9, level: 1, text: "下一章" },
  ];

  test("取不晚于光标行的最后一个标题", () => {
    assert.equal(findActiveHeadingByLine(headings, 0), 0, "光标在第一个标题行");
    assert.equal(findActiveHeadingByLine(headings, 3), 0, "光标在标题之间的正文里");
    assert.equal(findActiveHeadingByLine(headings, 5), 1, "光标在第二个标题行");
    assert.equal(findActiveHeadingByLine(headings, 20), 2, "光标在最后一个标题之后");
  });

  test("光标在第一个标题之前时没有当前标题", () => {
    assert.equal(findActiveHeadingByLine(headings, -1), -1);
    assert.equal(findActiveHeadingByLine([], 3), -1);
  });
});
