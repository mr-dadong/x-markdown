import { app } from "electron";
import { setCurrentLocale, currentT } from "../src/i18n/current";
import { resolveLocale, type UiLocale } from "../src/i18n/locale";
import type { MessageKey } from "../src/i18n/messages/zh-CN";
import type { MessageParams } from "../src/i18n/translate";

let uiLocale: UiLocale | null = null;

// 系统语言列表只有主进程能读到；延迟到首次使用时读取，保证 app 已就绪。
const systemLanguages = (): string[] => [
  ...app.getPreferredSystemLanguages(),
  app.getLocale(),
];

export const getMainUiLocale = (): UiLocale => {
  uiLocale ??= resolveLocale(systemLanguages());
  return uiLocale;
};

// 渲染层能读到用户偏好，因此主进程以渲染层同步过来的值为准。
export const setMainUiLocale = (locale: UiLocale): void => {
  uiLocale = locale;
  setCurrentLocale(locale);
};

export const mainT = (key: MessageKey, params?: MessageParams): string => {
  // 首次取文案时把系统语言写入共享状态，确保起草与编辑模块同步使用同一语言。
  setCurrentLocale(getMainUiLocale());
  return currentT(key, params);
};
