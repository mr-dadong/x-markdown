/**
 * 项目常量定义
 */

// 主题存储键
export const THEME_STORAGE_KEY = "markdown-editor-theme";

// 支持的文件扩展名
export const SUPPORTED_FILE_EXTENSIONS = [".md", ".markdown"];

// 编辑器配置
export const EDITOR_CONFIG = {
  placeholder: "开始写作...",
  spellcheck: false,
} as const;

// 侧边栏配置
export const SIDEBAR_CONFIG = {
  width: 292,
  tabs: [
    { id: "files" as const, label: "文件", icon: "lucide:files" },
    { id: "outline" as const, label: "大纲", icon: "lucide:list-tree" },
  ],
} as const;

// 状态栏配置
export const STATUS_BAR_CONFIG = {
  height: 30,
} as const;

// 标题栏配置
export const HEADER_CONFIG = {
  height: 40,
} as const;
