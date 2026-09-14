import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { codeBlockLanguages } from "./codeBlockLanguages";
import { editorLowlight, highlightCode, isLanguageHighlightable } from "./codeBlockHighlight";

// 语言选择器与高亮注册表是两份独立的清单，历史上就出现过漂移：
// 选择器里有 go/wasm 等语言，但注册表没有对应语法包，用户选了却没有高亮。
// 这组测试把「两份清单必须一致」固定下来，避免以后再漂移。
describe("代码块语言清单与高亮注册表一致性", () => {
  test("选择器里的每种语言都能在编辑器侧找到语法", () => {
    for (const language of codeBlockLanguages) {
      assert.equal(
        editorLowlight.registered(language.value),
        true,
        `选择器提供 ${language.value}（${language.label}），但 lowlight 未注册该语法`,
      );
    }
  });

  test("选择器里的每种语言都能在 AI 对话侧找到语法", () => {
    for (const language of codeBlockLanguages) {
      assert.equal(
        isLanguageHighlightable(language.value),
        true,
        `选择器提供 ${language.value}（${language.label}），但 highlight.js 未注册该语法`,
      );
    }
  });

  test("shell 别名在编辑器侧与 AI 对话侧都指向 bash", () => {
    assert.equal(editorLowlight.registered("shell"), true);
    assert.equal(isLanguageHighlightable("shell"), true);
    // 走一遍真实高亮路径，确认不会降级成纯文本转义。
    const highlighted = highlightCode("shell", "echo hi");
    assert.match(highlighted, /hljs-/u);
  });

  test("未知语言降级为纯文本转义，不抛错", () => {
    assert.equal(isLanguageHighlightable("not-a-real-language"), false);
    assert.equal(highlightCode("not-a-real-language", "<b>"), "&lt;b&gt;");
  });
});
