import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Window } from "happy-dom";
import { installDomEnvironment, registeredHighlights } from "../test/domEnvironment";

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

// 必须与 CodeOccurrenceHighlight.ts 的 HIGHLIGHT_NAME、MarkdownEditor.vue 的
// ::highlight(...) 名字一致，三处共同构成这段高亮的注册名。
const HIGHLIGHT_NAME = "xmd-occurrence-match";

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

// 代码正文是 "aa bb aa"：同一个词出现两次，正好用来观察匹配高亮的增减。
const CODE_BLOCK_CONTENT = "```js\naa bb aa\n```";

// 带语言且含关键字，用来覆盖"匹配文本跨低亮 span 边界"的情形。
const CROSS_SPAN_CONTENT = "```js\nlet a = 1;\nlet a = 2;\n```";

const createEditor = (content: string = CODE_BLOCK_CONTENT): Editor => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new EditorConstructor({
    element,
    extensions: createEditorExtensions(),
    content,
    contentType: "markdown",
  });
};

const selectRange = (editor: Editor, from: number, to: number): void => {
  const { state } = editor.view;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, from, to)),
  );
};

// Range.toString() 直接给出这段 Range 覆盖的文字。
// 没有登记时（例如选区折叠、或选区不在代码块内）返回空数组。
const highlightedRanges = (): Range[] => registeredHighlights.get(HIGHLIGHT_NAME) ?? [];

const highlightedTexts = (): string[] =>
  highlightedRanges().map((range) => range.toString());

// 每个用例开始前清掉上一个用例留下的登记，断言才只反映本次操作。
const resetHighlights = (): void => {
  registeredHighlights.clear();
};

test("选中代码块内的词时，其余相同文本被登记为高亮", () => {
  const editor = createEditor();
  try {
    resetHighlights();
    // "aa" 在代码块里出现两次，选中第一处后应只高亮第二处。
    selectRange(editor, 1, 3);
    assert.deepEqual(highlightedTexts(), ["aa"]);

    // 反过来选中第二处：此时要命中位于代码块最开头的那一处，覆盖起始边界。
    selectRange(editor, 7, 9);
    assert.deepEqual(highlightedTexts(), ["aa"]);
  } finally {
    editor.destroy();
  }
});

test("匹配文本只出现一次（就是选区本身）时不登记高亮", () => {
  const editor = createEditor();
  try {
    selectRange(editor, 1, 3);
    assert.deepEqual(highlightedTexts(), ["aa"], "先确认能高亮另一处");

    // 把选区拉长成 "aa bb"：它在代码块内只出现一次且正是选区自己，不该有额外高亮。
    selectRange(editor, 1, 6);
    assert.deepEqual(highlightedTexts(), []);
  } finally {
    editor.destroy();
  }
});

test("选区折叠后清空高亮登记", () => {
  const editor = createEditor();
  try {
    selectRange(editor, 1, 3);
    assert.deepEqual(highlightedTexts(), ["aa"]);

    selectRange(editor, 5, 5);
    assert.deepEqual(highlightedTexts(), [], "折叠选区应清掉旧高亮");
  } finally {
    editor.destroy();
  }
});

test("匹配文本跨低亮 span 边界时仍是一整段高亮", () => {
  const editor = createEditor(CROSS_SPAN_CONTENT);
  try {
    resetHighlights();
    // 正文是 "let a = 1;\nlet a = 2;"，选中第一处 "let a"，另一处在 12..17。
    selectRange(editor, 1, 6);
    assert.deepEqual(highlightedTexts(), ["let a"]);

    // 低亮把 "let" 切成了独立的 span，所以这处匹配横跨两个节点。
    // 这条断言是为了钉住"跨节点也被覆盖"这件事：一旦语法高亮的切分方式变了、
    // 这里不再跨节点，就该有人重新评估这条用例还有没有意义。
    const [range] = highlightedRanges();
    assert.notEqual(
      range.startContainer,
      range.endContainer,
      "该用例应覆盖匹配横跨多个 DOM 节点的情形",
    );
  } finally {
    editor.destroy();
  }
});

test("选区不在代码块内时不登记高亮", () => {
  const editor = createEditor("普通段落文字\n\n```js\naa bb aa\n```");
  try {
    resetHighlights();
    // 选中段落开头的两个字，此时选区不在 codeBlock 内。
    selectRange(editor, 1, 3);
    assert.deepEqual(highlightedTexts(), []);
  } finally {
    editor.destroy();
  }
});

test("匹配数量很大时也不会退化成逐匹配的 DOM 查找", () => {
  // 200 个 "aa"：选中第一个后其余 199 处都要高亮。
  const editor = createEditor(`\`\`\`js\n${"aa ".repeat(200)}\n\`\`\``);
  try {
    resetHighlights();

    // 统计 domAtPos 调用次数。它的实现是线性扫描子节点的，逐匹配调用会变成
    // O(匹配数 × 子节点数)，这正是"选中时卡一下"的成因，所以这里把它钉住。
    const view = editor.view;
    const originalDomAtPos = view.domAtPos.bind(view);
    let domAtPosCalls = 0;
    view.domAtPos = (pos: number, side?: number) => {
      domAtPosCalls += 1;
      return originalDomAtPos(pos, side);
    };

    selectRange(editor, 1, 3);

    const matchCount = highlightedRanges().length;
    assert.equal(matchCount, 199, "应高亮其余 199 处相同的词");
    assert.ok(
      domAtPosCalls * 10 < matchCount,
      `DOM 查找次数必须与匹配数无关，实际调用 ${domAtPosCalls} 次 / ${matchCount} 个匹配`,
    );
    assert.deepEqual(highlightedTexts(), Array.from({ length: 199 }, () => "aa"));
  } finally {
    editor.destroy();
  }
});
