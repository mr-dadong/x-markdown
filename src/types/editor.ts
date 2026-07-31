// 页面只依赖编辑器明确公开的能力，避免使用 any 掩盖接口变化。
export interface EditorHandle {
  scrollToHeading: (headingIndex: number) => void;
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
}

export interface SourceEditorHandle {
  getScrollProgress: () => number;
  setScrollProgress: (progress: number) => void;
}
