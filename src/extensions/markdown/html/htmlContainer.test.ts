import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * `htmlContainer` 节点本身的行为：schema 能创建、导出的 HTML 保留对齐方式。
 * 解析、序列化与增量保存在后续用例里覆盖。
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

/** 顶层节点类型，忽略末尾由 TrailingParagraph 维护的空段落。 */
const topLevelTypes = (editor: Editor): string[] => {
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  if (types[types.length - 1] === "paragraph") types.pop();
  return types;
};

describe("htmlContainer 节点", () => {
  test("插入后导出带对齐属性的 div", () => {
    withEditor((editor) => {
      editor.commands.insertContent({
        type: "htmlContainer",
        attrs: { align: "center" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
      });

      const html = editor.getHTML();
      assert.match(html, /<div[^>]*align="center"[^>]*>/u);
      assert.match(html, /<p>正文<\/p>/u);
      assert.deepEqual(topLevelTypes(editor), ["htmlContainer"]);
    });
  });

  test("没有对齐信息时不输出 align 属性", () => {
    withEditor((editor) => {
      editor.commands.insertContent({
        type: "htmlContainer",
        attrs: {},
        content: [{ type: "paragraph" }],
      });

      assert.doesNotMatch(editor.getHTML(), /align=/u);
    });
  });
});
