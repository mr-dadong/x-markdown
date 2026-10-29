import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";
import { moveSelectionOutOfDetails } from "./htmlDetailsToggle";

/*
 * `htmlDetails` 节点的导出形态：摘要行只取纯文本，`open` 状态决定是否输出 open 属性。
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

const insertDetails = (editor: Editor, attrs: Record<string, unknown>): void => {
  editor.commands.insertContent({
    type: "htmlDetails",
    attrs,
    content: [{ type: "paragraph", content: [{ type: "text", text: "面板内容" }] }],
  });
};

describe("htmlDetails 节点", () => {
  test("导出 details / summary 结构并保留 open", () => {
    withEditor((editor) => {
      insertDetails(editor, {
        summarySource: "<summary><b>完整特性</b></summary>",
        open: true,
      });

      const html = editor.getHTML();
      assert.match(html, /<details[^>]*open/u);
      // 摘要按纯文本输出：行内标签只存在于源码，不进入导出 HTML。
      assert.match(html, /<summary>完整特性<\/summary>/u);
      assert.match(html, /<p>面板内容<\/p>/u);
    });
  });

  test("没有 open 时不输出 open 属性", () => {
    withEditor((editor) => {
      insertDetails(editor, { summarySource: "<summary>安装说明</summary>" });

      assert.doesNotMatch(editor.getHTML(), /\sopen/u);
      assert.match(editor.getHTML(), /<summary>安装说明<\/summary>/u);
    });
  });
});

const createMarkdownEditor = (markdown: string): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });

const DETAILS_MARKDOWN = ["<details>", "<summary><b>特性</b></summary>", "", "- 第一条", "", "</details>"].join("\n");

/** 面板内容里的第一个文本位置，用来模拟「光标停在面板内」。 */
const firstTextPosition = (editor: Editor): number => {
  let position = -1;
  editor.state.doc.descendants((node, at) => {
    if (position < 0 && node.isText) position = at;
    return position < 0;
  });
  return position;
};

describe("折叠面板的展开与收起", () => {
  test("视图提供折叠按钮与状态指示器", () => {
    // Vue 单文件组件在 bun test 里无法编译，交互标记用静态断言覆盖；
    // 真实点击行为由界面冒烟核对。
    const sfc = readFileSync(new URL("./HtmlDetailsView.vue", import.meta.url), "utf8");

    assert.match(sfc, /data-xmd-html-details-toggle/u);
    assert.match(sfc, /data-xmd-html-details-indicator/u);
    assert.match(sfc, /v-show="!collapsed"/u);
    assert.match(sfc, /@click="toggleCollapsed"/u);
    assert.match(sfc, /moveSelectionOutOfDetails/u);
  });

  test("收起时把光标从内容区移到面板之后", () => {
    const editor = createMarkdownEditor(`${DETAILS_MARKDOWN}\n\n面板之后的段落`);
    try {
      const details = editor.state.doc.child(0);
      const inside = firstTextPosition(editor);
      assert.ok(inside > 0 && inside < details.nodeSize);
      editor.commands.setTextSelection(inside);

      moveSelectionOutOfDetails(editor, 0, details.nodeSize);

      assert.ok(editor.state.selection.from >= details.nodeSize);
      assert.equal(editor.state.doc.child(0).textContent.includes("第一条"), true);
    } finally {
      editor.destroy();
    }
  });

  test("光标在面板外时收起不移动选区", () => {
    const editor = createMarkdownEditor(`${DETAILS_MARKDOWN}\n\n面板之后的段落`);
    try {
      const details = editor.state.doc.child(0);
      const outside = details.nodeSize + 1;
      editor.commands.setTextSelection(outside);

      moveSelectionOutOfDetails(editor, 0, details.nodeSize);

      assert.equal(editor.state.selection.from, outside);
    } finally {
      editor.destroy();
    }
  });
});
