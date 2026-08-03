export const getNodeViewPopoverPosition = (
  anchor: HTMLElement,
  width: number,
  estimatedHeight: number,
): Record<string, string> => {
  const bounds = anchor.getBoundingClientRect();
  const viewportPadding = 12;
  // 桌面端顶部包含菜单栏与标签栏，弹层需要避开这块固定区域。
  const viewportTopPadding = 76;
  const gap = 8;
  const maximumLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
  const left = Math.max(viewportPadding, Math.min(bounds.right - width, maximumLeft));
  const hasRoomBelow = bounds.bottom + gap + estimatedHeight <= window.innerHeight - viewportPadding;
  const top = hasRoomBelow
    ? bounds.bottom + gap
    : Math.max(viewportTopPadding, bounds.top - estimatedHeight - gap);

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(Math.max(viewportTopPadding, top))}px`,
  };
};
