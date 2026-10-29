import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/*
 * 独立图片的尺寸规则（GitHub 语义）：
 * - 没有 width 声明的独立图片按原始尺寸显示，超出列宽才等比缩；
 * - 百分比宽度继续按声明铺满。
 *
 * 样式写在 SFC 的 <style> 里，单元测试环境不做 Tailwind 编译，
 * 因此这里只对关键声明做静态断言，视觉结果另外用界面冒烟核对。
 */

const sfc = readFileSync(new URL("../components/MarkdownEditor.vue", import.meta.url), "utf8");

/** 截取两个标记之间的样式片段；找不到起始标记视为测试写错了。 */
const blockBetween = (startMarker: string, endMarker: string): string => {
  const start = sfc.indexOf(startMarker);
  assert.ok(start >= 0, `找不到样式区块：${startMarker}`);
  const end = sfc.indexOf(endMarker, start);
  return sfc.slice(start, end < 0 ? undefined : end);
};

describe("独立图片尺寸规则", () => {
  test("无宽度的独立图片按原始尺寸显示，不放大到列宽", () => {
    const rule = blockBetween("独占一段的图片", "原生文字选区无法覆盖图片");

    assert.match(rule, /inline-flex/u, "包裹层应为 inline-flex，按图片宽度收缩");
    assert.match(rule, /max-w-full|max-width:\s*100%/u, "包裹层必须有列宽上限");
    assert.match(rule, /width:\s*auto/u, "图片按原始宽度显示");
    assert.doesNotMatch(rule, /^\s*width:\s*100%/mu, "独立图片不应再被拉伸到 100% 宽度");
  });

  test("百分比图片仍按声明宽度铺满", () => {
    const rule = blockBetween("[data-xmd-image-percent] img", ".tiptap p:not(");

    assert.match(rule, /w-full/u);
  });
});
