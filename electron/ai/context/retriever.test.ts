import { test } from "node:test";
import assert from "node:assert/strict";
import { retrieve } from "./retriever";
import { buildChatSystemPrompt } from "../prompts";
import type { RetrievalOptions } from "./types";

// 不需要网络请求，直接验证模型最终收到的文档上下文。
function context(documentText: string, query: string, overrides: Partial<RetrievalOptions> = {}) {
  return retrieve({ documentText, query, selection: "", cursorOffset: null,
    contextWindow: 8000, historyTokens: 0, maxOutputTokens: 2000, ...overrides });
}

test("普通问题没有正文关键词时，短文档仍完整传入模型", () => {
  const document = "# 项目计划\n\n三月完成登录模块。\n\n四月发布正式版本。";
  const result = context(document, "这是什么？");
  assert.equal(result.fullDocument, document);
  assert.ok(buildChatSystemPrompt(result).includes(document));
});

test("长文档全局提问包含标题目录和文档末尾样本", () => {
  const document = Array.from({ length: 20 }, (_, i) => `# 章节${i}\n\n${`第${i}章的工作安排。`.repeat(150)}`).join("\n\n");
  const result = context(document, "概括整篇文档");
  assert.equal(result.fullDocument, undefined);
  assert.ok(result.documentOutline?.includes("章节19"));
  assert.ok(result.chunks.some((chunk) => chunk.headingPath.some((heading) => heading.includes("章节19"))));
  assert.match(buildChatSystemPrompt(result), /不是全文/);
});

test("超预算代码块不会阻止后续较小的相关片段", () => {
  const document = `# 巨大代码\n\n\`\`\`txt\n${"target ".repeat(5000)}\n\`\`\`\n\n# 小节\n\ntarget 的简短说明。`;
  const result = context(document, "target");
  assert.ok(result.chunks.some((chunk) => chunk.text.includes("简短说明")));
});

test("历史占满预算时不会把全文塞入模型", () => {
  const result = context("正文".repeat(100), "概括", { historyTokens: 7800 });
  assert.equal(result.fullDocument, undefined);
  assert.equal(result.totalTokens, 0);
});

