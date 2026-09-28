import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/*
 * 按 Typora 的 Inline HTML 规则对齐的三件事（见 https://support.typora.io/HTML/）：
 * 1. kbd/var/samp 这类常见标签渲染成 HTML 内容，而不是显示尖括号；
 * 2. <span style="font-size/background/…"> 的样式真正生效，并且样式不丢；
 * 3. HTML 实体解码（&reg; → ®、&#182; → ¶）。
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

describe("常见内联 HTML 标签渲染成 HTML 内容", () => {
  /*
   * 这些标签共用同一个标记实现（见 extensions/markdown/html/HtmlTextTag.ts），
   * 用一个用例覆盖「渲染成同名元素 + 写回原标签」即可，逐个标签列用例属于重复。
   */
  test("kbd 等标签渲染为同名元素，源码保留原标签", async () => {
    const editor = createEditor("<kbd>Ctrl</kbd>\n");
    try {
      await waitForCreate();
      const element = editor.view.dom.querySelector("kbd");
      assert.ok(element, `预览里应渲染出 <kbd>，实际 DOM：${editor.view.dom.innerHTML}`);
      assert.equal(editor.getMarkdown(), "<kbd>Ctrl</kbd>", "写回 Markdown 时应保留用户写的标签");
    } finally {
      editor.destroy();
    }
  });

  test("渲染视图键入 <kbd>Ctrl</kbd>：预览成按键，源码保持原写法", async () => {
    const editor = createEditor("");
    try {
      await waitForCreate();
      typeText(editor, "<kbd>Ctrl</kbd>");
      assert.ok(editor.view.dom.querySelector("kbd"), "键入闭合标签后应立即渲染");
      assert.equal(editor.getMarkdown(), "<kbd>Ctrl</kbd>");
    } finally {
      editor.destroy();
    }
  });

  test("标签名大小写会被规范化（DOM 只保留小写写法）", async () => {
    // 已知差异：标签文本是从解析后的 DOM 还原的，而 HTML 解析本身就把标签名
    // 规范成小写，因此 `<KBD>` 会写成 `<kbd>`。要做到逐字节保留需要另存原始片段，
    // 不在本次范围内。
    const editor = createEditor("<KBD>Ctrl</KBD>\n");
    try {
      await waitForCreate();
      assert.ok(editor.view.dom.querySelector("kbd"));
      assert.equal(editor.getMarkdown(), "<kbd>Ctrl</kbd>");
    } finally {
      editor.destroy();
    }
  });
});

describe("span 上的样式真正生效且不丢", () => {
  test("字号与背景色写入编辑器 DOM，且 HTML 写法原样写回", async () => {
    const markdown = '<span style="font-size:2rem; background:yellow;">Bigger</span>';
    const editor = createEditor(`${markdown}\n`);
    try {
      await waitForCreate();
      const style = editor.view.dom.querySelector("span")?.getAttribute("style") ?? "";
      assert.match(style, /font-size:\s*2rem/u, `字号应生效，实际样式：${style}`);
      assert.match(style, /background-color:\s*yellow/u, `背景色应生效，实际样式：${style}`);
      assert.equal(editor.getMarkdown(), markdown);
    } finally {
      editor.destroy();
    }
  });

  test("工具条设置的样式写回 Markdown，不再静默丢失", async () => {
    const editor = createEditor("文字\n");
    try {
      await waitForCreate();
      editor.commands.selectAll();
      editor.commands.setColor("red");
      assert.equal(editor.getMarkdown(), '<span style="color: red">文字</span>');
    } finally {
      editor.destroy();
    }
  });
});

describe("HTML 实体解码", () => {
  test("命名实体与数字引用都会解码", async () => {
    const editor = createEditor("HTML entities like &reg; &#182;\n");
    try {
      await waitForCreate();
      assert.equal(editor.state.doc.textContent, "HTML entities like ® ¶");
      assert.match(editor.view.dom.textContent ?? "", /® ¶/u, "预览里应显示解码后的字符");
    } finally {
      editor.destroy();
    }
  });

  test("转义过的实体与不成形的 & 保持字面量", async () => {
    // `&amp;reg;` 是用户想表示字面量 "&reg;"，不能被解码两次；`&foo;`、裸 `&` 同理。
    const editor = createEditor("&amp;reg; &foo; a & b\n");
    try {
      await waitForCreate();
      assert.equal(editor.state.doc.textContent, "&reg; &foo; a & b");
    } finally {
      editor.destroy();
    }
  });
});
