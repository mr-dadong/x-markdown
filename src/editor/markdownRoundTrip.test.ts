import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("./editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const roundTrip = (markdown: string): string => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
  });
  try {
    return editor.storage.markdown.getMarkdown();
  } finally {
    editor.destroy();
  }
};

interface MarkdownFixture {
  name: string;
  markdown: string;
  expectedFragments: string[];
}

const fixtures: MarkdownFixture[] = [
  {
    name: "基础块、行内格式和链接",
    markdown: [
      "# 一级标题",
      "",
      "正文包含 **粗体**、*斜体*、~~删除线~~、==高亮==、`行内代码` 和 [链接](https://example.com \"示例\")。",
      "",
      "> 引用内容",
      "",
      "---",
    ].join("\n"),
    expectedFragments: ["# 一级标题", "**粗体**", "~~删除线~~", "==高亮==", "`行内代码`", "[链接](https://example.com \"示例\")", "> 引用内容"],
  },
  {
    name: "嵌套列表、任务列表和硬换行",
    markdown: [
      "- 第一项",
      "  - 子项",
      "- [x] 已完成",
      "- [ ] 未完成",
      "",
      "第一行  ",
      "第二行",
    ].join("\n"),
    expectedFragments: ["- 第一项", "  - 子项", "[x] 已完成", "[ ] 未完成", "第一行"],
  },
  {
    name: "表格、代码围栏和代码中的竖线",
    markdown: [
      "| 名称 | 表达式 |",
      "| :--- | ---: |",
      "| 示例 | `a | b` |",
      "",
      "````typescript",
      "const fence = ```;",
      "console.log('a | b');",
      "````",
    ].join("\n"),
    expectedFragments: ["| 名称", "`a | b`", "````typescript", "const fence = ```;"],
  },
  {
    name: "表格分隔行宽度保存后不被改写",
    markdown: [
      "| 名称 | 数量 |",
      "| :----: | -----: |",
      "| 苹果 | 1 |",
      "",
      "| A | B |",
      "| ------ | :----: |",
      "| 内容更长一些 | b |",
    ].join("\n"),
    expectedFragments: ["| :----: | -----: |", "| ------ | :----: |"],
  },
  {
    name: "公式、Mermaid、脚注和目录",
    markdown: [
      "[TOC]",
      "",
      "行内公式 $E = mc^2$。",
      "",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "带脚注的文字[^note]。",
      "",
      "[^note]: 脚注内容",
    ].join("\n"),
    expectedFragments: ["[TOC]", "$E = mc^2$", "\\int_0^1 x^2 dx", "```mermaid", "带脚注的文字[^note]。", "[^note]: 脚注内容"],
  },
  {
    name: "Callout、HTML 和图片尺寸",
    markdown: [
      "> [!NOTE]- 标题",
      "> 第一行",
      "> 第二行",
      "",
      '<section data-kind="demo"><strong>HTML 内容</strong></section>',
      "",
      '<img src="./images/demo.png" alt="示例" title="图片" width="320">',
    ].join("\n"),
    expectedFragments: ["[!NOTE]- 标题", "第一行", "<section", "HTML 内容", "./images/demo.png", 'width="320"'],
  },
  {
    name: "下标和上标",
    markdown: [
      "水的化学式是 H<sub>2</sub>O，质能方程是 E = mc<sup>2</sup>。",
    ].join("\n"),
    expectedFragments: ["H<sub>2</sub>O", "E = mc<sup>2</sup>"],
  },
  {
    name: "YAML Front Matter 和未知扩展原样保存",
    markdown: [
      "---",
      "title: 测试文档",
      "tags:",
      "  - markdown",
      "---",
      "",
      ":::custom key=value",
      "扩展正文 **不得被改写**",
      ":::",
      "",
      "Wiki 链接 [[目标文档#章节]]",
    ].join("\n"),
    expectedFragments: ["title: 测试文档", ":::custom key=value", "扩展正文 **不得被改写**", "[[目标文档#章节]]"],
  },
];

describe("Markdown 完整往返", () => {
  for (const fixture of fixtures) {
    test(`${fixture.name}在首次规范化后保持稳定`, () => {
      const first = roundTrip(fixture.markdown);
      const second = roundTrip(first);

      assert.equal(second, first, `第二次往返仍改变了 Markdown：\n${first}\n---\n${second}`);
      for (const fragment of fixture.expectedFragments) {
        assert.ok(first.includes(fragment), `往返后缺少关键内容：${fragment}\n${first}`);
      }
    });
  }
});
