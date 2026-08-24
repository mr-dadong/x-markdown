import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import {
  getCellContentEndPosition,
  handleTableSelectAll,
} from "./tableInteraction";

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

const findCell = (doc: Editor["state"]["doc"], cellText: string): number | null => {
  let target: number | null = null;
  doc.descendants((node, pos) => {
    if (target === null && node.type.name === "tableCell" && node.textContent === cellText) {
      target = pos;
      return false;
    }
    return true;
  });
  return target;
};

const ctrlA = (): KeyboardEvent =>
  ({
    key: "a",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
  }) as unknown as KeyboardEvent;

describe("表格 Ctrl+A 交互", () => {
  test("表格内 Ctrl+A 只选中当前单元格内容", () => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "表格前的段落\n\n| 表头A | 表头B |\n| --- | --- |\n| a1 a2 | b1 |\n\n表格后的段落",
    });
    try {
      const cellStart = findCell(editor.state.doc, "a1 a2");
      assert.notEqual(cellStart, null);

      // 光标放到该单元格文本中间。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, (cellStart ?? 0) + 2 + 2),
        ),
      );

      const handled = handleTableSelectAll(editor.view, ctrlA());
      assert.equal(handled, true);

      const selection = editor.state.selection;
      assert.ok(selection instanceof TextSelection);
      // 只选中这一格内容，不包含前后段落或其它单元格。
      const selected = editor.state.doc.textBetween(selection.from, selection.to);
      assert.equal(selected, "a1 a2");
    } finally {
      editor.destroy();
    }
  });

  test("表格外 Ctrl+A 不拦截，交给默认行为", () => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "普通段落",
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
      );
      assert.equal(handleTableSelectAll(editor.view, ctrlA()), false);
    } finally {
      editor.destroy();
    }
  });
});

describe("表格单元格内粘贴追加", () => {
  test("在已有内容的单元格末尾插入不会覆盖原内容", () => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "| 表头A | 表头B |\n| --- | --- |\n| a1 | b1 |",
    });
    try {
      const cellStart = findCell(editor.state.doc, "a1");
      assert.notEqual(cellStart, null);
      // 光标放到已有内容中间。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, (cellStart ?? 0) + 2),
        ),
      );

      const endPosition = getCellContentEndPosition(editor.state.selection);
      assert.notEqual(endPosition, null);
      editor.chain().focus().insertContentAt(endPosition!, "追加").run();

      const markdown = editor.storage.markdown.getMarkdown();
      // 原内容仍然保留，新内容追加在其后。
      assert.match(markdown, /\| a1追加\s+\| b1\s+\|/u);
    } finally {
      editor.destroy();
    }
  });

  test("光标不在单元格内时返回 null", () => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "普通段落\n\n| 表头 |\n| --- |\n| 值 |",
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
      );
      assert.equal(getCellContentEndPosition(editor.state.selection), null);
    } finally {
      editor.destroy();
    }
  });
});
