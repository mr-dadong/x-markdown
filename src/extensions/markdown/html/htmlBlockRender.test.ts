import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";
import { HTML_BLOCK_CHUNK_ATTRIBUTE, HTML_BLOCK_OPEN_ATTRIBUTE } from "../../../editor/htmlBlockSourceForm";

/*
 * 块级 HTML 子集的渲染与保真。
 *
 * 这些用例对应 README 里的典型写法：居中的 `<div>` 包 logo、`<hr>` 分隔、一排徽章
 * `<a href><img></a>`。要求是「预览视图里照着网页渲染」，同时满足两条底线：
 * - 没编辑过的块存盘逐字节还原，不能因为一个源码块变成多个节点而重复内容；
 * - 认领不了的内容（注释、表格、认不出的标签）整体保持可编辑的字面文本，内容不丢。
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

/** 顶层节点类型，忽略末尾由 TrailingParagraph 维护的空段落。 */
const topLevelTypes = (editor: Editor): string[] => {
  const content: JSONContent[] = editor.state.doc.toJSON().content ?? [];
  return content
    .filter((node, index) => !(
      index === content.length - 1 && node.type === "paragraph" && !node.content
    ))
    .map((node) => String(node.type));
};

// README 风格片段：logo（百分比宽度）+ 分隔线 + 两个徽章。
const README_HTML = `<div align="center">
  <img src="https://example.com/logo.svg" width="60%" alt="Logo" />
</div>
<hr>
<div align="center" style="line-height: 1;">
 <a href="https://example.com/home" target="_blank">
  <img alt="Homepage" src="https://example.com/badge.svg" />
 </a>
 <a href="https://example.com/chat">
  <img alt="Chat" src="https://example.com/chat.svg" />
 </a>
</div>
`;

