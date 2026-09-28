import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * 分页符：与 Typora 一致，用一段独占一行的 HTML 表达分页。
 * 它既要能原样写回源码，又要在编辑区显示可见标记（节点视图），
 * 导出时输出真正参与打印的分页元素。
 */

const PAGE_BREAK_HTML = '<div style="page-break-after: always"></div>';

let browserWindow: Window;
let createEditorExtensions: typeof import("../../../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;
let readPageBreakStyle: typeof import("./PageBreak").readPageBreakStyle;

before(async () => {
  browserWindow = installDomEnvironment();
  (browserWindow as unknown as { electronAPI: unknown }).electronAPI = {
    readEditorImage: async (url: string) => url,
    readEditorFileBytes: async () => new Uint8Array(),
    onAttachmentCopyProgress: () => () => {},
    getPathForFile: () => "",
  };
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../../../editor/editorExtensions"));
  ({ readPageBreakStyle } = await import("./PageBreak"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const withEditor = async <T>(
  markdown: string,
  run: (editor: Editor) => T,
): Promise<T> => {
  const editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    return run(editor);
  } finally {
    editor.destroy();
  }
};

describe("分页符的写法识别", () => {
  test("双引号、单引号与省略引号都算分页符", () => {
    assert.equal(readPageBreakStyle(PAGE_BREAK_HTML), "page-break-after: always");
    assert.equal(
      readPageBreakStyle("<div style='page-break-before:always'></div>"),
      "page-break-before:always",
    );
    assert.equal(
      readPageBreakStyle('<div style="page-break-after: always;"></div>'),
      "page-break-after: always;",
    );
  });

  test("带有其它声明的分页符同样识别，声明原样保留", () => {
    assert.equal(
      readPageBreakStyle('<div style="color: red; page-break-after: always"></div>'),
      "color: red; page-break-after: always",
    );
  });

  test("普通 HTML 不是分页符", () => {
    assert.equal(readPageBreakStyle('<div style="color: red"></div>'), null);
    assert.equal(readPageBreakStyle("<div>内容</div>"), null);
    assert.equal(readPageBreakStyle('<div style="page-break-after: auto"></div>'), null);
    assert.equal(readPageBreakStyle('<p style="page-break-after: always">文字</p>'), null);
  });
});

describe("分页符在文档里的表现", () => {
  test("解析成独立节点，源码逐字写回", async () => {
    const result = await withEditor(`前言。\n\n${PAGE_BREAK_HTML}\n\n正文。\n`, (editor) => {
      const types: string[] = [];
      editor.state.doc.forEach((child) => types.push(child.type.name));
      return { types, markdown: editor.getMarkdown() };
    });

    assert.deepEqual(result.types, ["paragraph", "pageBreak", "paragraph"]);
    assert.equal(
      result.markdown,
      `前言。\n\n${PAGE_BREAK_HTML}\n\n正文。`,
      "分页符必须原样写回，不能被改写成别的形式",
    );
  });

  test("带其它声明的写法也原样写回", async () => {
    const source = '<div style="color: red; page-break-after: always"></div>';
    const markdown = await withEditor(`${source}\n`, (editor) => editor.getMarkdown());

    assert.equal(markdown, source);
  });
});
