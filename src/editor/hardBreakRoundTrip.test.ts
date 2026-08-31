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

const roundTrip = (markdown: string): string => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
  });
  try {
    return editor.storage.markdown.getMarkdown();
  } finally {
    editor.destroy();
  }
};

describe("硬换行写法往返", () => {
  test("行尾两空格的硬换行保存后保持两空格写法", () => {
    const source = "第一行  \n第二行";
    assert.equal(roundTrip(source), source);
  });

  test("反斜杠硬换行保存后保持反斜杠写法", () => {
    const source = "第一行\\\n第二行";
    assert.equal(roundTrip(source), source);
  });

  test("段落内普通换行保存后不引入硬换行标记", () => {
    const source = "第一行\n第二行";
    assert.equal(roundTrip(source), source);
  });

  test("用户报告的“其他常用语法”章节保存后不再多出反斜杠", () => {
    const source = [
      "## 十、其他常用语法",
      "",
      "转义字符：\\*这是被转义的星号\\*",
      "",
      "Emoji 表情：😄 🎉 ✅",
      "",
      "换行（行尾两个空格）：",
      "这是强制换行后的文字。",
    ].join("\n");
    assert.equal(roundTrip(source), source);
  });

  test("连续硬换行混合写法保存后各自保持原样", () => {
    const source = "两空格  \n反斜杠\\\n普通\n结尾";
    assert.equal(roundTrip(source), source);
  });

  test("列表项内的换行保持软换行写法", () => {
    const source = "- 列表第一行\n  列表第二行";
    assert.equal(roundTrip(source), source);
  });

  test("首次规范化后的输出再次往返保持稳定", () => {
    const source = "两空格  \n反斜杠\\\n普通\n结尾  \n再来一行";
    const first = roundTrip(source);
    assert.equal(roundTrip(first), first);
  });
});
