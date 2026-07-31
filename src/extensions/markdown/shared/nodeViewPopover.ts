export const getNodeViewPopoverPosition = (
  anchor: HTMLElement,
  width: number,
  estimatedHeight: number,
): Record<string, string> => {
  const bounds = anchor.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 8;
  const maximumLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
  const left = Math.max(viewportPadding, Math.min(bounds.right - width, maximumLeft));
  const hasRoomBelow = bounds.bottom + gap + estimatedHeight <= window.innerHeight - viewportPadding;
  const top = hasRoomBelow
    ? bounds.bottom + gap
    : Math.max(viewportPadding, bounds.top - estimatedHeight - gap);

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
};
