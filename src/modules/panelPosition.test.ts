import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clampPanelLeft } from "./panelPosition";

describe("clampPanelLeft", () => {
  test("宽屏下期望位置直接保留", () => {
    assert.equal(clampPanelLeft(400, 320, 1920), 400);
  });

  test("靠近右缘时按视口宽度收回面板", () => {
    // 1700 + 320 + 12 > 1920，应收回 1920 - 320 - 12 = 1588
    assert.equal(clampPanelLeft(1700, 320, 1920), 1588);
  });

  test("期望位置恰好在右边界时保持不变", () => {
    assert.equal(clampPanelLeft(1588, 320, 1920), 1588);
  });

  test("小于左边距时钳制到 12", () => {
    assert.equal(clampPanelLeft(0, 320, 1920), 12);
  });

  test("极窄视口放不下面板时优先保证左边界可见", () => {
    // 视口比面板还窄，右边界计算为负数，仍返回最小左边距 12
    assert.equal(clampPanelLeft(500, 320, 300), 12);
  });
});
