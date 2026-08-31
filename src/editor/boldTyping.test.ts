import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { normalizeAiMarkdown } from "../utils/aiMarkdown";

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

const createEditor = (): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: "",
  });

/** 逐字符模拟真实键入：先走 input rules，未命中再插入纯文本。 */
const typeText = (editor: Editor, text: string): void => {
  for (const ch of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
};

const docHasBoldMark = (editor: Editor): boolean => {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.marks.some((m) => m.type.name === "bold")) found = true;
  });
  return found;
};

test("逐字键入 **2** 应触发加粗输入规则", () => {
  const editor = createEditor();
  try {
    typeText(editor, "**2**");
    assert.equal(
      docHasBoldMark(editor),
      true,
      `应产生加粗标记，实际文档：${JSON.stringify(editor.state.doc.toJSON())}`,
    );
    assert.equal(editor.state.doc.textContent, "2");
  } finally {
    editor.destroy();
  }
});

test("insertContentAt 传入 **2** 应按 Markdown 解析为加粗", () => {
  const editor = createEditor();
  try {
    editor.commands.insertContentAt(1, "**2**");
    assert.equal(
      docHasBoldMark(editor),
      true,
      `应产生加粗标记，实际文档：${JSON.stringify(editor.state.doc.toJSON())}`,
    );
    assert.equal(editor.state.doc.textContent, "2");
  } finally {
    editor.destroy();
  }
});

test("内联 AI 接受结果路径（deleteRange + insertContentAt）应解析 Markdown", () => {
  const editor = createEditor();
  try {
    editor.commands.setContent("故障转移的完整过程");
    // 全选正文，模拟选区被 AI 结果替换
    const { from, to } = { from: 1, to: editor.state.doc.content.size - 1 };
    editor.commands.setTextSelection({ from, to });
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, "**故障转移（failover）**的完整过程。**2**")
      .run();
    assert.equal(
      docHasBoldMark(editor),
      true,
      `AI 结果中的 **加粗** 应解析为加粗标记，实际文档：${JSON.stringify(editor.state.doc.toJSON())}`,
    );
  } finally {
    editor.destroy();
  }
});

test("过度转义的 \\*\\*2\\*\\* 不会产生加粗（复现模型输出问题）", () => {
  const editor = createEditor();
  try {
    // 部分模型会输出 \*\*加粗\*\* 这样的过度转义文本，
    // CommonMark 把 \* 解析为字面星号，因此不会有加粗标记
    editor.commands.insertContentAt(1, "\\*\\*2\\*\\*");
    assert.equal(
      docHasBoldMark(editor),
      false,
      "字面星号不应产生加粗标记，这正是归一化要解决的问题",
    );
  } finally {
    editor.destroy();
  }
});

test("归一化后的 \\*\\*2\\*\\* 应解析为加粗", () => {
  const editor = createEditor();
  try {
    editor.commands.insertContentAt(1, normalizeAiMarkdown("\\*\\*2\\*\\*"));
    assert.equal(
      docHasBoldMark(editor),
      true,
      `归一化后应产生加粗标记，实际文档：${JSON.stringify(editor.state.doc.toJSON())}`,
    );
    assert.equal(editor.state.doc.textContent, "2");
  } finally {
    editor.destroy();
  }
});
