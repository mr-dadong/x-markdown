import { reactive, watch } from 'vue'
import type { CodeBlockStyleId } from '../modules/codeBlockStyles'

export type SettingsSection = 'general' | 'theme' | 'shortcuts' | 'changelog' | 'about'
export type ThemeMode = 'system' | 'light' | 'dark'
export type EditorMode = 'preview' | 'source'
export type AttachmentHandling = 'reference' | 'copy-to-assets'

interface AppSettings {
  editorMode: EditorMode
  showSlashCommandDescriptions: boolean
  attachmentHandling: AttachmentHandling
  codeWrap: boolean
  codeLineNumbers: boolean
  codeBlockStyle: CodeBlockStyleId
  themeMode: ThemeMode
  shortcuts: Record<string, string>
}

const SETTINGS_STORAGE_KEY = 'xmd-app-settings'

const defaultSettings: AppSettings = {
  editorMode: 'preview',
  showSlashCommandDescriptions: false,
  attachmentHandling: 'reference',
  codeWrap: true,
  codeLineNumbers: false,
  codeBlockStyle: 'mac',
  themeMode: 'system',
  shortcuts: {
    newFile: 'Ctrl+N',
    openFile: 'Ctrl+O',
    saveFile: 'Ctrl+S',
    toggleSidebar: 'Ctrl+B',
    toggleSource: 'Ctrl+/',
    openSettings: 'Ctrl+,',
  },
}

const getInitialSettings = (): AppSettings => {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY)
  if (!savedSettings) return structuredClone(defaultSettings)

  try {
    const parsedSettings = JSON.parse(savedSettings) as Partial<AppSettings>
    return {
      ...structuredClone(defaultSettings),
      ...parsedSettings,
      shortcuts: { ...defaultSettings.shortcuts, ...parsedSettings.shortcuts },
    }
  } catch {
    // 本地数据格式无效时直接恢复明确的默认设置。
    return structuredClone(defaultSettings)
  }
}

const settings = reactive<AppSettings>(getInitialSettings())

watch(
  settings,
  (newSettings) => localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings)),
  { deep: true },
)

export const useSettings = () => {
  const resetShortcuts = (): void => {
    settings.shortcuts = { ...defaultSettings.shortcuts }
  }

  return {
    settings,
    resetShortcuts,
  }
}
