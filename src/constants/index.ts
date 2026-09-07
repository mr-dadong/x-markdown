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

// 查找替换事务的显式标记。查找输入框聚焦时编辑器本身未获得焦点，替换操作产生的
// 事务按默认规则不会被视为用户编辑、也就不会同步给文档层；替换操作带上此标记，
// 让内容更新仍能落到标签页，否则切回标签时内容会回退到替换之前。
export const FIND_REPLACE_EDIT_META = "xmd-find-replace-edit";

// 侧边栏配置
export const SIDEBAR_CONFIG = {
  width: 292,
  tabs: [
    { id: "outline" as const, label: "大纲", icon: "lucide:list-tree" },
    { id: "files" as const, label: "文件", icon: "lucide:files" },
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
