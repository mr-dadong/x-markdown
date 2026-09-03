import type { Editor } from "@tiptap/core";
import type { EditorView } from "@codemirror/view";

// 页面只依赖编辑器明确公开的能力，避免使用 any 掩盖接口变化。

// 渲染视图的阅读位置锚点：视口顶部所在顶层块序号，以及视口顶部切入该块的深度比例（0 到 1）。
// 保留比例才能在往返切换时回到块内同一相对位置，而不是跳回块顶。
export interface ViewportAnchor {
  index: number;
  fraction: number;
}

export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void;
  // 视图切换定位：渲染视图以“顶层块 + 块内偏移比例”为锚点。
  getViewportAnchor: () => ViewportAnchor | null;
  getBlockCount: () => number;
  scrollToBlockFraction: (index: number, fraction: number) => void;
  // 查找替换等编辑视图能力通过编辑器实例对外提供。
  getEditor: () => Editor | null;
  getSelectionText: () => string;
  replaceSelection: (text: string) => void;
  insertAtCursor: (text: string) => void;
  /** 光标在 Markdown 源码中的字符偏移（近似值）；无编辑器时返回 null。 */
  getCursorOffset: () => number | null;
}

export interface SourceEditorHandle {
  // 视图切换定位：源码视图以视口顶部行号为锚点（0 起始，与 markdown-it 一致）。
  getViewportSourceLine: () => number | null;
  scrollToSourceLine: (line: number) => void;
  // 源码模式查找替换通过 CodeMirror 视图操作文档与选区。
  getView: () => EditorView | null;
  // 查找面板调用：把匹配列表同步为 CodeMirror 行内高亮装饰。
  updateSearch: (
    matches: { from: number; to: number }[],
    currentIndex: number,
  ) => void;
  // 关闭查找面板时清空源码模式的搜索装饰。
  clearSearch: () => void;
  getSelectionText: () => string;
  replaceSelection: (text: string) => void;
  insertAtCursor: (text: string) => void;
  /** 光标在源码中的字符偏移（CodeMirror 坐标，与文档源码一致）；无编辑器时返回 null。 */
  getCursorOffset: () => number | null;
}
