/**
 * 项目常量定义
 */

// 查找替换事务的显式标记。查找输入框聚焦时编辑器本身未获得焦点，替换操作产生的
// 事务按默认规则不会被视为用户编辑、也就不会同步给文档层；替换操作带上此标记，
// 让内容更新仍能落到标签页，否则切回标签时内容会回退到替换之前。
export const FIND_REPLACE_EDIT_META = "xmd-find-replace-edit";

// 应用可打开的文档与压缩包扩展名：打开对话框、系统菜单、拖放、命令行入口共用，
// 避免各处各写一份后悄悄不一致。
export const OPENABLE_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ".zip"] as const;

// 打开对话框的文件过滤器，与 OPENABLE_FILE_EXTENSIONS 保持同步。
export const OPEN_FILE_DIALOG_FILTERS: Array<{
  name: string;
  extensions: string[];
}> = [
    { name: "Markdown / 压缩包", extensions: ["md", "markdown", "txt", "zip"] },
    { name: "所有文件", extensions: ["*"] },
  ];

// 侧边栏配置：标签页清单被 Sidebar.vue 使用，是侧栏结构的唯一来源。
// 宽度由 Sidebar.vue 的 Tailwind 类直接给出，此处不再重复维护，避免两处不一致。
export const SIDEBAR_CONFIG = {
  tabs: [
    { id: "outline" as const, label: "大纲", icon: "lucide:list-tree" },
    { id: "files" as const, label: "文件", icon: "lucide:files" },
  ],
} as const;
