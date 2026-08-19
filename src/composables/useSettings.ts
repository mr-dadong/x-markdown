import { reactive, watch } from 'vue'
import type { CodeBlockStyleId } from '../modules/codeBlockStyles'

export type SettingsSection = 'general' | 'typography' | 'theme' | 'shortcuts' | 'changelog' | 'about'
export type ThemeMode = 'system' | 'light' | 'dark'
export type EditorMode = 'preview' | 'source'
export type AttachmentHandling = 'reference' | 'copy-to-assets'
export type EditorBodyFontSize = '14' | '15' | '16' | '17' | '18'
export type EditorBodyFont = 'system' | 'serif' | 'sans' | 'mono'
export type EditorLineWidth = 'narrow' | 'medium' | 'wide' | 'full'
export type PreviewZoomLevel = 'small' | 'standard' | 'large' | 'xlarge'

interface AppSettings {
  editorMode: EditorMode
  showSlashCommandDescriptions: boolean
  attachmentHandling: AttachmentHandling
  autoSave: boolean
  autoSaveInterval: number
  codeWrap: boolean
  codeLineNumbers: boolean
  codeBlockStyle: CodeBlockStyleId
  themeMode: ThemeMode
  // 编辑器排版：正文字号 / 字体 / 行宽，以及预览模式缩放。
  bodyFontSize: EditorBodyFontSize
  bodyFont: EditorBodyFont
  lineWidth: EditorLineWidth
  previewZoom: PreviewZoomLevel
  shortcuts: Record<string, string>
}

const SETTINGS_STORAGE_KEY = 'xmd-app-settings'

const defaultSettings: AppSettings = {
  editorMode: 'preview',
  showSlashCommandDescriptions: false,
  attachmentHandling: 'reference',
  autoSave: true,
  autoSaveInterval: 5,
  codeWrap: true,
  codeLineNumbers: false,
  codeBlockStyle: 'mac',
  themeMode: 'system',
  bodyFontSize: '15',
  bodyFont: 'system',
  lineWidth: 'full',
  previewZoom: 'standard',
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
