// 浮层按光标位置出现时钳制左边界：
// 既不能贴出屏幕左缘，也不能因面板宽度被推出右缘。
// 12px 与斜杠面板的边缘留白保持一致。
export const clampPanelLeft = (
  desiredLeft: number,
  panelWidth: number,
  viewportWidth: number,
): number => Math.max(12, Math.min(desiredLeft, viewportWidth - panelWidth - 12));
