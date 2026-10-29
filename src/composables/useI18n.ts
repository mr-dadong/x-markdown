import { ref, watch } from 'vue'
import { resolveEffectiveLocale, type LanguagePreference, type UiLocale } from '../i18n/locale'
import { setCurrentLocale } from '../i18n/current'
import type { MessageKey } from '../i18n/messages/zh-CN'
import { translate, type MessageParams } from '../i18n/translate'
import { useSettings } from './useSettings'

const { settings } = useSettings()

// 界面语言在模块加载时同步解析：首屏就使用正确语言，避免异步 IPC 造成语言闪烁。
export const locale = ref<UiLocale>(
  resolveEffectiveLocale(settings.language, navigator.languages),
)
// 共享纯 TS 模块（如文档校验）通过 currentT 取文案，需要和渲染层语言保持一致。
setCurrentLocale(locale.value)

watch(
  () => settings.language,
  (preference) => {
    locale.value = resolveEffectiveLocale(preference, navigator.languages)
    setCurrentLocale(locale.value)
  },
)

// t 在渲染期间读取 locale，因此组件会随语言切换自动重新渲染。
export const t = (key: MessageKey, params?: MessageParams): string =>
  translate(locale.value, key, params)

export const setLanguagePreference = (preference: LanguagePreference): void => {
  settings.language = preference
  // 偏好值可能没有变化（例如仍为跟随系统），这里仍按当前系统语言重新解析一次。
  locale.value = resolveEffectiveLocale(preference, navigator.languages)
  setCurrentLocale(locale.value)
}

// 只在真实渲染进程调用：测试环境不注册 DOM 语言标记与主进程同步。
export const setupI18n = (): void => {
  watch(
    locale,
    (value) => {
      document.documentElement.lang = value
      setCurrentLocale(value)
      window.electronAPI.setUiLocale(value)
    },
    { immediate: true },
  )
}

export const useI18n = () => ({ locale, t, setLanguagePreference })
