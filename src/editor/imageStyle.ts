/*
 * 图片 style 的解析规则（与 Typora 对齐）：
 * - 尺寸类声明（width/height/zoom）在编辑器里生效，其余声明只影响导出；
 * - 整段 style 原文必须逐字写回，避免用户的样式在存盘时静默丢失；
 * - 手动调整宽度会锁死宽高比，因此宽高声明要被去掉，其它声明保留。
 */

/** 取出 style 里某条以 px 计的长宽声明；只认 px，用于编辑器显示。 */
export const readStylePixels = (
  styleText: string | null,
  property: "width" | "height",
): number | null => {
  if (!styleText) return null;
  const match = styleText.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "iu"),
  );
  if (!match) return null;
  const pixels = Number.parseFloat(match[1]);
  return Number.isFinite(pixels) && pixels > 0 ? Math.round(pixels) : null;
};

/** 取出 style 里的 zoom 百分比（Typora 用 `style="zoom:50%"` 缩放 retina 图）。 */
export const readStyleZoom = (styleText: string | null): number | null => {
  const match = styleText?.match(/(?:^|;)\s*zoom\s*:\s*(\d+(?:\.\d+)?)\s*%/iu);
  if (!match) return null;
  const zoom = Number.parseFloat(match[1]);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
};

/**
 * 去掉 style 里的 width/height 声明，其余声明（zoom、边框等）原样保留。
 * 手动拖动调整宽度后必须调用：残留的固定宽高会与新的宽度冲突并把图片拉变形。
 */
export const stripStyleSizes = (styleText: string | null): string | null => {
  if (!styleText) return null;
  const next = styleText
    .replace(/(?:^|;)\s*(?:width|height)\s*:[^;]*/giu, "")
    .replace(/^;+|;+$/gu, "")
    .trim();
  return next === "" ? null : next;
};
