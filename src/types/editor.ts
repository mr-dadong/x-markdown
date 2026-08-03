import type { Editor } from "@tiptap/core";

// 页面只依赖编辑器明确公开的能力，避免使用 any 掩盖接口变化。
export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void;
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
  // 查找替换等编辑视图能力通过编辑器实例对外提供。
  getEditor: () => Editor | null;
}

export interface SourceEditorHandle {
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
  // 源码模式查找替换直接操作 textarea 原生选区与内容。
  getTextarea: () => HTMLTextAreaElement | null;
}
