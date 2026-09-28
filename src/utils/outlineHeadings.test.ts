import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { findActiveHeadingByLine, scanOutlineHeadings } from "./outlineHeadings";
import { collectAllHeadings } from "../modules/writerContext";

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

  test("块级公式里的 # 不是标题", () => {
    // 公式内部以 # 开头的行若被算成标题，大纲会凭空多一条、后续下标整体后移。
    const headings = scanOutlineHeadings(
      "# 真标题\n\n$$\n# 公式里的\nx = 1\n$$\n\n## 二级标题\n",
    );

    assert.deepEqual(headings, [
      { line: 0, level: 1, text: "真标题" },
      { line: 7, level: 2, text: "二级标题" },
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

/*
 * 高亮靠「下标」把左侧大纲与右侧编辑器对应起来：大纲按源码扫描，
 * 编辑器按文档节点取光标位置。两条路径的顺序一旦错开，高亮的就不是正在看的那条。
 */
describe("大纲下标在两条路径上保持一致", () => {
  let browserWindow: Window;
  let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
  let EditorConstructor: typeof import("@tiptap/core").Editor;

  before(async () => {
    browserWindow = installDomEnvironment();
    ({ Editor: EditorConstructor } = await import("@tiptap/core"));
    ({ createEditorExtensions } = await import("../editor/editorExtensions"));
  });

  after(async () => {
    await browserWindow.happyDOM.abort();
  });

  const readHeadings = async (
    markdown: string,
  ): Promise<{ fromSource: string[]; fromDoc: string[] }> => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: markdown,
      contentType: "markdown",
    });
    // 文档创建是异步派发的，序列化包装在此时安装。
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fromSource = scanOutlineHeadings(markdown).map(
      (heading) => `h${heading.level}:${heading.text}`,
    );
    const fromDoc = collectAllHeadings(editor.state.doc).map(
      (heading) => `h${heading.level}:${heading.text}`,
    );
    editor.destroy();
    return { fromSource, fromDoc };
  };

  const CONSISTENT_SAMPLES: Array<{ name: string; markdown: string }> = [
    { name: "普通 ATX 标题", markdown: "# 一级\n\n正文\n\n## 二级\n" },
    { name: "下划线式标题", markdown: "一级\n===\n\n正文\n\n二级\n---\n" },
    { name: "标题带行内格式", markdown: "# **粗体**标题\n\n## 含 `代码` 的标题\n" },
    { name: "列表项里的标题", markdown: "- 列表项\n\n  # 列表里的标题\n\n正文\n" },
    { name: "任务列表里的标题", markdown: "- [ ] 事项\n\n  # 任务里的标题\n" },
    { name: "代码块里的井号", markdown: "# 真标题\n\n```\n# 不是标题\n```\n" },
    { name: "水平线不是标题", markdown: "# 真标题\n\n---\n\n正文\n" },
    { name: "缩进四格的井号", markdown: "# 真标题\n\n    # 代码里的\n" },
    { name: "标题带闭合井号", markdown: "# 标题 ##\n\n## 二级 #\n" },
    { name: "重复标题文字", markdown: "# 重复\n\n## 重复\n" },
    { name: "CRLF 换行", markdown: "# 一级\r\n\r\n## 二级\r\n" },
    { name: "标题后紧跟正文", markdown: "# 标题\n正文\n\n## 二级\n" },
    {
      name: "数学块里的井号行",
      markdown: "# 真标题\n\n$$\n# 公式里的\n$$\n\n## 二级标题\n",
    },
    {
      name: "div 块里的井号行",
      markdown: "# 真标题\n\n<div>\n# 藏在 html 里\n</div>\n\n## 二级标题\n",
    },
    {
      name: "div 块到空行为止（闭合标签不结束块）",
      markdown: "<div>内容</div>\n# 仍在 html 块里\n\n## 真标题\n",
    },
    {
      name: "HTML 注释里的井号行",
      markdown: "# 真标题\n\n<!--\n# 注释里的\n-->\n\n## 二级标题\n",
    },
    {
      name: "script 块里的井号行",
      markdown: "# 真标题\n\n<script>\n# 脚本里的\n</script>\n\n## 二级标题\n",
    },
    {
      name: "表格块里的井号行",
      markdown: "# 真标题\n\n<table>\n<tr><td>\n# 单元格里的\n</td></tr>\n</table>\n\n## 二级标题\n",
    },
  ];

  for (const sample of CONSISTENT_SAMPLES) {
    test(`${sample.name}：两条路径给出同一份标题序列`, async () => {
      const { fromSource, fromDoc } = await readHeadings(sample.markdown);

      assert.deepEqual(
        fromDoc,
        fromSource,
        "标题序列不一致会让大纲高亮整体错位",
      );
    });
  }

  test("嵌套标题按文档顺序参与下标计算（旧实现会漏掉它导致错位）", async () => {
    const { fromDoc } = await readHeadings(
      "# 顶层一\n\n- 列表项\n\n  # 嵌套标题\n\n## 顶层二\n",
    );

    assert.deepEqual(fromDoc, ["h1:顶层一", "h1:嵌套标题", "h2:顶层二"]);
  });
});
