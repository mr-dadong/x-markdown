/**
 * 隔离预览 iframe 的高度：只由预览正文的内容高度决定。
 *
 * 不能把 documentElement.scrollHeight 也算进来：它至少等于 iframe 自身的视口高度。
 * 只要某次测量发生在内容偏高的瞬间（编辑器宽度尚未稳定、图片还没加载完），
 * 高度就再也缩不回去 —— 表现为预览块下方留下永久空白。
 * 高度必须双向跟随内容：内容变矮时也要收缩。
 */
export const resolvePreviewHeight = (bodyScrollHeight: number): number =>
  Math.max(32, bodyScrollHeight);