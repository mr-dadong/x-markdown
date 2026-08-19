// 快捷键目录：设置页展示、默认值与各处理点共用的唯一来源。
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
  label: string
  description: string
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'newFile', label: '新建文档', description: '创建一个空白 Markdown 文档' },
  { id: 'openFile', label: '打开文档', description: '从本地选择并打开文档' },
  { id: 'saveFile', label: '保存文档', description: '保存当前文档的修改' },
  { id: 'toggleSidebar', label: '显示 / 隐藏侧边栏', description: '切换项目文件与大纲面板' },
  { id: 'toggleSource', label: '切换编辑模式', description: '在 MD 预览和源码展示间切换' },
  { id: 'openSettings', label: '打开设置', description: '打开应用设置中心' },
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
