import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * `htmlDetails` 节点的导出形态：摘要行只取纯文本，`open` 状态决定是否输出 open 属性。
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

const withEditor = (run: (editor: Editor) => void): void => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: "",
    contentType: "markdown",
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
};

const insertDetails = (editor: Editor, attrs: Record<string, unknown>): void => {
  editor.commands.insertContent({
    type: "htmlDetails",
    attrs,
    content: [{ type: "paragraph", content: [{ type: "text", text: "面板内容" }] }],
  });
};

describe("htmlDetails 节点", () => {
  test("导出 details / summary 结构并保留 open", () => {
    withEditor((editor) => {
      insertDetails(editor, {
        summarySource: "<summary><b>完整特性</b></summary>",
        open: true,
      });

      const html = editor.getHTML();
      assert.match(html, /<details[^>]*open/u);
      // 摘要按纯文本输出：行内标签只存在于源码，不进入导出 HTML。
      assert.match(html, /<summary>完整特性<\/summary>/u);
      assert.match(html, /<p>面板内容<\/p>/u);
    });
  });

  test("没有 open 时不输出 open 属性", () => {
    withEditor((editor) => {
      insertDetails(editor, { summarySource: "<summary>安装说明</summary>" });

      assert.doesNotMatch(editor.getHTML(), /\sopen/u);
      assert.match(editor.getHTML(), /<summary>安装说明<\/summary>/u);
    });
  });
});
