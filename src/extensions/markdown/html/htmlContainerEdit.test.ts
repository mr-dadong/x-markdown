import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * 容器内的编辑：子块可以插入、删除，光标与选区在容器内部移动，写回 Markdown 时
 * 子块始终包在开/闭标签之间。
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

const CONTAINER = [
  '<div align="center">',
  "",
  "第一段",
  "",
  "第二段",
  "",
  "</div>",
  "",
  "后续段落",
].join("\n");

const withEditor = (run: (editor: Editor) => void): void => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: CONTAINER,
    contentType: "markdown",
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
};

test("在容器内容末尾插入子块，写回仍包在容器里", () => {
  withEditor((editor) => {
    const container = editor.state.doc.child(0);
    // 容器内容从文档位置 1 开始；在内容末尾插入即成为最后一个子块。
    editor.commands.insertContentAt(container.nodeSize - 1, {
      type: "paragraph",
      content: [{ type: "text", text: "新增段" }],
    });

    const updated = editor.state.doc.child(0);
    assert.equal(updated.type.name, "htmlContainer");
    assert.equal(updated.childCount, 3);
    assert.equal(updated.child(2).textContent, "新增段");

    const markdown = editor.getMarkdown();
    assert.match(markdown, /<div align="center">\n\n第一段\n\n第二段\n\n新增段\n\n<\/div>/u);
  });
});

test("删除容器内的最后一个子块，闭标签仍然跟在内容后面", () => {
  withEditor((editor) => {
    const container = editor.state.doc.child(0);
    const last = container.child(container.childCount - 1);
    const from = container.nodeSize - 1 - last.nodeSize;
    editor.commands.deleteRange({ from, to: from + last.nodeSize });

    const updated = editor.state.doc.child(0);
    assert.equal(updated.type.name, "htmlContainer");
    assert.equal(updated.textContent, "第一段");

    const markdown = editor.getMarkdown();
    assert.match(markdown, /<div align="center">\n\n第一段\n\n<\/div>/u);
    assert.doesNotMatch(markdown, /第二段/u);
  });
});

test("光标可以停在容器内的子块里", () => {
  withEditor((editor) => {
    const container = editor.state.doc.child(0);
    const second = container.child(1);
    // 第二个子块在文档里的起始位置：容器内容起点 1 + 第一个子块占用的长度。
    const position = 1 + container.child(0).nodeSize + 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position + 1)),
    );

    const {$from} = editor.state.selection;
    assert.equal($from.node(1).type.name, "htmlContainer");
    assert.equal($from.parent.textContent, "第二段");
    assert.ok(second.nodeSize > 0);
  });
});
