import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";
import { findClaimableHtmlBlock, scanLineDepths } from "./htmlBlockClaim";

/*
 * 手写块级 HTML 的认领。
 *
 * 打开文件时的块级 HTML 由解析器认领成节点，而所见即所得视图里手写、粘贴进来的
 * HTML 起初只是普通段落文本。本文件锁住两件事：
 * - 判据：只有「标签闭合、且起点不在未闭合标签内部」的一段连续段落才会被认领，
 *   半截 HTML 不能提前认领（否则用户后面补的收尾标签会变成孤立文本）；
 * - 结果：认领走的是与打开文件相同的解析路径，认不了的（注释、`<div>dadong</div>`、
 *   表格）照旧保持可编辑的字面文本。
 */

describe("标签深度扫描", () => {
  test("普通标签成对闭合后回到 0，未闭合的挂在 1", () => {
    assert.deepEqual(scanLineDepths("<div>\n<img />\n</div>"), [1, 1, 0]);
    assert.deepEqual(scanLineDepths("<div>\n<img />"), [1, 1]);
  });

  test("注释放、引号里的尖括号、自闭合与 void 元素都不改变深度", () => {
    assert.deepEqual(scanLineDepths("<!-- <div> -->"), [0]);
    assert.deepEqual(scanLineDepths('<img alt="a > b" src="x.png">'), [0]);
    assert.deepEqual(scanLineDepths("<hr>"), [0]);
    assert.deepEqual(scanLineDepths("<div>\n<!--\n多行注释\n-->\n</div>"), [1, 1, 1, 1, 0]);
  });

  test("script / style 的内容按纯文本处理", () => {
    assert.deepEqual(scanLineDepths("<style>.x > .y { color: red; }</style>"), [0]);
    assert.deepEqual(scanLineDepths("<script>if (a < b) {}</script>"), [0]);
  });
});

describe("候选区间的挑选", () => {
  /**
   * 认领用的替身解析器：只有「整段就是一个或多个居中 div」才认领，其余原样回字面文本。
   * 与真实解析器的关键一致点是：认不了的开头会让整段解析结果退化成字面文本。
   */
  const parseStub = (source: string): JSONContent[] =>
    /^<div align="center"[^>]*>[\s\S]*<\/div>$/u.test(source)
      ? [{ type: "paragraph", attrs: { textAlign: "center" } }]
      : [{ type: "paragraph", content: [{ type: "text", text: source }] }];

  test("整段闭合后按最长的一段认领", () => {
    const claim = findClaimableHtmlBlock(
      ['<div align="center">', "dadong", "</div>"],
      parseStub,
    );
    assert.ok(claim);
    assert.equal(claim.start, 0);
    assert.equal(claim.source, '<div align="center">\ndadong\n</div>');
  });

  test("还在标签里面（没写完）时一律不认领", () => {
    assert.equal(
      findClaimableHtmlBlock(['<div align="center">', "dadong"], parseStub),
      null,
    );
  });

  test("起点在未闭合标签内部时不认领内层那段", () => {
    /*
     * 真实场景：徽章块里的 `<img …>` 自带闭合，但外面还套着没写完的 `<div>`、`<a>`。
     * 只看它自己会误判成「写完了」，因此必须连带前缀一起判平衡。
     */
    assert.equal(
      findClaimableHtmlBlock(
        [
          '<div align="center" style="line-height: 1;">',
          '<a href="https://example.com" target="_blank" style="margin: 2px;">',
          '<img alt="Homepage" src="https://example.com/badge.svg">',
        ],
        parseStub,
      ),
      null,
    );
  });

  test("前面有认不了的块时，后面的新块照样能被认领", () => {
    const claim = findClaimableHtmlBlock(
      ['<div>dadong</div>', '<div align="center">', "新的", "</div>"],
      parseStub,
    );
    assert.ok(claim);
    assert.equal(claim.start, 1);
    assert.equal(claim.source, '<div align="center">\n新的\n</div>');
  });
});

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

/** 逐字键入；`\n` 表示按回车（拆出新段落）。 */
const typeText = (editor: Editor, text: string): void => {
  for (const character of text) {
    if (character === "\n") {
      editor.commands.splitBlock();
      continue;
    }
    const { from, to } = editor.view.state.selection;
    editor.view.dispatch(editor.view.state.tr.insertText(character, from, to));
  }
};

