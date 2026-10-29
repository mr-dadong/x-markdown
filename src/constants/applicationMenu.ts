import type { MessageKey } from "../i18n/messages/zh-CN";

// 标题栏按钮与主进程原生菜单按索引对齐（popup 时取第 N 个子菜单），
// 因此顺序必须固定并从同一份 key 取文案。
export const APPLICATION_MENU_KEYS: readonly MessageKey[] = [
  "menu.file",
  "menu.export",
  "menu.edit",
  "menu.view",
  "menu.window",
];
