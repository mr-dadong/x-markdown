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

/**
 * 解析补丁的安装时机契约。
 *
 * `contentType: "markdown"` 的初始内容由 Markdown 扩展在它自己的 onBeforeCreate 里解析，
 * 而扩展钩子按扩展数组顺序注册、onCreate 更是异步的。因此补丁必须由
 * createEditorExtensions 在 Editor 构造之前装好；一旦被挪回扩展钩子，
 * 进程里第一个打开的文档就会漏掉补丁而丢内容。
 *
 * 这里刻意不创建 Editor：只调用工厂函数，就要求补丁已经生效。
 */
describe("解析补丁由 createEditorExtensions 提前安装", () => {
  test("仅调用 createEditorExtensions 后，裸字面标签已能被保真解析", async () => {
    createEditorExtensions();
    const { MarkdownManager } = await import("@tiptap/markdown");
    const manager = new MarkdownManager({ extensions: createEditorExtensions() });

    const doc = manager.parse("<a>sddd<a/>");
    assert.equal(
      JSON.stringify(doc),
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "<a>sddd<a/>" }],
          },
        ],
      }),
      "不创建 Editor 也应已安装解析补丁",
    );
  });
});

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
    // HTML 变活：`<` 一律不转义，源码视图与用户输入一致
    ["HTML 标签的 < 不转义", "<a>大冬", "<a>大冬"],
    ["闭合标签的 < 不转义", "<div>x</div>", "<div>x</div>"],
    ["网址自动链接的 < 不转义", "<https://example.com>", "<https://example.com>"],
    ["不成对的 < 保持原样", "a<b", "a<b"],
    ["比较符号两侧的 < 保持原样", "a < b", "a < b"],
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
    // 认不出的行内标签：源码原样，重新打开由解析补丁兜底成字面文本
    ["认不出的行内标签", "<a>大冬<a/>", "<a>大冬<a/>"],
    ["行内自闭合标签", "sddd<a/>", "sddd<a/>"],
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

describe("源码里的 HTML 标签按 HTML 解析", () => {
  /*
   * 本项目采用 Typora 的取向：`<` 不转义，源码里的 HTML 就是 HTML。
   * 打开含 HTML 的文件时，块级标签成为 HTML 块、行内标签成为对应标记，
   * 而不是字面文字 —— 这是刻意行为，不是丢内容。
   *
   * 在渲染视图里键入 HTML 会当场变活（不必等重新解析），
   * 那部分行为由 htmlBlockInputRule.test.ts 覆盖。
   */
  const loadAndSerialize = async (
    markdown: string,
  ): Promise<{ editor: Editor; source: string }> => {
    const { captureBaseline, serializePreservingSource } = await import(
      "./sourcePreservingSerializer"
    );
    const editor = createEditor(markdown);
    await waitForCreate();
    const baseline = captureBaseline(editor, markdown);
    return { editor, source: serializePreservingSource(editor, baseline) };
  };

  test("块级 HTML 成为 htmlBlock，未改动的块保留原文字节", async () => {
    const { editor, source } = await loadAndSerialize("<div>dadong</div>");
    try {
      assert.equal(editor.state.doc.firstChild?.type.name, "htmlBlock");
      assert.equal(editor.state.doc.firstChild?.attrs.source, "<div>dadong</div>");
      assert.equal(source, "<div>dadong</div>", "未改动的块应保留磁盘原文字节");
    } finally {
      editor.destroy();
    }
  });

  test("行内 HTML 成为对应标记", async () => {
    const { editor } = await loadAndSerialize("<em>hi</em>");
    try {
      assert.equal(editor.state.doc.textContent, "hi");
      assert.ok(
        editor.state.doc.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "italic"),
        "应解析成斜体标记",
      );
    } finally {
      editor.destroy();
    }
  });
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
    ["认不出的行内标签", "<a>大冬<a/>", "<a>大冬<a/>"],
  ];

  for (const [name, typed, expectedSource] of cases) {
    test(`${name}：${JSON.stringify(typed)}`, async () => {
      assert.equal(await typeIntoEmptyDocument(typed), expectedSource);
    });
  }
});

