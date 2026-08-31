import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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

const createEditor = (): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: "",
  });

/** TipTap 的 create 事件是 setTimeout 异步派发的，序列化包装在此时安装。 */
const waitForCreate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

/** 逐字符模拟真实键入：先走 input rules，未命中再插入纯文本。 */
const typeText = (editor: Editor, text: string): void => {
  for (const ch of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
};

test("数字间输入 * → Typography 扩展替换为乘号 ×", () => {
  const editor = createEditor();
  try {
    typeText(editor, "价格是 5 * 3 = 15");
    // @tiptap/extension-typography 的 multiplication 规则：/\d+\s?[*x]\s?\d+$/
    assert.equal(editor.state.doc.textContent, "价格是 5 × 3 = 15");
  } finally {
    editor.destroy();
  }
});

test("逐字输入 2*3*4 → Typography 抢先把 * 变乘号，不存在斜体歧义", () => {
  const editor = createEditor();
  try {
    typeText(editor, "2*3*4");
    let hasItalic = false;
    editor.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "italic")) hasItalic = true;
    });
    // 数字间的 * 被 multiplication 规则替换为乘号，从根上消除了斜体歧义
    assert.equal(hasItalic, false, "不存在斜体标记");
    assert.equal(editor.state.doc.textContent, "2×3×4");
    assert.equal(editor.storage.markdown.getMarkdown(), "2×3×4");
  } finally {
    editor.destroy();
  }
});

test("非数字间输入 * → 保持字面星号 → 序列化保持原样（Typora 风格）", async () => {
  const editor = createEditor();
  try {
    await waitForCreate();
    typeText(editor, "重点 * 请注意");
    // 文档里存的是字面星号
    assert.equal(editor.state.doc.textContent, "重点 * 请注意");
    // 两侧皆空白的 * 无法构成任何 Markdown 语法，无需转义（与 Typora 实测一致）
    assert.equal(editor.storage.markdown.getMarkdown(), "重点 * 请注意");
  } finally {
    editor.destroy();
  }
});

test("紧贴文字的 * 仍然保护性转义（往返不变）", async () => {
  const editor = createEditor();
  try {
    await waitForCreate();
    // 用 setContent 载入含歧义转义的文本：紧贴文字的 \* 必须保留
    editor.commands.setContent("价格 \\*低\\* 到难以置信");
    assert.equal(
      editor.storage.markdown.getMarkdown(),
      "价格 \\*低\\* 到难以置信",
      "紧贴文字的转义保留，否则重开会被解析成斜体",
    );
  } finally {
    editor.destroy();
  }
});

test("字面星号存盘→重开往返自洽（Typora 风格）", async () => {
  const first = createEditor();
  let saved: string;
  try {
    await waitForCreate();
    typeText(first, "重点 * 请注意");
    saved = first.storage.markdown.getMarkdown();
    assert.equal(saved, "重点 * 请注意");
  } finally {
    first.destroy();
  }

  // 模拟重新打开文件：用保存的文本新建编辑器，再检查文档与二次保存
  const second = createEditor();
  try {
    await waitForCreate();
    second.commands.setContent(saved);
    assert.equal(second.state.doc.textContent, "重点 * 请注意");
    assert.equal(second.storage.markdown.getMarkdown(), saved);
  } finally {
    second.destroy();
  }
});

test("手动逐字输入 **2** → 输入规则立即变加粗 → 序列化保持 **2**", () => {
  const editor = createEditor();
  try {
    typeText(editor, "**2**");
    assert.equal(editor.state.doc.textContent, "2");
    assert.equal(editor.storage.markdown.getMarkdown(), "**2**");
  } finally {
    editor.destroy();
  }
});
