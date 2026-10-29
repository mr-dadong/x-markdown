import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor, MarkdownToken } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

/*
 * 容器 token 的形态：整段容器被当成一个块级 token，内层 Markdown 预先词法化成
 * innerTokens，`raw` 覆盖从开标签行到闭标签行的全部原文 —— 这是增量保存对账的前提。
 */

let browserWindow: Window;
let createEditorExtensions: typeof import("../../../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
  browserWindow = installDomEnvironment();
  ({ Editor: EditorConstructor } = await import("@tiptap/core"));
  ({ createEditorExtensions } = await import("../../../editor/editorExtensions"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

interface ManagedMarked {
  lexer: (source: string) => MarkdownToken[];
}

const lexMarkdown = (markdown: string): MarkdownToken[] => {
  const editor: Editor = new EditorConstructor({
    extensions: createEditorExtensions(),
    content: "",
    contentType: "markdown",
  });
  try {
    const manager = editor.storage.markdown.manager as unknown as { instance: ManagedMarked };
    return manager.instance.lexer(markdown);
  } finally {
    editor.destroy();
  }
};

interface ContainerPayload {
  kind: string;
  align: string | null;
  openSource: string;
  closeSource: string;
  summarySource: string | null;
  innerTokens: MarkdownToken[];
}

describe("HtmlBlock tokenizer 的容器认领", () => {
  test("对齐容器成为一个块级 token，raw 覆盖整段原文", () => {
    const markdown = '<div align="center">\n\n# 标题\n\n正文\n\n</div>\n\n后续段落\n';
    const tokens = lexMarkdown(markdown);
    const container = tokens[0] as MarkdownToken & { htmlContainer?: ContainerPayload };

    assert.equal(tokens.length, 2);
    assert.equal(container.type, "html");
    // marked 会把紧随其后的单个换行（space token）并入前一个 token 的 raw。
    assert.equal(container.raw, '<div align="center">\n\n# 标题\n\n正文\n\n</div>\n\n');
    assert.ok(container.htmlContainer);
    assert.equal(container.htmlContainer.kind, "aligned");
    assert.equal(container.htmlContainer.align, "center");
    assert.equal(container.htmlContainer.openSource, '<div align="center">');
    assert.equal(container.htmlContainer.closeSource, "</div>");
    assert.deepEqual(
      container.htmlContainer.innerTokens.map((token) => token.type),
      ["heading", "paragraph"],
    );
  });

  test("details 容器带 summary 原文", () => {
    const markdown = "<details>\n<summary>特性</summary>\n\n- 第一条\n\n</details>\n";
    const [token] = lexMarkdown(markdown) as Array<MarkdownToken & { htmlContainer?: ContainerPayload }>;

    assert.equal(token.type, "html");
    assert.ok(token.htmlContainer);
    assert.equal(token.htmlContainer.kind, "details");
    assert.equal(token.htmlContainer.summarySource, "<summary>特性</summary>");
    assert.deepEqual(token.htmlContainer.innerTokens.map((item) => item.type), ["list"]);
  });

  test("未配平的容器不认领，token 上不带容器信息", () => {
    const tokens = lexMarkdown('<div align="center">\n\n正文\n');

    assert.ok(tokens.length > 0);
    assert.equal((tokens[0] as MarkdownToken & { htmlContainer?: unknown }).htmlContainer, undefined);
  });
});
