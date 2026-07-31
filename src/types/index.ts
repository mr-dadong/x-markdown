/**
 * 项目类型定义
 */

// 文件项接口
export interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
  children?: FileItem[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

// 标题接口
export interface Heading {
  id: string;
  text: string;
  level: number;
  index: number;
}

// 打开文档接口
export interface OpenDocument {
  id: number;
  filePath: string | null;
  content: string;
  // 保存最近一次成功写入磁盘的内容，用于在撤销后准确恢复“已保存”状态。
  savedContent: string;
  // 保存时比较磁盘修改时间，避免覆盖其他编辑器刚写入的内容。
  modifiedTime: number | null;
  isModified: boolean;
}

// 主题类型
export type Theme = "light" | "dark";

// 侧边栏标签类型
export type SidebarTab = "files" | "outline";
