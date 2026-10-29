// 快捷键目录：设置页展示、默认值与各处理点共用的唯一来源。
import type { MessageKey } from '../i18n/messages/zh-CN'
import { isMacPlatform } from '../utils/shortcuts'

export const SHORTCUT_IDS = [
  'newFile',
  'openFile',
  'saveFile',
  'toggleSidebar',
  'toggleSource',
  'openSettings',
] as const

export type ShortcutId = (typeof SHORTCUT_IDS)[number]

export interface ShortcutDefinition {
  id: ShortcutId
  labelKey: MessageKey
  descriptionKey: MessageKey
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'newFile', labelKey: 'settings.shortcut.newFile.label', descriptionKey: 'settings.shortcut.newFile.description' },
  { id: 'openFile', labelKey: 'settings.shortcut.openFile.label', descriptionKey: 'settings.shortcut.openFile.description' },
  { id: 'saveFile', labelKey: 'settings.shortcut.saveFile.label', descriptionKey: 'settings.shortcut.saveFile.description' },
  { id: 'toggleSidebar', labelKey: 'settings.shortcut.toggleSidebar.label', descriptionKey: 'settings.shortcut.toggleSidebar.description' },
  { id: 'toggleSource', labelKey: 'settings.shortcut.toggleSource.label', descriptionKey: 'settings.shortcut.toggleSource.description' },
  { id: 'openSettings', labelKey: 'settings.shortcut.openSettings.label', descriptionKey: 'settings.shortcut.openSettings.description' },
]

const DEFAULT_KEYS: Record<ShortcutId, string> = {
  newFile: 'N',
  openFile: 'O',
  saveFile: 'S',
  toggleSidebar: 'B',
  toggleSource: '/',
  openSettings: ',',
}

/** 返回平台适配的默认快捷键：macOS 使用 Cmd，其余平台使用 Ctrl。 */
export function defaultShortcuts(): Record<ShortcutId, string> {
  const primary = isMacPlatform() ? 'Cmd' : 'Ctrl'
  const result = {} as Record<ShortcutId, string>
  for (const [id, key] of Object.entries(DEFAULT_KEYS) as [ShortcutId, string][]) {
    result[id] = `${primary}+${key}`
  }
  return result
}
