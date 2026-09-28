import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

/*
 * 图片文件整理（重命名/移动/删除）之后，文档里的引用必须跟着改：
 * 只改写地址完全相同的图片节点，其它图片与正文不受影响。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;
let rewriteImageSource: typeof import("./imageFileActions").rewriteImageSource;
let removeImageReferences: typeof import("./imageFileActions").removeImageReferences;
let isLocalImageSource: typeof import("./imageFileActions").isLocalImageSource;

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
  ({ rewriteImageSource, removeImageReferences, isLocalImageSource } = await import(
    "./imageFileActions"
  ));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const withEditor = async <T>(
  markdown: string,
  run: (editor: Editor) => T,
): Promise<T> => {
  const editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    return run(editor);
  } finally {
    editor.destroy();
  }
};

const IMAGE_MARKDOWN = [
  "正文一。",
  "",
  "![第一张](assets/a.png)",
  "",
  "正文二。",
  "",
  "![第二张](assets/a.png)",
  "",
  "![别的图](assets/b.png)",
].join("\n");

describe("图片引用改写", () => {
  test("同一地址的多处引用一起改写，其它引用不动", async () => {
    const result = await withEditor(IMAGE_MARKDOWN, (editor) => {
      const changed = rewriteImageSource(editor, "assets/a.png", "assets/新名字.png");
      return { changed, markdown: editor.getMarkdown() };
    });

    assert.equal(result.changed, 2);
    assert.equal(result.markdown.match(/assets\/新名字\.png/gu)?.length, 2);
    assert.ok(result.markdown.includes("assets/b.png"), "其它图片的地址不应被改动");
    assert.ok(result.markdown.includes("正文一。") && result.markdown.includes("正文二。"));
  });

  test("地址不存在时不做任何改动", async () => {
    const result = await withEditor(IMAGE_MARKDOWN, (editor) => {
      const changed = rewriteImageSource(editor, "assets/没有这张.png", "assets/x.png");
      return { changed, markdown: editor.getMarkdown() };
    });

    assert.equal(result.changed, 0);
    assert.ok(!result.markdown.includes("assets/x.png"));
  });

  test("删除引用只删掉对应图片，正文保留", async () => {
    const result = await withEditor(IMAGE_MARKDOWN, (editor) => {
      const removed = removeImageReferences(editor, "assets/a.png");
      return { removed, markdown: editor.getMarkdown() };
    });

    assert.equal(result.removed, 2);
    assert.ok(!result.markdown.includes("assets/a.png"));
    assert.ok(result.markdown.includes("assets/b.png"));
    assert.ok(result.markdown.includes("正文一。") && result.markdown.includes("正文二。"));
  });
});

describe("本地图片判定", () => {
  test("远程地址与 data URL 不算本地图片", () => {
    assert.equal(isLocalImageSource("assets/a.png"), true);
    assert.equal(isLocalImageSource("../images/a.png"), true);
    assert.equal(isLocalImageSource("https://example.com/a.png"), false);
    assert.equal(isLocalImageSource("HTTP://example.com/a.png"), false);
    assert.equal(isLocalImageSource("data:image/png;base64,AAAA"), false);
  });
});
