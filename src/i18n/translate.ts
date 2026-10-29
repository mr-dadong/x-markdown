import type { UiLocale } from "./locale";
import { en } from "./messages/en";
import { zhCN, type MessageKey } from "./messages/zh-CN";

export type MessageParams = Record<string, string | number>;

const messages: Record<UiLocale, Record<MessageKey, string>> = {
  "zh-CN": zhCN,
  en,
};

const LITERAL_OPEN = "\u0000";
const LITERAL_CLOSE = "\u0001";

// 只做 {name} 占位符替换；缺少参数属于编码错误，直接抛出而不是输出残缺文案。
// 文案需要展示字面大括号时写成 {{name}}，先转义再插值，避免被误判为参数。
export const translate = (
  locale: UiLocale,
  key: MessageKey,
  params?: MessageParams,
): string => {
  const template = messages[locale][key]
    .replace(/\{\{/g, LITERAL_OPEN)
    .replace(/\}\}/g, LITERAL_CLOSE);

  return template
    .replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!params || !(name in params)) {
        throw new Error(`i18n missing parameter: ${key} -> {${name}}`);
      }
      return String(params[name]);
    })
    .replaceAll(LITERAL_OPEN, "{")
    .replaceAll(LITERAL_CLOSE, "}");
};
