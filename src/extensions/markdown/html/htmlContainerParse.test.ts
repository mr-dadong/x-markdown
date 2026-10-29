import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * 容器 token 转成编辑器节点的结果：一个源码块 ↔ 一个容器节点，内层按 Markdown 解析。
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

const createEditor = (markdown: string): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });

/** 顶层节点类型，忽略末尾由 TrailingParagraph 维护的空段落。 */
const topLevelTypes = (editor: Editor): string[] => {
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  const last = editor.state.doc.lastChild;
  if (types[types.length - 1] === "paragraph" && last && last.content.size === 0) types.pop();
  return types;
};

const childTypes = (node: import("@tiptap/pm/model").Node): string[] => {
  const types: string[] = [];
  node.forEach((child) => types.push(child.type.name));
  return types;
};

describe("容器解析结果", () => {
  test("README 头部片段解析为一个居中容器，内层按 Markdown 解析", () => {
    const markdown = [
      '<div align="center">',
      "",
      "# XMD",
      "",
      "**A local-first Markdown editor**",
      "",
      "[![Release](https://img.shields.io/badge.svg)](https://example.com/releases)",
      "",
      "</div>",
      "",
      "## 后续正文",
    ].join("\n");
    const editor = createEditor(markdown);
    try {
      assert.deepEqual(topLevelTypes(editor), ["htmlContainer", "heading"]);
      const container = editor.state.doc.child(0);
      assert.equal(container.attrs.align, "center");
      assert.equal(container.attrs.openSource, '<div align="center">');
      assert.equal(container.attrs.closeSource, "</div>");
      assert.deepEqual(childTypes(container), ["heading", "paragraph", "paragraph"]);
      // 徽章是 Markdown 图片链接，应该解析成段落里的图片节点。
      const badge = container.child(2).toJSON() as JSONContent;
      assert.equal(badge.content?.[0]?.type, "image");
    } finally {
      editor.destroy();
    }
  });

  test("details 片段解析为折叠容器，内层列表按 Markdown 解析", () => {
    const markdown = [
      "<details>",
      "<summary><b>完整特性</b></summary>",
      "",
      "- 第一条",
      "- 第二条",
      "",
      "</details>",
    ].join("\n");
    const editor = createEditor(markdown);
    try {
      assert.deepEqual(topLevelTypes(editor), ["htmlDetails"]);
      const details = editor.state.doc.child(0);
      assert.equal(details.attrs.summarySource, "<summary><b>完整特性</b></summary>");
      assert.equal(details.attrs.open, false);
      assert.deepEqual(childTypes(details), ["bulletList"]);
    } finally {
      editor.destroy();
    }
  });

  test("带 open 的 details 记录折叠状态", () => {
    const markdown = ["<details open>", "", "正文", "", "</details>"].join("\n");
    const editor = createEditor(markdown);
    try {
      assert.equal(editor.state.doc.child(0).attrs.open, true);
    } finally {
      editor.destroy();
    }
  });

  test("未配平的容器保持字面文本", () => {
    const markdown = ['<div align="center">', "", "正文", "", "结尾段落"].join("\n");
    const editor = createEditor(markdown);
    try {
      assert.deepEqual(topLevelTypes(editor), ["paragraph", "paragraph", "paragraph"]);
      assert.equal(editor.state.doc.child(0).textContent, '<div align="center">');
    } finally {
      editor.destroy();
    }
  });

  test("单块内只有行内容的对齐容器保持居中段落", () => {
    const editor = createEditor('<div align="center"><img src="https://example.com/a.svg" /></div>');
    try {
      assert.deepEqual(topLevelTypes(editor), ["paragraph"]);
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");
    } finally {
      editor.destroy();
    }
  });
});
