import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { readStylePixels, readStyleZoom, stripStyleSizes } from "./imageStyle";

// 图片尺寸（width/height）必须被完整接收、渲染并写回。
//
// 背景：Markdown 图片语法不表达尺寸，社区通行做法是写 HTML
// `<img src="..." width="16" height="16">`（favicon、徽章等行内小图标尤其常见）。
// 此前 image 节点只认 width，height 被静默丢弃，图片退化成自然尺寸，
// 24×24 或 48×48 的图标放进正文会明显大于文字。
//
// 行内与独占一段的 <img> 都应进入图片节点，统一获得预览、框选和尺寸调整能力。

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
  const editor = new EditorConstructor({ extensions: createEditorExtensions(), content, contentType: "markdown" });
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
  // 两张百分比图片应各自占正文的指定比例，保存和重新调整尺寸时也要保留正确行为。
  test("并排图片的百分比宽度作用于容器，切换像素尺寸后解除百分比限制", () => {
    const content = '<div align="center">\n<img src="https://example.com/a.png" width="48%">\n<img src="https://example.com/b.png" width="48%">\n</div>';
    withEditor(content, (editor) => {
      const wrappers = editor.view.dom.querySelectorAll<HTMLElement>("[data-xmd-image]");
      assert.equal(wrappers.length, 2);
      for (const wrapper of wrappers) {
        assert.equal(wrapper.style.width, "48%");
        assert.ok(wrapper.hasAttribute("data-xmd-image-percent"), "百分比插图不应被当成行内小图标");
        assert.ok(wrapper.querySelector("img")?.classList.contains("w-full"));
        assert.equal(wrapper.querySelector("img")?.style.width, "");
      }
      assert.match(editor.getMarkdown(), /width="48%"/u);

      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (position === -1 && node.type.name === "image") position = pos;
      });
      const image = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...image.attrs, width: 320 }));
      assert.equal(wrappers[0].style.width, "");
      assert.equal(wrappers[0].hasAttribute("data-xmd-image-percent"), false);
      assert.equal(wrappers[0].querySelector("img")?.style.width, "320px");
      assert.equal(wrappers[0].querySelector("img")?.classList.contains("w-full"), false);
      assert.equal(wrappers[1].style.width, "48%");
    });
  });

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

  test("选中图片时使用与视频一致的标准节点选中类", () => {
    withEditor("![普通图](https://example.com/b.png)", (editor) => {
      let imagePosition = -1;
      editor.state.doc.descendants((node, position) => {
        if (node.type.name !== "image") return true;
        imagePosition = position;
        return false;
      });
      assert.ok(imagePosition >= 0, "应能找到图片节点");

      editor.commands.setNodeSelection(imagePosition);

      const wrapper = editor.view.dom.querySelector<HTMLElement>("[data-xmd-image]");
      assert.ok(wrapper?.classList.contains("ProseMirror-selectednode"));
      const selectionSurface = wrapper?.querySelector<HTMLElement>(".bg-\\[\\#007aff\\]\\/\\[0\\.20\\]");
      assert.ok(selectionSurface && !selectionSurface.classList.contains("hidden"));
    });
  });

  test("非法尺寸被忽略，不会写入 NaN", () => {
    const image = withEditor(inlineImage('width="auto" height="-5"'), findImageNode);
    assert.equal(image?.attrs.width, null);
    assert.equal(image?.attrs.height, null);
  });

  test("存盘时尺寸原样写回 HTML，不丢失", () => {
    const markdown = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => editor.getMarkdown(),
    );
    assert.match(markdown, /width="16"/u);
    assert.match(markdown, /height="16"/u);
  });

  test("存盘再打开，尺寸仍然保留（往返一致）", () => {
    const saved = withEditor(
      inlineImage('width="16" height="16"'),
      (editor) => editor.getMarkdown(),
    );
    const image = withEditor(saved, findImageNode);
    assert.equal(image?.attrs.width, 16);
    assert.equal(image?.attrs.height, 16);
  });

  test("只写 width 时也能往返（height 交给浏览器按比例计算）", () => {
    const saved = withEditor(
      inlineImage('width="320"'),
      (editor) => editor.getMarkdown(),
    );
    assert.match(saved, /width="320"/u);
    const image = withEditor(saved, findImageNode);
    assert.equal(image?.attrs.width, 320);
    assert.equal(image?.attrs.height, null);
  });

  test("无尺寸图片继续使用 Markdown 语法，不退化写成 HTML", () => {
    const markdown = withEditor(
      "![普通图](https://example.com/b.png)",
      (editor) => editor.getMarkdown(),
    );
    assert.equal(markdown, "![普通图](https://example.com/b.png)");
  });

  test("独占一段的裸 img 解析为图片节点并保留尺寸", () => {
    const raw = '<img src="https://example.com/icon.ico" alt="icon" width="16" height="16">';
    const result = withEditor(raw, (editor) => ({
      image: findImageNode(editor),
      htmlBlockCount: editor.state.doc.content.content.filter(node => node.type.name === "htmlBlock").length,
      markdown: editor.getMarkdown(),
    }));
    assert.equal(result.image?.attrs.width, 16);
    assert.equal(result.image?.attrs.height, 16);
    assert.equal(result.htmlBlockCount, 0);
    assert.equal(result.markdown, raw);
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
        return editor.getMarkdown();
      },
    );
    assert.match(saved, /width="240"/u);
    assert.ok(!saved.includes("height="), "调整宽度后不应再保留固定高度");
  });
});

