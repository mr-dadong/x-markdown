import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";
import { HTML_COMMENT_CLASS } from "./HtmlComment";

/*
 * HTML 注释的显示与保真。
 *
 * 注释在编辑器里落成可编辑的普通段落（HtmlBlock 认领不了它），本文件锁住两件事：
 * - 块尾换行不能带进段落文本：ProseMirror 的 white-space: break-spaces 会把它显示成
 *   一个空行，连续几行注释会看起来被空行隔开；
 * - 整段都是注释的段落被 HtmlComment 扩展挂上弱化用的装饰类，且该装饰只影响显示，
 *   不进文档模型、不进导出的 HTML，也不影响存盘的逐字节还原。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("../../../editor/editorExtensions").createEditorExtensions;
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
  ({ createEditorExtensions } = await import("../../../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

/** TipTap 的 create 事件是 setTimeout 异步派发的。 */
const waitForCreate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

const createEditor = async (content: string): Promise<Editor> => {
  const editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content,
    contentType: "markdown",
  });
  await waitForCreate();
  return editor;
};

/** 顶层节点文本，忽略末尾由 TrailingParagraph 维护的空段落。 */
const topLevelTexts = (editor: Editor): string[] => {
  const content: JSONContent[] = editor.state.doc.toJSON().content ?? [];
  return content
    .filter((node, index) => !(
      index === content.length - 1 && node.type === "paragraph" && !node.content
    ))
    .map((node) =>
      String((node.content ?? []).map((child) => String(child.text ?? "")).join("")),
    );
};

/** 编辑区第 index 个顶层 DOM 节点是否带注释弱化类。 */
const hasCommentClass = (editor: Editor, index: number): boolean =>
  (editor.view.dom.children[index] as HTMLElement | undefined)
    ?.classList.contains(HTML_COMMENT_CLASS) ?? false;

describe("HTML 注释的渲染", () => {
  test("块尾换行不进入段落文本：连续三行注释不再被空行隔开", async () => {
    const markdown = [
      "# 标题",
      "",
      "<!-- markdownlint-disable first-line-h1 -->",
      "<!-- markdownlint-disable html -->",
      "<!-- markdownlint-disable no-duplicate-header -->",
      "",
      "正文",
      "",
    ].join("\n");
    const editor = await createEditor(markdown);
    try {
      assert.deepEqual(topLevelTexts(editor), [
        "标题",
        "<!-- markdownlint-disable first-line-h1 -->",
        "<!-- markdownlint-disable html -->",
        "<!-- markdownlint-disable no-duplicate-header -->",
        "正文",
      ]);
    } finally {
      editor.destroy();
    }
  });

  test("整段是注释的段落带弱化装饰类，普通字面 HTML 段落不带", async () => {
    const editor = await createEditor(
      "<!-- 只在编辑器里变灰 -->\n\n<div>dadong</div>\n",
    );
    try {
      assert.equal(hasCommentClass(editor, 0), true);
      assert.equal(hasCommentClass(editor, 1), false);
      // 装饰只是视图层显示状态：不进导出的 HTML，也不改文档内容。
      assert.equal(editor.getHTML().includes(HTML_COMMENT_CLASS), false);
      assert.equal(editor.state.doc.child(0).textContent, "<!-- 只在编辑器里变灰 -->");
    } finally {
      editor.destroy();
    }
  });

  test("多行注释与行内注释：整段是注释才弱化", async () => {
    const multiLine = await createEditor("<!--\n多行注释\n-->\n");
    try {
      assert.equal(hasCommentClass(multiLine, 0), true);
    } finally {
      multiLine.destroy();
    }

    // 注释与正文混在同一段：整段不是注释，不能整段变灰。
    const mixed = await createEditor("正文里的 <!-- 行内注释 --> 文字\n");
    try {
      assert.equal(hasCommentClass(mixed, 0), false);
    } finally {
      mixed.destroy();
    }
  });

  test("把注释改写成正文后装饰立即消失", async () => {
    const editor = await createEditor("<!-- 待改写 -->\n");
    try {
      assert.equal(hasCommentClass(editor, 0), true);
      const paragraph = editor.state.doc.child(0);
      editor.view.dispatch(editor.state.tr.insertText("正文", 1, 1 + paragraph.content.size));
      assert.equal(editor.state.doc.child(0).textContent, "正文");
      assert.equal(hasCommentClass(editor, 0), false);
    } finally {
      editor.destroy();
    }
  });

  /*
   * 导出走的是只读的隐藏编辑器，它的 innerHTML 就是导出的 HTML。
   * 内部装饰类不能出现在那里，否则会平白给导出的文档加上一个无效类名。
   */
  test("只读编辑器（导出用）不挂装饰类", async () => {
    const editor = new EditorConstructor({
      extensions: createEditorExtensions(),
      content: "<!-- 导出时不该带内部类名 -->\n",
      contentType: "markdown",
      editable: false,
    });
    await waitForCreate();
    try {
      assert.equal(editor.view.dom.querySelector(`.${HTML_COMMENT_CLASS}`), null);
      assert.equal(editor.view.dom.innerHTML.includes(HTML_COMMENT_CLASS), false);
    } finally {
      editor.destroy();
    }
  });
});

describe("HTML 注释的写回保真", () => {
  test("未编辑时逐字节还原，注释文字一行不少", async () => {
    const { captureBaseline, serializePreservingSource } = await import(
      "../../../editor/sourcePreservingSerializer"
    );
    const markdown = [
      "# 标题",
      "",
      "<!-- markdownlint-disable first-line-h1 -->",
      "<!-- markdownlint-disable html -->",
      "",
      "正文",
      "",
    ].join("\n");
    const editor = await createEditor(markdown);
    try {
      const baseline = captureBaseline(editor, markdown);
      assert.equal(serializePreservingSource(editor, baseline), markdown);
    } finally {
      editor.destroy();
    }
  });
});