/**
 * 模拟 ProseMirror 的纯文本粘贴：每一行落成一个段落，一次性插入。
 * （prosemirror-view 的 asText 分支就是按 `split(/(?:\r\n?|\n)+/)` 逐行建段落的；
 * 光标由事务自身的选区映射决定，与真实粘贴一致。）
 */
const pasteLines = (editor: Editor, lines: readonly string[]): void => {
  const { schema } = editor.state;
  const paragraphs: ProseMirrorNode[] = lines.map((line) =>
    schema.nodes.paragraph.create(null, line === "" ? [] : schema.text(line)),
  );
  const transaction = editor.state.tr.replaceSelection(
    new Slice(Fragment.fromArray(paragraphs), 0, 0),
  );
  transaction.setMeta("paste", true);
  editor.view.dispatch(transaction);
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

const BADGES = [
  '<div align="center" style="line-height: 1;">',
  '  <a href="https://huggingface.co/deepseek-ai" target="_blank" style="margin: 2px;">',
  '    <img alt="Hugging Face" src="https://img.shields.io/badge/Hugging%20Face-DeepSeek%20AI-ffc107?color=ffc107&amp;logoColor=white" style="display: inline-block; vertical-align: middle;"/>',
  "  </a>",
  "</div>",
];

/** 用户实际粘贴过的那段 License 徽章。 */
const LICENSE_BADGE = [
  '<div align="center" style="line-height: 1;">',
  '<img src="https://img.shields.io/badge/License-MIT-f5de53?&color=f5de53" alt="License" style="display: inline-block; vertical-align: middle;">',
  "</div>",
];

describe("手写 HTML 的认领", () => {
  test("逐行敲完多行 HTML：中途不认领，收尾标签敲完当场渲染", async () => {
    const editor = await createEditor("");
    try {
      // 敲到倒数第二行为止，都还只是字面文本（外层 div 没闭合）。
      typeText(editor, BADGES.slice(0, -1).join("\n"));
      assert.deepEqual(topLevelTypes(editor), ["paragraph", "paragraph", "paragraph", "paragraph"]);

      typeText(editor, `\n${BADGES[BADGES.length - 1]}`);
      // 整段被认领成「居中段落」：块内是链接起来的徽章图片。
      assert.deepEqual(topLevelTypes(editor), ["paragraph"]);
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");
      const images: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image") images.push(String(node.attrs.src));
        return true;
      });
      assert.equal(images.length, 1);
      assert.match(images[0], /^https:\/\/img\.shields\.io\/badge\//u);
    } finally {
      editor.destroy();
    }
  });

  test("整段粘贴多行 HTML：粘进来就渲染", async () => {
    const editor = await createEditor("");
    try {
      pasteLines(editor, BADGES);
      assert.deepEqual(topLevelTypes(editor), ["paragraph"]);
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");
    } finally {
      editor.destroy();
    }
  });

  /*
   * 回归：把块粘贴进居中 HTML 容器里，而容器中本来就有一个空段落（用户之前在这里按过
   * 回车，空段落继承了容器的 textAlign 与 HTML 源码标记）。认领之后光标会落在块后面的
   * 这个空段落上，如果不把它恢复成普通段落，按回车就会一路居中、一路留在那段 HTML 里 ——
   * 用户看到的现象是「回车后光标跑到中间」。
   */
  test("粘贴在居中 HTML 块内部：光标落在块后面的普通段落里", async () => {
    const editor = await createEditor('<div align="center">\n联系邮箱\n</div>\n');
    try {
      const paragraph = editor.state.doc.child(0);
      assert.equal(paragraph.attrs.textAlign, "center");
      // 光标移到居中段落末尾按回车：容器里因此留下一个继承同样属性的空段落。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1 + paragraph.content.size),
        ),
      );
      editor.commands.splitBlock();
      const blank = editor.state.doc.child(1);
      assert.equal(blank.content.size, 0);
      assert.equal(blank.attrs.textAlign, "center");
      assert.notEqual(blank.attrs.xmdHtmlBlockOpen, null);

      // 光标移回居中文字段落末尾，在「文字段」与「空段落」之间粘贴新块。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1 + paragraph.content.size),
        ),
      );
      pasteLines(editor, LICENSE_BADGE);

      // 粘贴进来的块被认领成居中段落，原来的居中容器保持原样。
      const claimed = editor.state.doc.child(1);
      assert.equal(claimed.attrs.textAlign, "center");
      assert.notEqual(claimed.attrs.xmdHtmlChunk, null);

      // 光标落在块后面那个空段落上，并且它已经恢复成普通段落。
      const { $from } = editor.state.selection;
      assert.equal($from.parent.content.size, 0, "光标应停在空段落里");
      assert.equal($from.parent.attrs.textAlign, null, "空段落不该继续居中");
      assert.equal($from.parent.attrs.xmdHtmlBlockOpen, null, "空段落不该带着 HTML 源码标记");

      // 回车产生的新段落同样是普通段落。
      editor.commands.splitBlock();
      assert.equal(editor.state.selection.$from.parent.attrs.textAlign, null);
    } finally {
      editor.destroy();
    }
  });

  test("单行写 hr 与 img 也当场认领", async () => {
    const editor = await createEditor("");
    try {
      typeText(editor, "<hr>");
      assert.deepEqual(topLevelTypes(editor), ["horizontalRule"]);

      typeText(editor, "\n<img src=\"https://example.com/a.png\" width=\"60%\">");
      // 回车会在分隔线后留下一个空段落，这里只确认真正的两类内容都在。
      assert.ok(
        topLevelTypes(editor).includes("horizontalRule"),
        "分隔线应保留",
      );
      const images: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image") images.push(String(node.attrs.width));
        return true;
      });
      assert.deepEqual(images, ["60%"]);
    } finally {
      editor.destroy();
    }
  });

  test("认不了的保持字面文本：注释、认不出的容器", async () => {
    const cases = [
      "<!-- markdownlint-disable html -->",
      "<div>dadong</div>",
    ];
    for (const source of cases) {
      const editor = await createEditor("");
      try {
        typeText(editor, source);
        assert.deepEqual(topLevelTypes(editor), ["paragraph"], `应保持字面文本：${source}`);
        assert.equal(editor.state.doc.textContent, source);
      } finally {
        editor.destroy();
      }
    }
  });

  test("未闭合的 div 不会提前认领里面的 img 行", async () => {
    const editor = await createEditor("");
    try {
      typeText(editor, '<div align="center">\n<img src="https://example.com/a.png">');
      assert.deepEqual(topLevelTypes(editor), ["paragraph", "paragraph"]);
      assert.equal(editor.state.doc.child(0).textContent, '<div align="center">');
      assert.equal(
        editor.state.doc.child(1).textContent,
        '<img src="https://example.com/a.png">',
      );
    } finally {
      editor.destroy();
    }
  });

  test("认领后接着输入不会写进刚渲染的内容里", async () => {
    const editor = await createEditor("");
    try {
      typeText(editor, '<div align="center">旧的</div>');
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");

      typeText(editor, "新");
      assert.equal(editor.state.doc.child(0).textContent, "旧的");
      // 新文字落在渲染结果之后的段落里，而不是被写进居中段落。
      const texts: string[] = [];
      editor.state.doc.forEach((node) => texts.push(node.textContent));
      assert.deepEqual(texts.filter((text) => text !== ""), ["旧的", "新"]);
    } finally {
      editor.destroy();
    }
  });

  /*
   * 认领事务是附加在输入事务上的（appendTransaction），历史记录因此把它和输入合成
   * 同一个事件：按一次撤销应当直接退回「还没写这段 HTML」的状态，而不是留下一段
   * 撤不掉的渲染结果。
   */
  test("一次撤销同时退掉输入与渲染", async () => {
    const editor = await createEditor("");
    try {
      typeText(editor, BADGES.join("\n"));
      assert.deepEqual(topLevelTypes(editor), ["paragraph"]);
      assert.equal(editor.state.doc.child(0).attrs.textAlign, "center");

      editor.commands.undo();
      assert.equal(editor.state.doc.textContent, "");
    } finally {
      editor.destroy();
    }
  });
});
