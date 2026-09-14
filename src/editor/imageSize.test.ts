import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

// 图片尺寸（width/height）必须被完整接收、渲染并写回。
//
// 背景：Markdown 图片语法不表达尺寸，社区通行做法是写 HTML
// `<img src="..." width="16" height="16">`（favicon、徽章等行内小图标尤其常见）。
// 此前 image 节点只认 width，height 被静默丢弃，图片退化成自然尺寸，
// 24×24 或 48×48 的图标放进正文会明显大于文字。
//
// 注意测试写法：独占一段的裸 <img> 会被 markdown-it 判为 HTML 块，
// 走 HtmlBlock 原样保留路径（也安全，但不是图片节点）。
// 只有「行内」的 <img> 才会进入图片节点的解析逻辑，所以这里一律放进链接或文字中间。

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  // 图片节点视图会通过 electronAPI 读取本地资源，测试里给一个最小替身。
  (browserWindow as unknown as { electronAPI: unknown }).electronAPI = {
    readEditorImage: async () => "",
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

const withEditor = <T>(content: string, inspect: (editor: InstanceType<typeof EditorConstructor>) => T): T => {
  const editor = new EditorConstructor({ extensions: createEditorExtensions(), content });
  try {
    return inspect(editor);
  } finally {
    editor.destroy();
  }
};

// 让 <img> 落在行内：包进链接里，与真实使用场景一致。
const inlineImage = (attributes: string): string =>
  `[<img src="https://example.com/icon.ico" alt="icon" ${attributes}>说明文字](https://example.com/page)`;

const findImageNode = (editor: InstanceType<typeof EditorConstructor>) => {
  let found: { attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "image") return true;
    found = { attrs: node.attrs };
    return false;
  });
  return found;
};

describe("图片尺寸属性", () => {
  test("HTML 的 width 与 height 都会被节点接收", () => {
    const image = withEditor(inlineImage('width="16" height="16"'), findImageNode);
    assert.equal(image?.attrs.width, 16);
    assert.equal(image?.attrs.height, 16);
  });

  test("节点视图把尺寸写成内联样式，避免被全局 height:auto 覆盖", () => {
    const style = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => editor.view.dom.querySelector("img")?.getAttribute("style") ?? "",
    );
    assert.match(style, /width:\s*16px/u);
    assert.match(style, /height:\s*16px/u);
  });

  test("非法尺寸被忽略，不会写入 NaN", () => {
    const image = withEditor(inlineImage('width="auto" height="-5"'), findImageNode);
    assert.equal(image?.attrs.width, null);
    assert.equal(image?.attrs.height, null);
  });

  test("存盘时尺寸原样写回 HTML，不丢失", () => {
    const markdown = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => editor.storage.markdown.getMarkdown(),
    );
    assert.match(markdown, /width="16"/u);
    assert.match(markdown, /height="16"/u);
  });

  test("存盘再打开，尺寸仍然保留（往返一致）", () => {
    const saved = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => editor.storage.markdown.getMarkdown(),
    );
    const image = withEditor(saved, findImageNode);
    assert.equal(image?.attrs.width, 16);
    assert.equal(image?.attrs.height, 16);
  });

  test("只写 width 时也能往返（height 交给浏览器按比例计算）", () => {
    const saved = withEditor(
      inlineImage('width="320"'),
      (editor) => editor.storage.markdown.getMarkdown(),
    );
    assert.match(saved, /width="320"/u);
    const image = withEditor(saved, findImageNode);
    assert.equal(image?.attrs.width, 320);
    assert.equal(image?.attrs.height, null);
  });

  test("无尺寸图片继续使用 Markdown 语法，不退化写成 HTML", () => {
    const markdown = withEditor(
      "![普通图](https://example.com/b.png)",
      (editor) => editor.storage.markdown.getMarkdown(),
    );
    assert.equal(markdown, "![普通图](https://example.com/b.png)");
  });

  test("独占一段的裸 img 由 HtmlBlock 原样保留，内容不丢", () => {
    const raw = '<img src="https://example.com/icon.ico" alt="icon" width="16" height="16">';
    const markdown = withEditor(raw, (editor) => editor.storage.markdown.getMarkdown());
    assert.equal(markdown, raw);
  });

  test("手动调整宽度后会清掉固定高度，避免宽高比锁死把图片拉变形", () => {
    const saved = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => {
        // 直接模拟一次「拖动控制点后提交宽度」的事务，验证高度随后被清除。
        let imagePosition = -1;
        editor.state.doc.descendants((node, position) => {
          if (node.type.name !== "image") return true;
          imagePosition = position;
          return false;
        });
        assert.ok(imagePosition >= 0, "应能找到图片节点");
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(imagePosition, undefined, {
            ...editor.state.doc.nodeAt(imagePosition)?.attrs,
            width: 240,
            height: null,
          }),
        );
        return editor.storage.markdown.getMarkdown();
      },
    );
    assert.match(saved, /width="240"/u);
    assert.ok(!saved.includes("height="), "调整宽度后不应再保留固定高度");
  });
});
