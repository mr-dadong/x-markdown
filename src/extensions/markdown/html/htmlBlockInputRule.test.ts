import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

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

const createEditor = (content: string): Editor =>
  new EditorConstructor({ extensions: createEditorExtensions(), content, contentType: "markdown" });

/** 逐字符模拟真实键入：先走 input rules，未命中再插入纯文本。 */
const typeText = (editor: Editor, text: string): void => {
  for (const character of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
};

/**
 * 顶层节点类型，忽略末尾的空段落 —— 它由 TrailingParagraph 插件维护，
 * 只用于让用户在块内容之后还能继续输入，不参与结构比较。
 */
const nodeTypes = (editor: Editor): string => {
  const content: JSONContent[] = editor.state.doc.toJSON().content ?? [];
  return content
    .filter((node, index) => !(
      index === content.length - 1 && node.type === "paragraph" && !node.content
    ))
    .map((node) => node.type)
    .join(",");
};

const typeIntoEmptyEditor = async (text: string): Promise<Editor> => {
  const editor = createEditor("");
  await waitForCreate();
  typeText(editor, text);
  return editor;
};

describe("HTML 键入即变活", () => {
  /*
   * 没有这条输入规则时，键入后文档里是字面文字，而它的序列化结果与源码逐字节相同，
   * 视图同步会判定「内容没变」跳过重新解析 —— 于是同一段内容要在切换视图若干次后
   * 才突然变成 HTML，行为依赖切换次数。这里要求敲完闭合标签当场就生效。
   */
  const blockCases: Array<[string, string, string]> = [
    ["p 标签", "<p>ddd</p>", "paragraph"],
    ["div 标签", "<div>dadong</div>", "paragraph"],
    ["table 标签", "<table><tr><td>x</td></tr></table>", "paragraph"],
  ];

  for (const [name, typed, expectedNodeType] of blockCases) {
    test(`块级 ${name}：${JSON.stringify(typed)}`, async () => {
      const editor = await typeIntoEmptyEditor(typed);
      try {
        assert.equal(nodeTypes(editor), expectedNodeType);
        assert.equal(editor.state.doc.textContent, typed);
      } finally {
        editor.destroy();
      }
    });
  }

  test("带 style 的复杂 HTML 进入隔离块", async () => {
    const typed = "<style>.x { color: red; }</style><div class=\"x\">ddd</div>";
    const editor = await typeIntoEmptyEditor(typed);
    try {
      assert.equal(nodeTypes(editor), "htmlBlock,paragraph");
      assert.equal(editor.state.doc.firstChild?.attrs.source, "<style>.x { color: red; }</style>");
      assert.equal(editor.state.doc.lastChild?.textContent, "<div class=\"x\">ddd</div>");
    } finally {
      editor.destroy();
    }
  });

  test("行内标签当场变成对应标记，而不是 HTML 块", async () => {
    const editor = await typeIntoEmptyEditor("<em>sss</em>");
    try {
      assert.equal(nodeTypes(editor), "paragraph");
      assert.equal(editor.state.doc.textContent, "sss");
      assert.ok(
        editor.state.doc.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "italic"),
        "应解析成斜体标记",
      );
    } finally {
      editor.destroy();
    }
  });

  test("schema 认不出的标签保持字面文字，不产生任何替换", async () => {
    for (const typed of ["<span>sss</span>", "<a>sss</a>"]) {
      const editor = await typeIntoEmptyEditor(typed);
      try {
        assert.equal(nodeTypes(editor), "paragraph");
        assert.equal(editor.state.doc.textContent, typed);
      } finally {
        editor.destroy();
      }
    }
  });

  test("敲出开标签时不提前处理，否则后续内容没处输入", async () => {
    for (const partial of ["<p>", "<div>abc"]) {
      const editor = await typeIntoEmptyEditor(partial);
      try {
        assert.equal(nodeTypes(editor), "paragraph");
        assert.equal(editor.state.doc.textContent, partial);
      } finally {
        editor.destroy();
      }
    }
  });

  test("转换后继续输入不会破坏可编辑正文", async () => {
    const editor = await typeIntoEmptyEditor("<p>ddd</p> 后续");
    try {
      // 普通 HTML 保持可编辑，继续输入时不会变成原子节点。
      assert.equal(nodeTypes(editor), "paragraph");
      assert.equal(editor.state.doc.textContent, "<p>ddd</p> 后续");
    } finally {
      editor.destroy();
    }
  });
});

describe("转换结果与重新解析一致", () => {
  /*
   * 这是「切换视图若干次才变」那个问题的回归测试：转换后发出的源码，
   * 重新解析必须得到同样的文档结构，否则每次视图往返都会再变一次。
   *
   * 注意行内 HTML 的源码形态会变：`<em>sss</em>` 变成斜体标记后，
   * Markdown 的规范写法是 `*sss*`（HTML 块则原样保留源码，因为节点存了原文）。
   */
  const cases: Array<[string, string, string]> = [
    ["普通 HTML 保持可编辑", "<p>ddd</p>", "<p>ddd</p>"],
    ["行内 HTML", "<em>sss</em>", "*sss*"],
    ["认不出的标签", "<span>sss</span>", "<span>sss</span>"],
  ];

  for (const [name, typed, expectedSource] of cases) {
    test(`${name}：${JSON.stringify(typed)}`, async () => {
      const { captureBaseline, serializePreservingSource } = await import(
        "../../../editor/sourcePreservingSerializer"
      );

      const editor = await typeIntoEmptyEditor(typed);
      try {
        const baseline = captureBaseline(editor, "");
        const source = serializePreservingSource(editor, baseline);
        assert.equal(source, expectedSource, "发出的源码应稳定，不带多余空行");

        const reopened = createEditor(source);
        try {
          await waitForCreate();
          assert.equal(nodeTypes(reopened), nodeTypes(editor), "重新解析的节点结构应一致");

          // 再次发出的源码不再变化：视图往返不会反复改写文档。
          const secondBaseline = captureBaseline(reopened, source);
          assert.equal(serializePreservingSource(reopened, secondBaseline), source);
        } finally {
          reopened.destroy();
        }
      } finally {
        editor.destroy();
      }
    });
  }
});