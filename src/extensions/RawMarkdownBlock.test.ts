import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/*
 * 原文块（YAML 前置、链接引用定义、`:::` 扩展块）的显示。
 *
 * 这些块用 <pre> 原样展示多行源码，所以换行必须保留。但 ProseMirror 会给「没有
 * contentDOM 的节点」自动加上 contenteditable="false"（prosemirror-view 的 viewdesc.ts），
 * 而 @tiptap/core 注入的 `.ProseMirror [contenteditable="false"] { white-space: normal }`
 * 会把 <pre> 里的换行折叠成空格 —— 多行 YAML 前置因此在编辑器里被压成一行。
 * 还原规则写在 MarkdownEditor.vue 的 .tiptap pre[data-xmd-raw-markdown] 里，
 * 本文件锁住它所依赖的 DOM 事实：源码原样带换行、节点确实带 contenteditable="false"。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
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
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const createEditor = async (content: string): Promise<Editor> => {
  const editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content,
    contentType: "markdown",
  });
  // TipTap 的 create 事件是 setTimeout 异步派发的。
  await new Promise((resolve) => setTimeout(resolve, 20));
  return editor;
};

const FRONT_MATTER = [
  "---",
  "license: mit",
  "library_name: transformers",
  "pipeline_tag: image-text-to-text",
  "---",
  "",
  "# 标题",
  "",
].join("\n");

describe("原文块（YAML 前置）的显示", () => {
  test("逐行保留源码换行，不被折叠成一行", async () => {
    const editor = await createEditor(FRONT_MATTER);
    try {
      const block = editor.view.dom.querySelector<HTMLElement>("pre[data-xmd-raw-markdown]");
      assert.ok(block, "YAML 前置应渲染成原文块");
      assert.equal(
        block.textContent,
        "---\nlicense: mit\nlibrary_name: transformers\npipeline_tag: image-text-to-text\n---",
      );
      // 每个 YAML 键各占一行：编辑器里换行保留，节点文本也确实是多行。
      assert.equal(block.textContent?.split("\n").length, 5);
    } finally {
      editor.destroy();
    }
  });

  /*
   * 这条属性是注入样式的命中条件，也是折叠换行的根因：
   * 它一旦消失或改变，MarkdownEditor.vue 里那条还原规则的前提就需要重新确认。
   */
  test("节点带 contenteditable=false，正是注入样式折叠换行的条件", async () => {
    const editor = await createEditor(FRONT_MATTER);
    try {
      const block = editor.view.dom.querySelector<HTMLElement>("pre[data-xmd-raw-markdown]");
      assert.equal(block?.getAttribute("contenteditable"), "false");
    } finally {
      editor.destroy();
    }
  });

  test("YAML 前置在存盘时逐字节还原", async () => {
    const { captureBaseline, serializePreservingSource } = await import(
      "../editor/sourcePreservingSerializer"
    );
    const editor = await createEditor(FRONT_MATTER);
    try {
      const baseline = captureBaseline(editor, FRONT_MATTER);
      assert.equal(serializePreservingSource(editor, baseline), FRONT_MATTER);
    } finally {
      editor.destroy();
    }
  });
});
