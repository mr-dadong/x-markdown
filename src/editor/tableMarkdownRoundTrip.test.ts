import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/**
 * 表格 Markdown 往返的回归测试。
 *
 * 覆盖三件官方实现不满足、必须由项目保证的行为：
 * 1. 单元格里的字面竖线必须转义，否则存盘后整格被拆成多列（官方渲染不转义）；
 * 2. 列宽按显示宽度计算，中文单元格才能与分隔行对齐（官方按 UTF-16 长度算）；
 * 3. Typora 允许行内代码里的竖线不转义，用户手写的风格要原样保留。
 */

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

/** TipTap 的 create 事件是 setTimeout 异步派发的，转义覆盖在此时安装。 */
const waitForCreate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

/** 建编辑器 → 执行断言 → 销毁，避免测试之间互相影响。 */
const withEditor = async <T>(
  content: unknown,
  isMarkdown: boolean,
  run: (editor: Editor) => T,
): Promise<T> => {
  const editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: content as never,
    ...(isMarkdown ? { contentType: "markdown" } : {}),
  });
  await waitForCreate();
  try {
    return run(editor);
  } finally {
    editor.destroy();
  }
};

/** 表格单元格：内部固定放一个段落，与编辑器里的真实结构一致。 */
const cell = (type: string, text: string) => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** 两列表格文档：第一行是表头，第二行是正文。 */
const twoColumnTable = (header: string[], body: string[]) => ({
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        { type: "tableRow", content: header.map((value) => cell("tableHeader", value)) },
        { type: "tableRow", content: body.map((value) => cell("tableCell", value)) },
      ],
    },
  ],
});

/** 读出文档里第一张表格的行列文本与各单元格对齐，用于比对往返结果。 */
const readTable = (editor: Editor): { rows: string[][]; aligns: Array<string | null> } => {
  const rows: string[][] = [];
  const aligns: Array<string | null> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((tableCell) => {
        cells.push(tableCell.textContent);
        aligns.push(tableCell.attrs.align ?? null);
      });
      rows.push(cells);
    });
    return false;
  });
  return { rows, aligns };
};

/** 序列化后再重新解析，返回新文档里的表格。 */
const roundTrip = async (doc: unknown): Promise<{ markdown: string; rows: string[][] }> => {
  const markdown = await withEditor(doc, false, (editor) => editor.getMarkdown());
  const rows = await withEditor(markdown, true, (editor) => readTable(editor).rows);
  return { markdown, rows };
};

describe("表格 Markdown 往返", () => {
  test("单元格里的字面竖线被转义，往返后仍是同一格", async () => {
    const { markdown, rows } = await roundTrip(twoColumnTable(["列1", "列2"], ["a|b", "c"]));

    assert.ok(markdown.includes("a\\|b"), `竖线应被转义，实际输出：${markdown}`);
    assert.deepEqual(rows, [["列1", "列2"], ["a|b", "c"]]);
  });

  test("普通文本里的成对反引号不会被当成代码跨度，其中的竖线照常转义", async () => {
    const { markdown, rows } = await roundTrip(twoColumnTable(["列1", "列2"], ["`a|b`", "c"]));

    // 反引号是字面字符，会被最小转义规则写成 \`，竖线必须一并转义
    assert.ok(markdown.includes("\\`a\\|b\\`"), `实际输出：${markdown}`);
    assert.deepEqual(rows, [["列1", "列2"], ["`a|b`", "c"]]);
  });

  test("列宽按显示宽度计算，中文单元格与分隔行对齐", async () => {
    const source = "| 名称 | 值 |\n| ------------ | --- |\n| 中文内容很长 | x |\n";
    const markdown = await withEditor(source, true, (editor) => editor.getMarkdown());

    assert.equal(
      markdown,
      "| 名称         | 值  |\n| ------------ | --- |\n| 中文内容很长 | x   |",
    );
  });

  test("对齐标记往返，并落在官方的 align 属性上", async () => {
    const source = "| 名称 | 数量 |\n| :---: | ---: |\n| 苹果 | 1 |\n";
    const { aligns, delimiterLine } = await withEditor(source, true, (editor) => ({
      aligns: readTable(editor).aligns,
      delimiterLine: editor.getMarkdown().split("\n")[1] ?? "",
    }));

    assert.deepEqual(aligns, ["center", "right", "center", "right"]);
    // 手写的分隔行宽度与冒号位置原样保留
    assert.equal(delimiterLine, "| :---: | ---: |");
  });

  test("Typora 风格：原文已转义的代码跨度竖线，保存时保持转义", async () => {
    const source = "| 列1 | 列2 |\n| --- | --- |\n| `a\\|b` | c |\n";
    const markdown = await withEditor(source, true, (editor) => editor.getMarkdown());

    assert.ok(markdown.includes("`a\\|b`"), `实际输出：${markdown}`);
  });

  test("Typora 风格：原文未转义的代码跨度竖线，保存时保持不转义且能回读", async () => {
    const source = "| 列1 | 列2 |\n| --- | --- |\n| `a|b` | c |\n";
    const markdown = await withEditor(source, true, (editor) => editor.getMarkdown());
    assert.ok(markdown.includes("`a|b`"), `实际输出：${markdown}`);

    const rows = await withEditor(markdown, true, (editor) => readTable(editor).rows);
    assert.deepEqual(rows, [["列1", "列2"], ["a|b", "c"]]);
  });
});
