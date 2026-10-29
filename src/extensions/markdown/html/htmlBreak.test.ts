import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * `htmlBreak` 节点：编辑器里是间距块，不出现字面 `<br />`；写回 Markdown 时保留原写法。
 * 从 Markdown 解析出该节点由后续的解析用例覆盖。
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

describe("htmlBreak 节点", () => {
  test("导出为间距块，不出现字面 br 源码", () => {
    withEditor((editor) => {
      editor.commands.insertContent({ type: "htmlBreak" });

      const html = editor.getHTML();
      assert.match(html, /data-xmd-html-break/u);
      assert.doesNotMatch(html, /&lt;br/u);
    });
  });

  test("写回 Markdown 时保留原标签", () => {
    withEditor((editor) => {
      editor.commands.insertContent({ type: "htmlBreak", attrs: { source: "<br>" } });

      assert.match(editor.getMarkdown(), /<br>/u);
    });
  });
});
