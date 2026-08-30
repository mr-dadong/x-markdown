import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clampPanelLeft, scrollOffsetToMakeRoomBelow } from "./panelPosition";

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

describe("scrollOffsetToMakeRoomBelow", () => {
  // 面板高度 180、光标与面板间距 8、底缘留白 12，即光标下方需要 200px。
  const room = {
    panelGap: 8,
    edgeGap: 12,
  };

  test("下方空间充足时不滚动", () => {
    // 光标底 100 + 200 = 300，编辑区底 400，空间足够。
    assert.equal(
      scrollOffsetToMakeRoomBelow(100, 180, {
        shellBottom: 400,
        maxScrollDelta: 500,
        ...room,
      }),
      0,
    );
  });

  test("恰好放下面板的临界值不滚动", () => {
    // 100 + 8 + 180 + 12 = 300，正好等于编辑区底，不需要滚动。
    assert.equal(
      scrollOffsetToMakeRoomBelow(100, 180, {
        shellBottom: 300,
        maxScrollDelta: 500,
        ...room,
      }),
      0,
    );
  });

  test("下方空间不足时按差额滚动", () => {
    // 需要 300，编辑区底只有 250，应滚动 50。
    assert.equal(
      scrollOffsetToMakeRoomBelow(100, 180, {
        shellBottom: 250,
        maxScrollDelta: 500,
        ...room,
      }),
      50,
    );
  });

  test("文档见底时按可滚动最大距离截断", () => {
    // 需要滚动 50，但文档只剩 20 可滚，只滚 20。
    assert.equal(
      scrollOffsetToMakeRoomBelow(100, 180, {
        shellBottom: 250,
        maxScrollDelta: 20,
        ...room,
      }),
      20,
    );
  });

  test("已滚到文档末尾时不滚动", () => {
    assert.equal(
      scrollOffsetToMakeRoomBelow(100, 180, {
        shellBottom: 250,
        maxScrollDelta: 0,
        ...room,
      }),
      0,
    );
  });
});
