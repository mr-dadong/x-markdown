import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { blockMarqueeKey, copyBlocks, selectableBlocks } from "../extensions/BlockMarquee";
import { blockPlainText, clipboardTextSerializer, rangePlainText } from "./clipboardText";

/*
 * 复制到剪贴板的纯文本回归测试。
 *
 * 真实接线位置：useEditor.ts 的 editorProps.clipboardTextSerializer 与
 * 块菜单复制/块拖拽/局部选区复制。三条路径都属于「把节点转成纯文本」，
 * 历史上出过两类相反的缺陷：
 *   1. 分隔符过多：Tiptap 默认对每个块级节点都拼 "\n\n"，列表复制出一片空行；
 *   2. 分隔符缺失：用 node.textContent 或 textBetween 不传 leafText，
 *      列表粘成一行、段内硬换行被吞掉。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("./editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

/** 按 useEditor.ts 的接线方式创建编辑器：覆盖纯文本剪贴板序列化。 */
const createEditor = (markdown: string): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
    editorProps: { clipboardTextSerializer },
  });

/** 读取编辑器当前生效的纯文本剪贴板序列化结果（即 Ctrl+C 写入的 text/plain）。 */
const copiedPlainText = (editor: Editor): string => {
  const slice = editor.state.selection.content();
  // someProp 的回调入参由 prosemirror-view 的类型决定，这里让 TS 自行推导。
  const value = editor.view.someProp("clipboardTextSerializer", (f) => f(slice, editor.view));
  return String(value ?? "");
};

/** 全选后读取复制出的纯文本。 */
const selectAllPlainText = (markdown: string): string => {
  const editor = createEditor(markdown);
  try {
    editor.commands.selectAll();
    return copiedPlainText(editor);
  } finally {
    editor.destroy();
  }
};

describe("复制列表不产生多余空行", () => {
  test("三个有序列表项全选复制后每项一行", () => {
    // 回归用例：修复前输出为 "\n\n\n\n222222\n\n\n\n222222\n\n\n\n333333"。
    assert.equal(selectAllPlainText("1. 222222\n2. 222222\n3. 333333"), "222222\n222222\n333333");
  });

  test("无序列表与任务列表同样每项一行", () => {
    assert.equal(selectAllPlainText("- 甲\n- 乙\n- 丙"), "甲\n乙\n丙");
  });

  test("多个段落之间只保留一个换行", () => {
    assert.equal(selectAllPlainText("第一段\n\n第二段\n\n第三段"), "第一段\n第二段\n第三段");
  });

  test("列表项内的硬换行不会被粘成一行", () => {
    // hardBreak 是叶子节点，不显式还原 leafText 会被跳过导致两行粘连。
    assert.equal(selectAllPlainText("第一行  \n第二行"), "第一行\n第二行");
  });

  test("代码块内容按原样保留自身的换行", () => {
    assert.equal(selectAllPlainText("```ts\nconst a = 1;\n```"), "const a = 1;");
  });

  test("表格复制为逐格一行的纯文本", () => {
    assert.equal(selectAllPlainText("| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 1 |"), "名称\n数量\n苹果\n1");
  });

  test("块框选复制（左侧拖拽）同样不带多余空行", () => {
    // copyBlocks 也走同一个剪贴板序列化，避免只修好普通选择而漏掉框选复制。
    const editor = createEditor("1. 222222\n2. 222222\n3. 333333");
    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(blockMarqueeKey, selectableBlocks(editor.state.doc)),
      );
      const data = new Map<string, string>();
      const event = {
        clipboardData: { setData: (type: string, value: string) => data.set(type, value) },
        preventDefault() { /* 仅记录剪贴板内容，无需真实阻止默认行为 */ },
      } as unknown as ClipboardEvent;
      assert.equal(copyBlocks(editor.view, event, false), true);
      assert.equal(data.get("text/plain"), "222222\n222222\n333333");
      // 富文本仍然保留列表结构，不受纯文本修复影响。
      assert.match(data.get("text/html") ?? "", /<ol[\s>]/u);
    } finally {
      editor.destroy();
    }
  });
});

describe("整块取文本保留块边界（块菜单复制 / 块拖拽）", () => {
  /** 取文档第 index 个顶层块的纯文本。 */
  const topLevelText = (markdown: string, index = 0): string => {
    const editor = createEditor(markdown);
    try {
      return blockPlainText(editor.state.doc.child(index));
    } finally {
      editor.destroy();
    }
  };

  test("列表每个条目一行，不再粘成一条", () => {
    // 回归用例：改用 blockPlainText 之前是 node.textContent，输出为 "甲乙丙"。
    assert.equal(topLevelText("1. 甲\n2. 乙\n3. 丙"), "甲\n乙\n丙");
    assert.equal(topLevelText("- 甲\n- 乙\n- 丙"), "甲\n乙\n丙");
    assert.equal(topLevelText("- [ ] 甲\n- [x] 乙"), "甲\n乙");
  });

  test("表格逐格一行，不再粘成 AB12", () => {
    assert.equal(topLevelText("| A | B |\n| --- | --- |\n| 1 | 2 |"), "A\nB\n1\n2");
  });

  test("嵌套列表的每一层都各占一行", () => {
    assert.equal(topLevelText("- 甲\n  - 甲一\n  - 甲二\n- 乙"), "甲\n甲一\n甲二\n乙");
  });

  test("块内硬换行不会被吞掉", () => {
    // 引用块里的换行写成两空格硬换行：单个换行现在是软换行，会合并成空格。
    assert.equal(topLevelText("> 第一行  \n> 第二行"), "第一行\n第二行");
    assert.equal(topLevelText("第一行  \n第二行"), "第一行\n第二行");
  });

  test("普通单行段落不受影响", () => {
    assert.equal(topLevelText("就是一段话。"), "就是一段话。");
  });
});

describe("按选区取文本还原硬换行（局部复制 / 剪切）", () => {
  /** 选中第 0 个顶层块内的全部文字，返回 rangePlainText 的结果。 */
  const selectBlockText = (markdown: string): string => {
    const editor = createEditor(markdown);
    try {
      const range = { from: 2, to: editor.state.doc.content.size - 1 };
      editor.commands.setTextSelection(range);
      const { from, to } = editor.state.selection;
      return rangePlainText(editor.state.doc, from, to);
    } finally {
      editor.destroy();
    }
  };

  test("段内两空格硬换行复制后仍是两行", () => {
    // 回归用例：只传块分隔符时 hardBreak 被整块跳过，输出为 "一行第二行"。
    assert.equal(selectBlockText("第一行  \n第二行"), "一行\n第二行");
  });

  test("段内反斜杠硬换行复制后仍是两行", () => {
    assert.equal(selectBlockText("第一行\\\n第二行"), "一行\n第二行");
  });

  test("引用块内的硬换行不粘连", () => {
    assert.equal(selectBlockText("> 第一行  \n> 第二行"), "第一行\n第二行");
  });
});
