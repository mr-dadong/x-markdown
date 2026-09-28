import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/*
 * 用户上报的问题：在渲染视图里输入 `<b>222</b>`，切到源码视图就变成了 `**222**`。
 *
 * 期望（方案 C + 范围 1）：预览照常把标签渲染成粗体等格式，源码视图与存盘文件
 * 保留用户写的 HTML 原样；`<a href>` 与 `<img>` 仍按 Markdown 语法转换。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  (browserWindow as unknown as { electronAPI: unknown }).electronAPI = {
    readEditorImage: async (url: string) => url,
    readEditorFileBytes: async () => new Uint8Array(),
    onAttachmentCopyProgress: () => () => {},
    getPathForFile: () => "",
  };
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("./editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

/** TipTap 的 create 事件是 setTimeout 异步派发的。 */
const waitForCreate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

const createEditor = (content: string): Editor =>
  new EditorConstructor({ extensions: createEditorExtensions(), content, contentType: "markdown" });

/** 逐字符模拟真实键入：先走 input rules，未命中再插入纯文本。 */
const typeText = (editor: Editor, text: string): void => {
  for (const character of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
};

describe("行内 HTML 保留用户写法", () => {
  test("渲染视图键入 <b>222</b>：预览变粗体，源码仍是 <b>222</b>", async () => {
    const editor = createEditor("");
    try {
      await waitForCreate();
      typeText(editor, "<b>222</b>");

      // 标签仍被 schema 认领成粗体标记，预览照常渲染。
      assert.equal(editor.state.doc.textContent, "222");
      assert.deepEqual(
        editor.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name),
        ["bold"],
      );
      // 源码保留用户写法，不再被改写成 **222**。
      assert.equal(editor.getMarkdown(), "<b>222</b>");
    } finally {
      editor.destroy();
    }
  });

  test("打开含 <b>222</b> 的文件后编辑同一段落，源码不被改写成 **222**", async () => {
    const editor = createEditor("<b>222</b>\n");
    try {
      await waitForCreate();
      // 把光标放到粗体文字中间再输入，让该块变成「已改动」并触发重新序列化。
      editor.commands.setTextSelection(2);
      typeText(editor, "x");

      assert.equal(editor.getMarkdown(), "<b>2x22</b>");
    } finally {
      editor.destroy();
    }
  });

  test("行内 <br> 保留写法，不被改写成反斜杠换行", async () => {
    const editor = createEditor("a<br>b\n");
    try {
      await waitForCreate();
      editor.commands.setTextSelection(2);
      typeText(editor, "x");

      assert.equal(editor.getMarkdown(), "ax<br>b");
    } finally {
      editor.destroy();
    }
  });

  test("Markdown 自己的写法不受影响", async () => {
    const editor = createEditor("**222** 和 *222*\n");
    try {
      await waitForCreate();
      assert.equal(editor.getMarkdown(), "**222** 和 *222*");
    } finally {
      editor.destroy();
    }
  });

  test("链接照常转成 Markdown，里面的粗体保留 HTML 写法", async () => {
    const editor = createEditor('<a href="https://example.com"><b>x</b></a>\n');
    try {
      await waitForCreate();
      assert.equal(editor.getMarkdown(), "[<b>x</b>](https://example.com)");
    } finally {
      editor.destroy();
    }
  });
});
