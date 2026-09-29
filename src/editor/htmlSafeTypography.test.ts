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

const createEditor = (): Editor =>
  new EditorConstructor({ extensions: createEditorExtensions(), content: "", contentType: "markdown" });

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

/** 逐字符键入后返回编辑器，供断言节点/标记用。 */
const typeIntoEditor = (text: string): Editor => {
  const editor = createEditor();
  typeText(editor, text);
  return editor;
};

/** 逐字符键入后返回文档文本。 */
const typeAndRead = (text: string): string => {
  const editor = typeIntoEditor(text);
  try {
    return editor.state.doc.textContent;
  } finally {
    editor.destroy();
  }
};

/** 取首个文本节点上的指定标记。 */
const firstMark = (editor: Editor, name: string) =>
  editor.state.doc.firstChild?.firstChild?.marks.find((mark) => mark.type.name === name);

describe("排版替换不作用在 HTML 标签内部", () => {
  /*
   * 官方 Typography 只看光标前匹配到的那几个字符，不看上下文，写 HTML 时会被静默改写：
   * 属性里的直引号变成弯引号（`<a href=”#x”>`），注释里的 `<-` 变成 `←`、`--` 变成 `—`。
   *
   * 属性值被改写会让标签直接失效，所以这里断言的是最终解析结果：属性值必须原样带进节点。
   */
  test("双引号属性值不被改写，链接地址保持原样", () => {
    const editor = typeIntoEditor('<a href="#x">sss</a>');
    try {
      assert.equal(firstMark(editor, "link")?.attrs.href, "#x");
      assert.equal(editor.state.doc.textContent, "sss");
    } finally {
      editor.destroy();
    }
  });

  test("单引号属性值不被改写，颜色保持原样", () => {
    const editor = typeIntoEditor("<span style='color:red'>x</span>");
    try {
      assert.equal(firstMark(editor, "textStyle")?.attrs.color, "red");
      assert.equal(editor.state.doc.textContent, "x");
    } finally {
      editor.destroy();
    }
  });

  /*
   * 单独一行的 `<img …>` 写完就会被认领成图片节点（与打开文件时的解析一致），
   * 因此这里断言的是属性值原样带进了节点：引号一旦被排版规则换成弯引号，src / alt 就废了。
   */
  test("没有闭合标签的元素：属性值逐字带进认领出的图片节点", () => {
    const editor = typeIntoEditor('<img src="a.png" alt="图">');
    try {
      const image = editor.state.doc.firstChild?.firstChild;
      assert.equal(image?.type.name, "image");
      assert.equal(image?.attrs.src, "a.png");
      assert.equal(image?.attrs.alt, "图");
    } finally {
      editor.destroy();
    }
  });

  test("注释保持字面文字", () => {
    const cases = ["<!-- 注释 -->", '<!-- 说 "你好" -->'];
    for (const typed of cases) {
      assert.equal(typeAndRead(typed), typed, "HTML 标签内部应逐字保真");
    }
  });
});

describe("正文里的排版替换照常生效", () => {
  const cases: Array<[string, string, string]> = [
    ["破折号", "等一下--", "等一下—"],
    ["省略号", "等等...", "等等…"],
    ["右箭头", "A -> B", "A → B"],
    ["版权符号", "3 (c)", "3 ©"],
    ["比较符号后的引号", 'a < b 他说"', "a < b 他说”"],
    // 段落里还有别的文字时不会整体转成 HTML，标签原样留着，后面的引号照常替换。
    ["标签闭合后的引号", 'a <b>c</b> 他说"', 'a <b>c</b> 他说”'],
  ];

  for (const [name, typed, expected] of cases) {
    test(`${name}：${JSON.stringify(typed)}`, () => {
      assert.equal(typeAndRead(typed), expected);
    });
  }
});