describe("图片 style 属性", () => {
  // Typora 用 style 表达尺寸与 retina 缩放（style="zoom:50%"）；
  // 编辑器只让尺寸类声明生效，但整段 style 必须原样写回，不能静默丢失。
  test("style 原文在存盘后保留（此前会被整条丢弃）", () => {
    const saved = withEditor(
      inlineImage('style="zoom:50%"'),
      (editor) => editor.getMarkdown(),
    );
    assert.match(saved, /style="zoom:50%"/u, `style 必须写回，实际输出：${saved}`);
  });

  test("style 里的 zoom 在编辑器里生效", () => {
    const style = withEditor(
      inlineImage('style="zoom:50%"'),
      (editor) => editor.view.dom.querySelector("img")?.getAttribute("style") ?? "",
    );
    assert.match(style, /zoom:\s*50%/u, `zoom 应作用到图片上，实际样式：${style}`);
  });

  test("style 里的宽度用于显示，写回时不会重复生成 width 属性", () => {
    const result = withEditor(inlineImage('style="width:320px"'), (editor) => ({
      style: editor.view.dom.querySelector("img")?.getAttribute("style") ?? "",
      markdown: editor.getMarkdown(),
    }));

    assert.match(result.style, /width:\s*320px/u);
    assert.ok(
      !result.markdown.includes("width="),
      `尺寸已由 style 表达，不应再写 width 属性：${result.markdown}`,
    );
  });

  test("width 属性与 style 同时存在时都保留，属性优先显示", () => {
    const result = withEditor(
      inlineImage('width="100" style="zoom:50%"'),
      (editor) => ({
        style: editor.view.dom.querySelector("img")?.getAttribute("style") ?? "",
        markdown: editor.getMarkdown(),
      }),
    );

    assert.match(result.style, /width:\s*100px/u);
    assert.match(result.markdown, /width="100"/u);
    assert.match(result.markdown, /style="zoom:50%"/u);
  });

  test("调整宽度后 style 里的固定宽高被去掉，zoom 等其它声明保留", () => {
    // 与拖动控制点提交时的处理保持一致：宽高声明交给 width 属性表达。
    const strippedStyle = stripStyleSizes("width:320px; height:100px; zoom:50%");
    const saved = withEditor(
      inlineImage('style="width:320px; height:100px; zoom:50%"'),
      (editor) => {
        let imagePosition = -1;
        editor.state.doc.descendants((node, position) => {
          if (node.type.name !== "image") return true;
          imagePosition = position;
          return false;
        });
        assert.ok(imagePosition >= 0, "应能找到图片节点");
        const attrs = editor.state.doc.nodeAt(imagePosition)?.attrs ?? {};
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(imagePosition, undefined, {
            ...attrs,
            width: 240,
            height: null,
            styleSource: strippedStyle,
          }),
        );
        return editor.getMarkdown();
      },
    );

    assert.match(saved, /width="240"/u);
    assert.match(saved, /style="zoom:50%"/u);
    assert.ok(!/height/iu.test(saved), `固定高度必须去掉，实际输出：${saved}`);
  });
});

describe("style 解析规则", () => {
  test("宽高只认 px，zoom 只认百分比", () => {
    assert.equal(readStylePixels("width:320px", "width"), 320);
    assert.equal(readStylePixels(" width : 12.6px ", "width"), 13);
    assert.equal(readStylePixels("width:auto", "width"), null);
    assert.equal(readStylePixels("width:100%", "width"), null);
    assert.equal(readStylePixels(null, "height"), null);

    assert.equal(readStyleZoom("zoom:50%"), 50);
    assert.equal(readStyleZoom("zoom:1.5"), null);
    assert.equal(readStyleZoom(null), null);
  });

  test("去掉宽高声明时保留其它声明", () => {
    assert.equal(stripStyleSizes("width:320px; height:100px; zoom:50%"), "zoom:50%");
    assert.equal(stripStyleSizes("zoom:50%;width:320px"), "zoom:50%");
    assert.equal(stripStyleSizes("width:320px"), null);
    assert.equal(stripStyleSizes(null), null);
  });
});
