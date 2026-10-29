import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";
import { scanOutlineHeadings } from "../../../utils/outlineHeadings";

/*
 * 独占一段的 HTML 标题：认领成真正的 heading 节点，写回时仍是原来的单行标签。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("../../../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../../../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const withEditor = (markdown: string, run: (editor: Editor) => void): void => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
};

describe("HTML 标题", () => {
  test("<h1> 解析为一级标题并写回原标签", () => {
    withEditor("<h1>XMD</h1>\n", (editor) => {
      const heading = editor.state.doc.child(0);
      assert.equal(heading.type.name, "heading");
      assert.equal(heading.attrs.level, 1);
      assert.equal(heading.textContent, "XMD");
      assert.equal(editor.getMarkdown().trim(), "<h1>XMD</h1>");
    });
  });

  test("层级与属性原样保留", () => {
    withEditor('<h3 id="anchor">锚点标题</h3>\n', (editor) => {
      const heading = editor.state.doc.child(0);
      assert.equal(heading.attrs.level, 3);
      assert.equal(editor.getMarkdown().trim(), '<h3 id="anchor">锚点标题</h3>');
    });
  });

  test("行内格式按行内 Markdown 解析", () => {
    withEditor("<h2>带 **粗体** 的标题</h2>\n", (editor) => {
      const heading = editor.state.doc.child(0);
      assert.equal(heading.type.name, "heading");
      assert.equal(heading.textContent, "带 粗体 的标题");
      assert.equal(editor.getMarkdown().trim(), "<h2>带 **粗体** 的标题</h2>");
    });
  });

  test("HTML 标题不进入大纲（大纲仍按 Markdown 源码扫描）", () => {
    assert.deepEqual(scanOutlineHeadings("<h1>XMD</h1>\n\n正文\n"), []);
  });
});