describe("块级 HTML 子集渲染", () => {
  test("居中的 div、hr、徽章都变成真正的节点", async () => {
    const editor = await createEditor(README_HTML);
    try {
      assert.deepEqual(topLevelTypes(editor), ["paragraph", "horizontalRule", "paragraph"]);

      const logoParagraph = editor.state.doc.child(0);
      assert.equal(logoParagraph.attrs.textAlign, "center");
      assert.equal(logoParagraph.attrs[HTML_BLOCK_OPEN_ATTRIBUTE], '<div align="center">');
      const logo = logoParagraph.child(0);
      assert.equal(logo.type.name, "image");
      assert.equal(logo.attrs.src, "https://example.com/logo.svg");
      // 百分比宽度必须原样保留，不能被 parseInt 读成 60 像素。
      assert.equal(logo.attrs.width, "60%");

      const rule = editor.state.doc.child(1);
      assert.equal(rule.attrs[HTML_BLOCK_OPEN_ATTRIBUTE], "<hr>");

      // 同一个块产出的多个节点共用一个分组编号，增量保存据此把它们当一个源码块。
      const chunkIds = [0, 1, 2].map((index) => editor.state.doc.child(index).attrs[HTML_BLOCK_CHUNK_ATTRIBUTE]);
      assert.equal(typeof chunkIds[0], "string");
      assert.deepEqual(chunkIds, [chunkIds[0], chunkIds[0], chunkIds[0]]);
    } finally {
      editor.destroy();
    }
  });

  test("徽章的行内 HTML 走既有行内解析：图片带链接标记", async () => {
    const editor = await createEditor(README_HTML);
    try {
      const badges: Array<{ src: string; href: string | null }> = [];
      editor.state.doc.child(2).descendants((node) => {
        if (node.type.name !== "image") return true;
        const link = node.marks.find((mark) => mark.type.name === "link");
        badges.push({ src: String(node.attrs.src), href: link ? String(link.attrs.href) : null });
        return true;
      });
      assert.deepEqual(badges, [
        { src: "https://example.com/badge.svg", href: "https://example.com/home" },
        { src: "https://example.com/chat.svg", href: "https://example.com/chat" },
      ]);
    } finally {
      editor.destroy();
    }
  });

  test("渲染出的 DOM 与网页一致：居中段落 + 百分比宽度 + 分隔线", async () => {
    const editor = await createEditor(README_HTML);
    try {
      const paragraph = editor.view.dom.children[0] as HTMLElement;
      assert.equal(paragraph.getAttribute("style"), "text-align: center;");
      assert.equal(paragraph.querySelector("img")?.style.width, "60%");
      assert.equal(editor.view.dom.children[1]?.tagName.toLowerCase(), "hr");
    } finally {
      editor.destroy();
    }
  });

  test("行内换行只是空白：徽章排在同一段里而不是各自成行", async () => {
    const editor = await createEditor(README_HTML);
    try {
      // 两个徽章之间只有一个文本空格，说明 div 里的换行按 HTML 规则折叠成了空格。
      const texts: string[] = [];
      editor.state.doc.child(2).forEach((node) => {
        if (node.isText) texts.push(String(node.text));
      });
      assert.deepEqual(texts, [" "]);
    } finally {
      editor.destroy();
    }
  });

  test("没有对齐信息的容器仍是可编辑的字面文本", async () => {
    const editor = await createEditor("<div>dadong</div>");
    try {
      assert.deepEqual(topLevelTypes(editor), ["paragraph"]);
      assert.equal(editor.state.doc.textContent, "<div>dadong</div>");
    } finally {
      editor.destroy();
    }
  });

  test("认领不了的内容整体保持字面文本，内容一字不丢", async () => {
    const cases = [
      "<!-- markdownlint-disable html -->",
      '<div style="display: flex">横排</div>',
      '<div align="center"><p>容器里是块级标签</p></div>',
      "<table><tr><td>x</td></tr></table>",
      '<p align="center">文字 <span>认不出的标签</span></p>',
    ];
    for (const source of cases) {
      const editor = await createEditor(source);
      try {
        assert.deepEqual(topLevelTypes(editor), ["paragraph"], `应保持单个字面文本段落：${source}`);
        if (source.includes("<span>")) {
          // 认不出的行内标签由既有补丁保留成字面文本，这里只要求容器被认领成居中段落。
          assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");
        } else {
          assert.equal(editor.state.doc.textContent, source);
        }
      } finally {
        editor.destroy();
      }
    }
  });

  test("带 style 的复杂 HTML 继续走隔离预览块", async () => {
    const editor = await createEditor('<style>.x { color: red; }</style><div class="x">ddd</div>');
    try {
      // 整块（含后面的 div）原样进隔离预览，不在正文里执行。
      assert.deepEqual(topLevelTypes(editor), ["htmlBlock"]);
    } finally {
      editor.destroy();
    }
  });

  test("独立一行写百分比宽度的 img 也按百分比渲染", async () => {
    const editor = await createEditor('<img src="https://example.com/a.svg" width="60%" alt="x">');
    try {
      const image = editor.state.doc.child(0).child(0);
      assert.equal(image.type.name, "image");
      assert.equal(image.attrs.width, "60%");
      const rendered = editor.view.dom.querySelector("img");
      assert.equal(rendered?.style.width, "60%");
    } finally {
      editor.destroy();
    }
  });

  /*
   * README 里常用「开标签、空行、Markdown 表格、空行、闭标签」把表格居中。
   * 这种标签在源码里被空行切成不同的块：开标签单独一块。它里面的内容不在同一块里，
   * 认领成空段落既没有意义，又会和解析器补出的空段落撞车、让增量保存的块对账错位，
   * 因此必须整段交回字面文本 —— 这也是改动前的行为。
   */
  test("被空行隔开的容器开标签不认领，保持字面文本", async () => {
    const markdown = '<div align="center">\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n</div>\n';
    const editor = await createEditor(markdown);
    try {
      assert.deepEqual(topLevelTypes(editor), ["paragraph", "table", "paragraph"]);
      /*
       * 字面文本按块原文整段保留，但块尾换行必须剥掉：marked 的 html token 带着它们，
       * 而 ProseMirror 的 white-space: break-spaces 会把它渲染成段落末尾的一个空行
       * （连续几行 HTML 注释看起来被空行隔开就是这么来的）。
       */
      assert.equal(editor.state.doc.child(0).textContent, '<div align="center">');
    } finally {
      editor.destroy();
    }
  });

  test("键入即渲染：敲完 </div> 当场变成居中段落", async () => {
    const editor = await createEditor("");
    try {
      const text = '<div align="center">居中</div>';
      for (const character of text) {
        const view = editor.view;
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (handler) =>
          handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      }
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");
      assert.equal(editor.state.doc.textContent, "居中");
    } finally {
      editor.destroy();
    }
  });
});

