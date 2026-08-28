import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

let browserWindow: Window;
let EditorConstructor: typeof import("@tiptap/vue-3").Editor;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let buildWriterContext: typeof import("./writerContext").buildWriterContext;
let buildBreadcrumb: typeof import("./writerContext").buildBreadcrumb;
let findSectionRange: typeof import("./writerContext").findSectionRange;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/vue-3"));
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
  ({ buildWriterContext, buildBreadcrumb, findSectionRange } = await import("./writerContext"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

// 在文档中定位包含指定文字的文本位置，模拟光标落点。
const findPosOfText = (doc: ProseMirrorNode, text: string): number => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
      return false;
    }
    return true;
  });
  assert.notEqual(found, -1, `文档中未找到文本：${text}`);
  return found;
};

const createEditor = (markdown: string) =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
  });

// 生成长段落文本，用于触发截断逻辑。
const filler = (tag: string) => `${tag}：${"内容".repeat(45)}`;

describe("标题面包屑与章节范围（纯函数）", () => {
  const headings = [
    { pos: 0, level: 1, text: "一级" },
    { pos: 20, level: 3, text: "三级" },
    { pos: 40, level: 2, text: "二级" },
    { pos: 60, level: 1, text: "下一章" },
  ];

  test("面包屑遇到更浅标题时替换更深层级", () => {
    // 光标在"二级"之后：h3 被同级的 h2 结构替换，链路为 一级 > 二级
    assert.deepEqual(buildBreadcrumb(headings, 50), ["一级", "二级"]);
  });

  test("光标前的标题按层级跳跃保留", () => {
    // 光标在"三级"之后、"二级"之前：链路为 一级 > 三级
    assert.deepEqual(buildBreadcrumb(headings, 30), ["一级", "三级"]);
  });

  test("章节范围到下一个同级或更高级标题为止", () => {
    // 光标在"二级"章节内：从"二级"开始，到"下一章"（h1）结束
    assert.deepEqual(findSectionRange(headings, 50, 100), { from: 40, to: 60 });
  });

  test("光标前无标题时章节从文档开头到第一个标题", () => {
    // pos=0 位于第一个标题起点之前
    assert.deepEqual(findSectionRange(headings, 0, 100), { from: 0, to: 20 });
  });
});

describe("编写上下文提取", () => {
  test("多级标题生成完整面包屑并只携带当前章节", () => {
    const editor = createEditor(
      "# 部署文档\n\n环境说明。\n\n## Docker 部署\n\n镜像准备。\n\n### 附录 B\n\n清单说明。\n\n# 下一章\n\n后续内容。\n",
    );
    try {
      const pos = findPosOfText(editor.state.doc, "清单说明");
      const context = buildWriterContext(editor.state.doc, pos);
      assert.ok(
        context.startsWith("所在章节（标题路径）：部署文档 > Docker 部署 > 附录 B"),
        `面包屑不正确：${context}`,
      );
      // 当前章节内容围绕光标，其他章节不应进入上下文
      assert.match(context, /附录 B/);
      assert.match(context, /▍/);
      assert.doesNotMatch(context, /环境说明/);
      assert.doesNotMatch(context, /后续内容/);
    } finally {
      editor.destroy();
    }
  });

  test("长章节按光标前后预算截断", () => {
    const paragraphs = ["# 长章节"];
    for (let i = 0; i < 30; i += 1) paragraphs.push(filler(`段落${i}`));
    paragraphs.push("# 下一节");
    paragraphs.push("边界外的内容。");

    const editor = createEditor(paragraphs.join("\n\n"));
    try {
      const pos = findPosOfText(editor.state.doc, "段落25");
      const context = buildWriterContext(editor.state.doc, pos);
      // 光标前的长文被截断：最早段落出局，临近段落保留
      assert.doesNotMatch(context, /段落0：/);
      assert.match(context, /段落24/);
      assert.match(context, /…/);
      // 下一节的内容不属于当前章节
      assert.doesNotMatch(context, /边界外的内容/);
    } finally {
      editor.destroy();
    }
  });

  test("无标题文档降级为光标周围窗口", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 40; i += 1) paragraphs.push(filler(`行${i}`));

    const editor = createEditor(paragraphs.join("\n\n"));
    try {
      const pos = findPosOfText(editor.state.doc, "行20");
      const context = buildWriterContext(editor.state.doc, pos);
      assert.ok(context.startsWith("正文片段（▍ 为写入位置）"), `缺少窗口标签：${context}`);
      assert.doesNotMatch(context, /行0：/);
      assert.match(context, /行19/);
      assert.match(context, /行21/);
      assert.match(context, /…/);
    } finally {
      editor.destroy();
    }
  });

  test("光标位于段落中间时前后内容以写入点分隔", () => {
    const editor = createEditor("# 标题\n\n前半段文字，后半段文字。\n");
    try {
      const pos = findPosOfText(editor.state.doc, "，") + 1;
      const context = buildWriterContext(editor.state.doc, pos);
      assert.match(context, /前半段文字，▍后半段文字/);
    } finally {
      editor.destroy();
    }
  });

  test("光标在第一个标题之前时说明位置", () => {
    const editor = createEditor("# 标题\n\n正文内容。\n");
    try {
      const context = buildWriterContext(editor.state.doc, 0);
      assert.ok(
        context.startsWith("所在章节：第一个标题之前"),
        `缺少位置说明：${context}`,
      );
    } finally {
      editor.destroy();
    }
  });
});
