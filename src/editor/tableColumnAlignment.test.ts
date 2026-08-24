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

describe("表格列对齐", () => {
  const createTableEditor = (): Editor =>
    new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "",
    });

  const delimiterLine = (editor: Editor): string =>
    editor.storage.markdown.getMarkdown().split("\n")[1] ?? "";

  test("对齐整列并生成对应分隔行", () => {
    const editor = createTableEditor();
    try {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      editor.chain().focus().alignTableColumn("center").run();

      assert.equal(delimiterLine(editor), "| :---: | --- | --- |");
    } finally {
      editor.destroy();
    }
  });

  test("再次点击相同对齐会切回无对齐", () => {
    const editor = createTableEditor();
    try {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      editor.chain().focus().alignTableColumn("center").run();
      editor.chain().focus().alignTableColumn("center").run();

      assert.equal(delimiterLine(editor), "| --- | --- | --- |");
    } finally {
      editor.destroy();
    }
  });

  test("右对齐只修改当前列", () => {
    const editor = createTableEditor();
    try {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      editor.chain().focus().alignTableColumn("right").run();

      assert.equal(delimiterLine(editor), "| ---: | --- | --- |");
    } finally {
      editor.destroy();
    }
  });
});
