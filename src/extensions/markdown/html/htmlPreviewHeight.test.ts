import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { resolvePreviewHeight } from "./htmlPreviewHeight";

/*
 * 隔离预览高度的回归：高度必须双向跟随内容。
 * 早先的实现把 documentElement.scrollHeight 也取最大值，而它永远不小于 iframe
 * 视口高度，导致「加载时内容偏高」的情况再也缩不回去，预览下方留下大块空白。
 */

describe("隔离预览的高度", () => {
  test("高度跟随内容，内容变矮时也收缩", () => {
    assert.equal(resolvePreviewHeight(687), 687);
    assert.equal(resolvePreviewHeight(526), 526);
  });

  test("空内容保持最小高度", () => {
    assert.equal(resolvePreviewHeight(0), 32);
  });

  test("视图不再把视口高度算进测量", () => {
    const sfc = readFileSync(new URL("./HtmlBlockView.vue", import.meta.url), "utf8");
    // 注释里会解释这条规则，先去掉注释再检查真正的代码。
    const code = sfc.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/<!--[\s\S]*?-->/gu, "");

    // 观察 documentElement 的尺寸变化仍然需要，但不能读它的 scrollHeight。
    assert.doesNotMatch(code, /documentElement\??\.scrollHeight/u);
    assert.match(code, /resolvePreviewHeight/u);
  });
});