import type { UiLocale } from "../i18n/locale";

// 更新日志来自远程发布清单，英文内容可能暂时缺失；这里集中决定展示哪一种语言。
export interface LocalizableRelease {
  title: string;
  content: string[];
  titleEn?: string;
  contentEn?: string[];
}

export interface ReleaseNotes {
  title: string;
  content: string[];
  // 英文界面展示了中文内容时置为 true，界面需要明确提示而不是静默回退。
  untranslated: boolean;
}

export const resolveReleaseNotes = (
  release: LocalizableRelease,
  locale: UiLocale,
): ReleaseNotes => {
  if (locale === "en") {
    if (release.titleEn?.trim() && release.contentEn?.length) {
      return {
        title: release.titleEn,
        content: release.contentEn,
        untranslated: false,
      };
    }
    return {
      title: release.title,
      content: release.content,
      untranslated: true,
    };
  }
  return { title: release.title, content: release.content, untranslated: false };
};