describe("认不出的行内 HTML 解析时不丢内容", () => {
  /*
   * 回归：官方解析行内 HTML token 有两个吃掉用户内容的出口 ——
   * 解析不出行内节点时返回 null 被上游丢弃；解析出节点但没有任何标记时，
   * 标签被直接吃掉只剩文字（如没有 href 的 `<a>`、没有 style 的 `<span>`）。
   * 修复后两种情况都退回字面文本，逐字保真。
   *
   * 注意这里的输入既覆盖裸写法（序列化现在的输出），也覆盖 `\<` 转义写法
   * （用户手写或历史文件里可能存在），两者都必须保真。
   */
  const reopenText = async (markdown: string): Promise<string> => {
    const editor = createEditor(markdown);
    try {
      await waitForCreate();
      return editor.state.doc.textContent;
    } finally {
      editor.destroy();
    }
  };

  const cases: Array<[string, string, string]> = [
    ["裸开标签配裸自闭合标签", "<a>sddd<a/>", "<a>sddd<a/>"],
    ["裸自闭合标签位于正文中间", "sddd<a/>", "sddd<a/>"],
    ["无 href 的成对 a 标签", "<a>sss</a>", "<a>sss</a>"],
    ["无 style 的成对 span 标签", "<span>sss</span>", "<span>sss</span>"],
    ["完全未知的标签", "<foo>bar</foo>", "<foo>bar</foo>"],
    ["转义的开标签配转义的自闭合标签", "\\<a>sddd\\<a/>", "<a>sddd<a/>"],
    ["转义的开标签配裸自闭合标签", "\\<a>sddd<a/>", "<a>sddd<a/>"],
    ["转义的成对 em 标签", "\\<em>hi\\</em>", "<em>hi</em>"],
    ["转义的成对 div 标签", "\\<div>x\\</div>", "<div>x</div>"],
    ["不成对的尖括号", "a<b", "a<b"],
  ];

  for (const [name, markdown, expected] of cases) {
    test(`${name}：${JSON.stringify(markdown)}`, async () => {
      assert.equal(
        await reopenText(markdown),
        expected,
        "认不出的行内 HTML 应退回字面文本，不能被解析器丢弃",
      );
    });
  }

  test("认不出的行内标签存盘后源码不再变化", async () => {
    for (const typed of ["<a>sss</a>", "<span>sss</span>", "<foo>bar</foo>"]) {
      const editor = createEditor("");
      try {
        await waitForCreate();
        typeText(editor, typed);
        const source = editor.getMarkdown();
        assert.equal(source, typed, `源码应与键入一致：${typed}`);

        const reopened = createEditor(source);
        try {
          await waitForCreate();
          assert.equal(reopened.state.doc.textContent, typed);
          assert.equal(reopened.getMarkdown(), source, `再次保存不应继续变化：${typed}`);
        } finally {
          reopened.destroy();
        }
      } finally {
        editor.destroy();
      }
    }
  });
});

describe("schema 认得出的行内 HTML 仍然变活", () => {
  /*
   * 保真兜底只应作用于「标签白写」的情况。只要 schema 有对应映射，
   * 标签就必须照常变成标记或节点，不能被当成字面文本留下。
   */
  const parseDoc = async (markdown: string) => {
    const editor = createEditor(markdown);
    try {
      await waitForCreate();
      const first = editor.state.doc.firstChild;
      const marks = (first?.firstChild?.marks ?? []).map((mark) => mark.type.name);
      return { type: first?.type.name, marks, text: editor.state.doc.textContent };
    } finally {
      editor.destroy();
    }
  };

  const cases: Array<[string, string, string[]]> = [
    ["斜体", "<em>sss</em>", ["italic"]],
    ["粗体", "<b>sss</b>", ["bold"]],
    ["下划线", "<u>sss</u>", ["underline"]],
    ["下标", "<sub>sss</sub>", ["subscript"]],
    ["高亮", "<mark>sss</mark>", ["highlight"]],
    ["带 href 的链接", '<a href="https://example.com">sss</a>', ["link"]],
    ["带 style 的 span", '<span style="color:red">红</span>', ["textStyle"]],
  ];

  for (const [name, markdown, expectedMarks] of cases) {
    test(`${name}：${JSON.stringify(markdown)}`, async () => {
      const { type, marks, text } = await parseDoc(markdown);
      assert.equal(type, "paragraph");
      assert.equal(text, markdown.includes("红") ? "红" : "sss");
      assert.deepEqual(marks, expectedMarks, "标签应被解析成对应标记");
    });
  }

  test("图片标签解析成图片节点", async () => {
    const editor = createEditor('<img src="a.png">');
    try {
      await waitForCreate();
      assert.equal(editor.state.doc.firstChild?.firstChild?.type.name, "image");
    } finally {
      editor.destroy();
    }
  });
});
