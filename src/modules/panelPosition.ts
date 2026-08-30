// 浮层按光标位置出现时钳制左边界：
// 既不能贴出屏幕左缘，也不能因面板宽度被推出右缘。
// 12px 与斜杠面板的边缘留白保持一致。
export const clampPanelLeft = (
  desiredLeft: number,
  panelWidth: number,
  viewportWidth: number,
): number =>
  Math.max(12, Math.min(desiredLeft, viewportWidth - panelWidth - 12));

// 浮层出现在光标下方前，计算编辑区需要向下滚动的距离：
// 目标是让光标下方空出「面板高度 + 间距 + 边缘留白」，浮层不压住正文。
// 返回 0 表示现有空间已经足够；文档见底时按可滚动的最大距离截断，
// 不会滚动出超出文档末尾的距离。
export const scrollOffsetToMakeRoomBelow = (
  cursorBottom: number,
  panelHeight: number,
  options: {
    shellBottom: number;
    panelGap: number;
    edgeGap: number;
    maxScrollDelta: number;
  },
): number => {
  const neededTop = cursorBottom + options.panelGap;
  const requiredBottom = neededTop + panelHeight + options.edgeGap;
  // 现有空间已放得下面板，不需要滚动。
  if (requiredBottom <= options.shellBottom) return 0;
  // 需要的滚动量按文档可滚动的最大距离截断。
  return Math.min(requiredBottom - options.shellBottom, options.maxScrollDelta);
};
