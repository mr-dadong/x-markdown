import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

// 用户上报的真实场景：行内小图标写在链接里。
//
// [<span style="color: rgb(0, 0, 0);">![favicon](https://…/favicon.ico)瑞幸咖啡官方FAQ</span>](https://…/faq)
//
// 期望：图标按标注尺寸缩小到与文字协调，同时链接、颜色、文字都完整保留。
// 这里同时覆盖「HTML 尺寸属性」与「Markdown 图片语法」两种写法。

const LUCKIN_ICON = "https://www.luckincoffee.co/favicon.ico";
const LUCKIN_FAQ = "https://www.luckincoffee.co/faq/franchising";

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
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

describe("链接里的行内小图标", () => {
  test("带尺寸标注的图标：尺寸生效，链接与文字保留", () => {
    const markdown = `[<span style="color: rgb(0, 0, 0);"><img src="${LUCKIN_ICON}" alt="favicon" width="16" height="16">瑞幸咖啡官方FAQ</span>](${LUCKIN_FAQ})`;
    const dom = withEditor(markdown, (editor) => editor.view.dom);
    const image = dom.querySelector("img");
    const link = dom.querySelector("a");

    assert.ok(image, "图标应渲染为 img");
    // 关键断言：图标尺寸来自用户标注，而不是图片自然尺寸。
    assert.match(image.getAttribute("style") ?? "", /width:\s*16px/u);
    assert.match(image.getAttribute("style") ?? "", /height:\s*16px/u);
    assert.ok(link, "整段仍应是链接");
    assert.equal(link.getAttribute("href"), LUCKIN_FAQ);
    assert.match(dom.textContent ?? "", /瑞幸咖啡官方FAQ/u);
  });

  test("带尺寸标注的图标：存盘后尺寸与链接都不丢（往返一致）", () => {
    const markdown = `[<span style="color: rgb(0, 0, 0);"><img src="${LUCKIN_ICON}" alt="favicon" width="16" height="16">瑞幸咖啡官方FAQ</span>](${LUCKIN_FAQ})`;
    const saved = withEditor(markdown, (editor) => editor.storage.markdown.getMarkdown());
    assert.match(saved, /width="16"/u);
    assert.match(saved, /height="16"/u);
    assert.match(saved, new RegExp(LUCKIN_FAQ.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

    // 二次打开仍然保留尺寸
    const style = withEditor(saved, (editor) => editor.view.dom.querySelector("img")?.getAttribute("style") ?? "");
    assert.match(style, /height:\s*16px/u);
  });

  test("不带尺寸标注时保持原样，不擅自改写用户的 Markdown", () => {
    const markdown = `[<span style="color: rgb(0, 0, 0);">![favicon](${LUCKIN_ICON})瑞幸咖啡官方FAQ</span>](${LUCKIN_FAQ})`;
    const saved = withEditor(markdown, (editor) => editor.storage.markdown.getMarkdown());
    // 未标注尺寸就不应凭空生成 width/height
    assert.ok(!saved.includes("width="), "没有标注尺寸时不应写入 width");
    assert.ok(!saved.includes("height="), "没有标注尺寸时不应写入 height");
    assert.match(saved, /瑞幸咖啡官方FAQ/u);
  });
});
