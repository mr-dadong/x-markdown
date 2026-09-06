import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import {
  handleHeadingBackspace,
  handleHeadingPromote,
} from "./headingKeyboard";

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

const createEditor = (content: string): Editor =>
  new EditorConstructor({
    extensions: createEditorExtensions(),
    content,
  });

// 构造最小可用的按键事件对象，只保留处理器关心的字段。
const keyEvent = (key: string): KeyboardEvent =>
  ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: () => {},
  }) as unknown as KeyboardEvent;

// 汇总各顶层块的类型、级别与文本，便于断言文档结构变化。
const blockSummaries = (
  editor: Editor,
): Array<{ type: string; level: number | null; text: string }> => {
  const summaries: Array<{ type: string; level: number | null; text: string }> = [];
  editor.state.doc.forEach((node) => {
    summaries.push({
      type: node.type.name,
      level: node.type.name === "heading" ? Number(node.attrs.level) : null,
      text: node.textContent,
    });
  });
  return summaries;
};

// 找到第一个指定级别标题的内容起点（节点位置 + 1），找不到返回 null。
const findHeadingContentStart = (editor: Editor, level: number): number | null => {
  let position = 0;
  let found: number | null = null;
  editor.state.doc.forEach((child) => {
    if (found !== null) return;
    if (child.type.name === "heading" && Number(child.attrs.level) === level) {
      found = position + 1;
      return;
    }
    position += child.nodeSize;
  });
  return found;
};

// 计算第 blockIndex 个顶层块的内容起点。
const blockContentStart = (editor: Editor, blockIndex: number): number => {
  let position = 0;
  let index = 0;
  editor.state.doc.forEach((node) => {
    if (index < blockIndex) {
      position += node.nodeSize;
      index += 1;
    }
  });
  return position + 1;
};

const placeCursor = (editor: Editor, from: number): void => {
  editor.commands.setTextSelection(from);
};

test("Backspace：光标在二级标题开头时降为一级，而不是并入上一行", () => {
  const editor = createEditor("# 一级标题\n\n## 二级标题");
  try {
    const h2Start = findHeadingContentStart(editor, 2);
    assert.notEqual(h2Start, null, "应能找到二级标题");
    placeCursor(editor, h2Start as number);

    const handled = handleHeadingBackspace(editor.view, keyEvent("Backspace"));
    assert.equal(handled, true, "标题开头的 Backspace 应由标题处理器接管");
    // 只断言前两个块：文档以标题结尾时，编辑器自带的 TrailingParagraph
    // 会在末尾补一个空段落，与本次改动无关。
    assert.deepEqual(blockSummaries(editor).slice(0, 2), [
      { type: "heading", level: 1, text: "一级标题" },
      { type: "heading", level: 1, text: "二级标题" },
    ]);
    // 光标仍停在第二个标题的开头，正文没有被删除。
    assert.equal(editor.state.selection.from, blockContentStart(editor, 1));
    // 序列化结果应输出一级标题，证明标题级别变化可正常落盘。
    const markdown = editor.storage.markdown.getMarkdown();
    assert.match(markdown, /^# 一级标题/);
    assert.match(markdown, /# 二级标题/);
  } finally {
    editor.destroy();
  }
});

test("Backspace：光标在一级标题开头时降为普通段落", () => {
  const editor = createEditor("# 一级标题");
  try {
    const h1Start = findHeadingContentStart(editor, 1);
    assert.notEqual(h1Start, null);
    placeCursor(editor, h1Start as number);

    const handled = handleHeadingBackspace(editor.view, keyEvent("Backspace"));
    assert.equal(handled, true);
    assert.deepEqual(blockSummaries(editor), [
      { type: "paragraph", level: null, text: "一级标题" },
    ]);
    assert.equal(editor.state.selection.from, 1, "光标应停在段落开头");
  } finally {
    editor.destroy();
  }
});

test("Backspace：光标在标题正文中间时保持默认删除行为", () => {
  const editor = createEditor("# 一级标题");
  try {
    // 光标放在“一级”之后、正文中间。
    placeCursor(editor, 3);
    const handled = handleHeadingBackspace(editor.view, keyEvent("Backspace"));
    assert.equal(handled, false, "正文中间的 Backspace 不应被接管");
    assert.deepEqual(blockSummaries(editor), [
      { type: "heading", level: 1, text: "一级标题" },
    ]);
  } finally {
    editor.destroy();
  }
});

test("Backspace：光标在普通段落开头时保持默认行为", () => {
  const editor = createEditor("普通段落");
  try {
    placeCursor(editor, 1);
    const handled = handleHeadingBackspace(editor.view, keyEvent("Backspace"));
    assert.equal(handled, false);
  } finally {
    editor.destroy();
  }
});

test("输入 #：光标在一级标题开头时升为二级标题", () => {
  const editor = createEditor("# 一级标题");
  try {
    const h1Start = findHeadingContentStart(editor, 1);
    assert.notEqual(h1Start, null);
    placeCursor(editor, h1Start as number);

    const handled = handleHeadingPromote(editor.view, keyEvent("#"));
    assert.equal(handled, true);
    // 文档只有一个标题时，编辑器自带的 TrailingParagraph 会在末尾补空段落，
    // 这里只断言第一个块，聚焦本次改动本身。
    assert.deepEqual(blockSummaries(editor).slice(0, 1), [
      { type: "heading", level: 2, text: "一级标题" },
    ]);
    assert.equal(editor.state.selection.from, 1, "光标应停在标题开头");
  } finally {
    editor.destroy();
  }
});

test("输入 #：六级标题已是最高级别，按键被吞掉且不产生多余字符", () => {
  const editor = createEditor("###### 六级标题");
  try {
    const h6Start = findHeadingContentStart(editor, 6);
    assert.notEqual(h6Start, null);
    placeCursor(editor, h6Start as number);

    const handled = handleHeadingPromote(editor.view, keyEvent("#"));
    assert.equal(handled, true, "最高级别的 # 应被吞掉");
    assert.deepEqual(blockSummaries(editor), [
      { type: "heading", level: 6, text: "六级标题" },
    ]);
  } finally {
    editor.destroy();
  }
});

test("输入 #：光标不在标题开头时保持默认输入", () => {
  const editor = createEditor("# 一级标题");
  try {
    placeCursor(editor, 3);
    const handled = handleHeadingPromote(editor.view, keyEvent("#"));
    assert.equal(handled, false);
    assert.deepEqual(blockSummaries(editor), [
      { type: "heading", level: 1, text: "一级标题" },
    ]);
  } finally {
    editor.destroy();
  }
});
