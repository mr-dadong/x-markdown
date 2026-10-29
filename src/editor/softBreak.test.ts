import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/*
 * 段落软换行按 CommonMark 处理：单个换行渲染为空格（与 GitHub 一致），
 * 只有行尾两空格与反斜杠才是硬换行。
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

const countNodeType = (editor: Editor, name: string): number => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) count += 1;
    return true;
  });
  return count;
};

describe("段落软换行（GitHub 语义）", () => {
  test("多行徽章合并在一个段落里，不产生换行节点", () => {
    const markdown = [
      "[![A](https://example.com/a.svg)](https://example.com/a)",
      "[![B](https://example.com/b.svg)](https://example.com/b)",
      "[![C](https://example.com/c.svg)](https://example.com/c)",
    ].join("\n");

    withEditor(markdown, (editor) => {
      const paragraph = editor.state.doc.child(0);
      assert.equal(paragraph.type.name, "paragraph");
      assert.equal(countNodeType(editor, "hardBreak"), 0);

      let images = 0;
      paragraph.forEach((node) => {
        if (node.type.name === "image") images += 1;
      });
      assert.equal(images, 3);
    });
  });

  test("普通段落的软换行合并成一个空格", () => {
    withEditor("第一行\n第二行", (editor) => {
      assert.equal(editor.state.doc.child(0).textContent, "第一行 第二行");
      assert.equal(editor.getMarkdown().trim(), "第一行 第二行");
    });
  });

  test("粗体内的软换行同样合并", () => {
    withEditor("**第一行\n第二行**", (editor) => {
      assert.equal(countNodeType(editor, "hardBreak"), 0);
      assert.equal(editor.state.doc.child(0).textContent, "第一行 第二行");
      assert.equal(editor.getMarkdown().trim(), "**第一行 第二行**");
    });
  });

  test("引用块内的软换行合并", () => {
    withEditor("> 第一行\n> 第二行", (editor) => {
      assert.equal(countNodeType(editor, "hardBreak"), 0);
      assert.equal(editor.state.doc.child(0).textContent, "第一行 第二行");
    });
  });

  test("行尾两空格仍是硬换行", () => {
    const source = "第一行  \n第二行";
    withEditor(source, (editor) => {
      assert.equal(countNodeType(editor, "hardBreak"), 1);
      assert.equal(editor.getMarkdown().trim(), source);
    });
  });

  test("反斜杠仍是硬换行", () => {
    const source = "第一行\\\n第二行";
    withEditor(source, (editor) => {
      assert.equal(countNodeType(editor, "hardBreak"), 1);
      assert.equal(editor.getMarkdown().trim(), source);
    });
  });

  test("列表项内的软换行合并", () => {
    withEditor("- 第一行\n  第二行", (editor) => {
      assert.equal(countNodeType(editor, "hardBreak"), 0);
      assert.equal(editor.getMarkdown().trim(), "- 第一行 第二行");
    });
  });
});
