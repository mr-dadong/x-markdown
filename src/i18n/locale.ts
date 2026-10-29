// 应用目前只提供简体中文与英文两种界面语言。
export type UiLocale = "zh-CN" | "en";

// 用户偏好：跟随系统，或显式指定某种受支持语言。
export type LanguagePreference = "system" | UiLocale;

export const isUiLocale = (value: unknown): value is UiLocale =>
  value === "zh-CN" || value === "en";

export const isLanguagePreference = (
  value: unknown,
): value is LanguagePreference => value === "system" || isUiLocale(value);

// 系统语言标签可能带地区、书写系统或下划线（如 zh_CN、zh-Hant-TW），
// 判断受支持语言时只看主语言子标签。
const primaryLanguage = (tag: string): string =>
  tag.trim().toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";

// 按系统首选顺序取第一个受支持语言；没有中文或英文时统一回退英文。
export const resolveLocale = (languages: readonly string[]): UiLocale => {
  for (const tag of languages) {
    const primary = primaryLanguage(tag);
    // 目前只有简体中文译文，繁体中文系统也显示简体中文。
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
};

// 用户显式选择优先于系统语言；跟随系统时再走系统语言列表。
export const resolveEffectiveLocale = (
  preference: LanguagePreference,
  languages: readonly string[],
): UiLocale =>
  preference === "system" ? resolveLocale(languages) : preference;
