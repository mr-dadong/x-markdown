import type { UiLocale } from "./locale";
import type { MessageKey } from "./messages/zh-CN";
import { translate, type MessageParams } from "./translate";

// 主进程共享模块（文档起草、字面编辑）不能依赖 Electron API，
// 因此把“当前语言”放在纯 TS 模块里，由 electron/i18n.ts 在启动时写入。
// 默认值与改造前的行为一致（全中文），测试与未初始化的调用保持稳定。
let currentLocale: UiLocale = "zh-CN";

export const setCurrentLocale = (locale: UiLocale): void => {
  currentLocale = locale;
};

export const currentT = (key: MessageKey, params?: MessageParams): string =>
  translate(currentLocale, key, params);