describe("块级 HTML 认领后的写回保真", () => {
  const loadAndSerialize = async (
    markdown: string,
  ): Promise<{ editor: Editor; source: string; save: () => string }> => {
    const { captureBaseline, serializePreservingSource } = await import(
      "../../../editor/sourcePreservingSerializer"
    );
    const editor = await createEditor(markdown);
    const baseline = captureBaseline(editor, markdown);
    return {
      editor,
      source: serializePreservingSource(editor, baseline),
      save: () => serializePreservingSource(editor, baseline),
    };
  };

  test("未编辑时逐字节还原：一个源码块的多个节点不会被重复写入", async () => {
    const { editor, source } = await loadAndSerialize(README_HTML);
    try {
      assert.equal(source, README_HTML);
    } finally {
      editor.destroy();
    }
  });

  test("块后面还有内容时，后面的块照样原样保留", async () => {
    const markdown = `${README_HTML}\n正文段落\n`;
    const { editor, source } = await loadAndSerialize(markdown);
    try {
      assert.equal(source, markdown);
    } finally {
      editor.destroy();
    }
  });

  /*
   * 回归：`<div>` 与 `</div>` 被空行隔开（包住 Markdown 表格）时，开标签那一块曾经被
   * 认领成空段落，接着被当成解析器补出的占位段落跳过，块对账整体错位一格，
   * 保存时直接抛「无法建立原文基准」。这类文档必须与改动前一样逐字节还原。
   */
  test("开标签包表格的写法：未编辑时逐字节还原", async () => {
    const markdown = '正文\n\n<div align="center">\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n</div>\n\n结尾\n';
    const { editor, source } = await loadAndSerialize(markdown);
    try {
      assert.equal(source, markdown);
    } finally {
      editor.destroy();
    }
  });

  test("编辑居中的段落：开标签与 <hr> 按用户写法写回", async () => {
    const { editor, save } = await loadAndSerialize(README_HTML);
    try {
      // 在第一个居中段落里插一个字符（位置 2 = 图片之后）。
      editor.view.dispatch(editor.state.tr.insertText("新", 2));
      const saved = save();
      assert.match(saved, /^<div align="center">\n/u);
      assert.match(saved, /width="60%"/u);
      assert.match(saved, /<\/div>\n\n<hr>\n\n<div align="center" style="line-height: 1;">/u);
      assert.ok(saved.includes("新"), "编辑内容应写回");
    } finally {
      editor.destroy();
    }
  });

  test("写回结果再次打开、再次保存仍然稳定", async () => {
    const { editor, save } = await loadAndSerialize(README_HTML);
    const saved = (() => {
      editor.view.dispatch(editor.state.tr.insertText("新", 2));
      return save();
    })();
    editor.destroy();

    const reopened = await loadAndSerialize(saved);
    try {
      assert.deepEqual(topLevelTypes(reopened.editor), ["paragraph", "horizontalRule", "paragraph"]);
      assert.equal(reopened.save(), saved, "往返不应继续变化");
    } finally {
      reopened.editor.destroy();
    }
  });
});
