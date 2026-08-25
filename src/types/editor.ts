import type { Editor } from "@tiptap/core";
import type { EditorView } from "@codemirror/view";

// 页面只依赖编辑器明确公开的能力，避免使用 any 掩盖接口变化。
export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void;
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
  // 查找替换等编辑视图能力通过编辑器实例对外提供。
  getEditor: () => Editor | null;
  getSelectionText: () => string;
  replaceSelection: (text: string) => void;
  insertAtCursor: (text: string) => void;
}

export interface SourceEditorHandle {
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
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
}
