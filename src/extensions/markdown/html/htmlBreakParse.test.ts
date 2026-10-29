import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * 独占一行的 `<br />`：解析为间距节点，写回保留用户写法（三种写法都覆盖）。
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

describe("独立 <br /> 的解析", () => {
  for (const source of ["<br />", "<br>", "<br/>"]) {
    test(`独占一段的 ${source} 解析为间距节点并原样写回`, () => {
      const markdown = ["第一段", "", source, "", "第二段", ""].join("\n");
      withEditor(markdown, (editor) => {
        const types: string[] = [];
        editor.state.doc.forEach((node) => types.push(node.type.name));
        assert.deepEqual(types, ["paragraph", "htmlBreak", "paragraph"]);

        const written = editor.getMarkdown();
        assert.match(written, new RegExp(`\\n${source.replace(/[/]/gu, "\\/")}\\n`, "u"));
      });
    });
  }

  test("行内出现的 <br /> 不单独成块", () => {
    withEditor("文字<br />更多文字\n", (editor) => {
      const types: string[] = [];
      editor.state.doc.forEach((node) => types.push(node.type.name));
      assert.deepEqual(types, ["paragraph"]);
    });
  });
});
