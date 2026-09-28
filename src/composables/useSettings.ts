import { reactive, watch } from 'vue'
import type { CodeBlockStyleId } from '../modules/codeBlockStyles'
import type { PdfPageSize } from '../utils/pdfOptions'
import { defaultShortcuts } from '../constants/shortcuts'
import { isValidShortcut } from '../utils/shortcuts'

export type SettingsSection = 'general' | 'typography' | 'theme' | 'export' | 'shortcuts' | 'ai' | 'changelog' | 'about'
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
  // 导出 PDF：纸张、页边距（英寸）、页眉页脚（支持 ${pageNo} 等占位符）、标题间分页。
  pdfPageSize: PdfPageSize
  pdfPageWidth: number
  pdfPageHeight: number
  pdfMargin: number
  pdfHeaderText: string
  pdfFooterText: string
  pdfBreakBetweenH1: boolean
  shortcuts: Record<string, string>
}

const SETTINGS_STORAGE_KEY = 'xmd-app-settings'

const defaultSettings: AppSettings = {
  editorMode: 'preview',
  showSlashCommandDescriptions: false,
  attachmentHandling: 'reference',
  autoSave: false,
  autoSaveInterval: 5,
  codeWrap: true,
  codeLineNumbers: false,
  codeBlockStyle: 'mac',
  themeMode: 'system',
  bodyFontSize: '15',
  bodyFont: 'system',
  lineWidth: 'full',
  previewZoom: 'standard',
  pdfPageSize: 'A4',
  // 8.27 × 11.69 英寸即 A4；页边距 0.5 英寸与旧版硬编码值一致。
  pdfPageWidth: 8.27,
  pdfPageHeight: 11.69,
  pdfMargin: 0.5,
  pdfHeaderText: '',
  pdfFooterText: '',
  pdfBreakBetweenH1: false,
  shortcuts: defaultShortcuts(),
}

// 只保留格式合法的快捷键，避免历史脏数据或手工输入破坏后续匹配。
const sanitizeShortcuts = (
  shortcuts: Record<string, string> | undefined,
): Record<string, string> => {
  const result: Record<string, string> = {}
  if (!shortcuts) return result
  for (const [id, value] of Object.entries(shortcuts)) {
    if (typeof value === 'string' && isValidShortcut(value)) result[id] = value
  }
  return result
}

const getInitialSettings = (): AppSettings => {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY)
  if (!savedSettings) return structuredClone(defaultSettings)

  try {
    const parsedSettings = JSON.parse(savedSettings) as Partial<AppSettings>
    return {
      ...structuredClone(defaultSettings),
      ...parsedSettings,
      shortcuts: { ...defaultSettings.shortcuts, ...sanitizeShortcuts(parsedSettings.shortcuts) },
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

// 快捷键改动实时同步到主进程，让系统菜单加速键（CmdOrCtrl+N 等）跟随设置。
watch(
  () => settings.shortcuts,
  (shortcuts) => window.electronAPI.updateShortcuts({ ...shortcuts }),
  { deep: true, immediate: true },
)

export const useSettings = () => {
  const resetShortcuts = (): void => {
    settings.shortcuts = { ...defaultShortcuts() }
  }

  return {
    settings,
    resetShortcuts,
  }
}
