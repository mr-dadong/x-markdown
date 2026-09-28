/*
 * 图片尺寸与 style 的解析规则（与 Typora 对齐）：
 * - 尺寸类声明（width/height/zoom）在编辑器里生效，其余声明只影响导出；
 * - 整段 style 原文必须逐字写回，避免用户的样式在存盘时静默丢失；
 * - 手动调整宽度会锁死宽高比，因此宽高声明要被去掉，其它声明保留。
 */

/**
 * 解析 `<img width="...">` 这类尺寸属性。
 *
 * README 里最常见的写法是百分比（`width="60%"`），它表达的是「占容器宽度的比例」，
 * 早先的实现用 parseInt 读属性，`60%` 会被读成 60 像素 —— 图片缩成一条小图标，
 * 与网页渲染差得最远。因此：
 * - 百分比原样保留成字符串（"60%"），交给 CSS 按容器宽度计算；
 * - 像素值仍然返回数字，`16` 与 `16px` 两种写法都接受（后者是历史行为）；
 * - 其它写法（auto、-5、60 %）一律返回 null，不猜默认值。
 */
export const readImageSizeAttribute = (raw: string | null): number | string | null => {
  const value = (raw ?? "").trim();
  if (value === "") return null;

  if (/^\d+(?:\.\d+)?%$/u.test(value)) return value;
  if (!/^\d+(?:\.\d+)?(?:px)?$/u.test(value)) return null;

  const pixels = Number.parseInt(value, 10);
  return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
};

/**
 * 把尺寸属性写成 CSS 长度：数字按像素，百分比字符串原样使用。
 * 供图片节点视图使用，避免在渲染处再判断一次类型。
 */
export const toCssLength = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "number" ? `${value}px` : String(value);
};

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
