import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import { normalizeAiMarkdown } from "../utils/aiMarkdown";
import { hasMarkdownSyntax } from "../utils/markdownDetector";

// 所见即所得模式下“纯文本粘贴按 Markdown 渲染”的回归测试。
// 真实实现位于 useEditor.ts 的 editorProps.clipboardTextParser，
// 这里用与它一致的解析策略复现核心逻辑，保证 `# 标题`、`- 列表`、
// `**加粗**` 等源码粘贴后能正确落到对应节点，且不会破坏
// Shift 强制纯文本、标题/单元格等既有保护路径。

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

/**
 * 复刻 useEditor.ts clipboardTextParser 的核心逻辑：
 * 先把文本归一化，再用与文档同源的 Markdown 解析器解析成 Tiptap JSON，
 * 最后按 schema 还原成两端开放的 ProseMirror 切片。
 */
const parsePastedMarkdown = (
  editor: Editor,
  text: string,
  context: import("@tiptap/pm/model").ResolvedPos,
  plainText: boolean,
  view: import("@tiptap/pm/view").EditorView,
): Slice => {
  if (plainText || text.length === 0) return null as unknown as Slice;
  const parentName = context.parent?.type?.name;
  if (
    parentName === "heading"
    || parentName === "tableCell"
    || parentName === "tableHeader"
    || parentName === "codeBlock"
  ) return null as unknown as Slice;
  // 与 useEditor.ts 保持一致：先归一化过度转义，再判断是否含 Markdown 语法。
  const normalized = normalizeAiMarkdown(text);
  if (normalized.length === 0) return null as unknown as Slice;
  if (!hasMarkdownSyntax(normalized)) return null as unknown as Slice;
  const parsed = editor.markdown?.parse(normalized);
  if (!parsed) return null as unknown as Slice;
  return Slice.maxOpen(view.state.schema.nodeFromJSON(parsed).content);
};

const createEditor = (): Editor =>
  new EditorConstructor({ extensions: createEditorExtensions(), content: "", contentType: "markdown" });

const sliceJson = (slice: Slice): string => JSON.stringify(slice.content.toJSON());

test("普通正文粘贴 # 标题 应渲染为 heading 节点", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "# 一级标题", view.state.selection.$from, false, view);
    assert.ok(slice, "普通文本粘贴不应返回空");
    assert.ok(sliceJson(slice).includes("heading"), "应渲染成 heading");
    assert.ok(sliceJson(slice).includes("level"), "heading 应带 level");
  } finally {
    editor.destroy();
  }
});

test("普通正文粘贴 - 列表 应渲染为 bulletList", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "- 项目一\n- 项目二", view.state.selection.$from, false, view);
    assert.ok(slice);
    assert.ok(sliceJson(slice).includes("bulletList"), "应渲染成 bulletList");
  } finally {
    editor.destroy();
  }
});

test("普通正文粘贴 **加粗** 与 *斜体* 应渲染为对应行内标记", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "**加粗** 且 *斜体*", view.state.selection.$from, false, view);
    assert.ok(slice);
    const json = sliceJson(slice);
    assert.ok(json.includes("bold"), "应包含加粗标记");
    assert.ok(json.includes("italic"), "应包含斜体标记");
  } finally {
    editor.destroy();
  }
});

test("过度转义 \\# 标题 经归一化后仍渲染为 heading", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "\\# 转义的标题", view.state.selection.$from, false, view);
    assert.ok(slice);
    assert.ok(sliceJson(slice).includes("heading"), "归一化后应渲染为 heading");
  } finally {
    editor.destroy();
  }
});

test("plainText=true（Shift/强制纯文本）时交还默认纯文本插入", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "**不加粗**", view.state.selection.$from, true, view);
    assert.equal(slice, null, "强制纯文本时应返回 null 走默认");
  } finally {
    editor.destroy();
  }
});

test("光标在标题内时不接管，交还标题保护逻辑", () => {
  const editor = createEditor();
  try {
    editor.commands.setContent("# 已有标题", { contentType: "markdown" });
    const view = editor.view;
    const resolved = view.state.doc.resolve(1);
    const slice = parsePastedMarkdown(editor, "- 新列表", resolved, false, view);
    assert.equal(slice, null, "标题内粘贴应保持原保护行为");
  } finally {
    editor.destroy();
  }
});

test("不含 Markdown 语法的纯文本交还默认插入（不误渲染）", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    // systemd 单元配置片段，含 [Unit] 方括号，不应被当成 md 渲染。
    const slice = parsePastedMarkdown(
      editor,
      "[Unit]\nDescription=小 demo",
      view.state.selection.$from,
      false,
      view,
    );
    assert.equal(slice, null, "配置库文本不应渲染");
  } finally {
    editor.destroy();
  }
});

test("含 md 语法（标题/列表）仍正常渲染", () => {
  const editor = createEditor();
  try {
    const view = editor.view;
    const slice = parsePastedMarkdown(editor, "## 小节\n- 甲\n- 乙", view.state.selection.$from, false, view);
    assert.ok(slice);
    const json = sliceJson(slice);
    assert.ok(json.includes("heading"), "应渲染为 heading");
    assert.ok(json.includes("bulletList"), "应渲染为 bulletList");
  } finally {
    editor.destroy();
  }
});