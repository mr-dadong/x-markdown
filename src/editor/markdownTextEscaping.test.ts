import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { escapeMarkdownText } from "./markdownTextEscaping";

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

/** TipTap 的 create 事件是 setTimeout 异步派发的，序列化包装在此时安装。 */
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

describe("escapeMarkdownText 纯函数", () => {
  const cases: Array<[string, string, string]> = [
    ["反斜杠后面是普通字符，不需要补转义", "\\d", "\\d"],
    ["两个反斜杠后面是普通字符，最少写成三个", "\\\\d", "\\\\\\d"],
    ["Windows 路径原样保留", "C:\\path\\to", "C:\\path\\to"],
    ["反斜杠后面是标点，必须补转义", "\\*", "\\\\\\*"],
    ["反斜杠位于行尾，必须补转义以免变成硬换行", "结尾\\", "结尾\\\\"],
    ["可能开启 HTML 标签的 < 补转义", "<a>大冬", "\\<a>大冬"],
    ["不成对的 < 保持原样", "a<b", "a<b"],
    ["比较符号两侧的 < 保持原样", "a < b", "a < b"],
    ["网址自动链接补转义", "<https://example.com>", "\\<https://example.com>"],
    ["星号补转义", "重点*内容", "重点\\*内容"],
    ["词中间的 _ 不补转义", "snake_case", "snake_case"],
    ["独立 _ 补转义", "前 _ 后", "前 \\_ 后"],
  ];

  for (const [name, input, expected] of cases) {
    test(`${name}：${JSON.stringify(input)}`, () => {
      assert.equal(escapeMarkdownText(input, false), expected);
    });
  }

  test("块首的列表标记、标题、有序列表补转义", () => {
    assert.equal(escapeMarkdownText("- 项目", true), "\\- 项目");
    assert.equal(escapeMarkdownText("# 标题", true), "\\# 标题");
    assert.equal(escapeMarkdownText("1. 第一条", true), "1\\. 第一条");
    // 不在块首时同样的文本不需要转义
    assert.equal(escapeMarkdownText("- 项目", false), "- 项目");
  });
});

describe("渲染视图输入的字面文本写入源码视图", () => {
  /** 逐字符键入后返回源码文本，并校验文档内容确实等于键入内容。 */
  const typeAndSerialize = async (text: string): Promise<string> => {
    const editor = createEditor("");
    try {
      await waitForCreate();
      typeText(editor, text);
      assert.equal(editor.state.doc.textContent, text, "渲染视图里显示的内容应与键入一致");
      return editor.getMarkdown();
    } finally {
      editor.destroy();
    }
  };

  /** 用保存的源码重新打开，返回文档文本与二次保存结果。 */
  const reopen = async (markdown: string): Promise<{ text: string; saved: string }> => {
    const editor = createEditor(markdown);
    try {
      await waitForCreate();
      return {
        text: editor.state.doc.textContent,
        saved: editor.getMarkdown(),
      };
    } finally {
      editor.destroy();
    }
  };

  const cases: Array<[string, string, string]> = [
    ["反斜杠 + 普通字符", "\\d", "\\d"],
    ["两个反斜杠 + 普通字符", "\\\\d", "\\\\\\d"],
    ["三个反斜杠 + 普通字符", "\\\\\\d", "\\\\\\\\\\d"],
    ["Windows 路径", "C:\\path\\to", "C:\\path\\to"],
    ["HTML 标签样文本", "<a>大冬<a/>", "\\<a>大冬\\<a/>"],
    ["不成对的尖括号", "a<b", "a<b"],
  ];

  for (const [name, typed, expectedSource] of cases) {
    test(`${name}：${JSON.stringify(typed)}`, async () => {
      const source = await typeAndSerialize(typed);
      assert.equal(source, expectedSource, "源码视图应输出最小转义的 Markdown");

      // 存盘后重新打开：文档内容与再次保存的源码都必须保持稳定
      const reopened = await reopen(source);
      assert.equal(reopened.text, typed, "重新打开后渲染视图应还原成键入的文本");
      assert.equal(reopened.saved, source, "重新打开后再次保存不应继续变化");
    });
  }
});

describe("源码视图的块级增量序列化同样走最小转义", () => {
  /** 空文档建立 baseline 后逐字符键入，再按源码视图的合并逻辑取文本。 */
  const typeIntoEmptyDocument = async (text: string): Promise<string> => {
    const { captureBaseline, serializePreservingSource } = await import("./sourcePreservingSerializer");
    const editor = createEditor("");
    try {
      await waitForCreate();
      const baseline = captureBaseline(editor, "");
      typeText(editor, text);
      return serializePreservingSource(editor, baseline);
    } finally {
      editor.destroy();
    }
  };

  const cases: Array<[string, string, string]> = [
    ["反斜杠 + 普通字符", "\\d", "\\d"],
    ["Windows 路径", "C:\\path\\to", "C:\\path\\to"],
    ["HTML 标签样文本", "<a>大冬<a/>", "\\<a>大冬\\<a/>"],
  ];

  for (const [name, typed, expectedSource] of cases) {
    test(`${name}：${JSON.stringify(typed)}`, async () => {
      assert.equal(await typeIntoEmptyDocument(typed), expectedSource);
    });
  }
});
