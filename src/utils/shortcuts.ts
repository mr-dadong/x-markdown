// 快捷键工具：统一的解析、匹配、录制与格式化逻辑。
// “Ctrl” 在 macOS 上表示 Command（与 Electron 菜单的 CmdOrCtrl 语义一致），
// 显式的 “Cmd” 只匹配 Command / Meta 键本身。

export interface ParsedShortcut {
  /** 平台主修饰键：Windows / Linux 为 Ctrl，macOS 为 Cmd。 */
  primary: boolean
  /** 显式 Command / Meta（macOS 的 ⌘，Windows 的 Win 键）。 */
  cmd: boolean
  alt: boolean
  shift: boolean
  /** 规范化后的主键标识，例如 S、/、F3、Enter。 */
  key: string
}

const MODIFIER_ALIASES: Record<string, 'primary' | 'cmd' | 'alt' | 'shift'> = {
  ctrl: 'primary',
  control: 'primary',
  mod: 'primary',
  cmd: 'cmd',
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  win: 'cmd',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

// 按键 code → 规范化主键 token（布局无关，避免受 Shift 影响而变化）。
const CODE_TO_KEY: Record<string, string> = {
  Slash: '/',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Backslash: '\\',
  IntlBackslash: '\\',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
}

const NAMED_KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  ' ': 'Space',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

// 主键是标点或数字时，Shift 组合会产生另一个字符，匹配时一并接受。
const SHIFTED_CHARS: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~',
}

const PUNCTUATION_KEYS = new Set(Object.keys(SHIFTED_CHARS))

/** 平台主修饰键在设置页中的显示名称。 */
export const PRIMARY_MODIFIER_LABEL = (): 'Cmd' | 'Ctrl' => (isMacPlatform() ? 'Cmd' : 'Ctrl')

/** 判断当前是否运行在 macOS 上（渲染进程）。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /Mac/i.test(navigator.platform ?? '') ||
    /Macintosh/i.test(navigator.userAgent)
  )
}

/** 把任意按键名称规范成统一的 token；无法识别时返回 null。 */
export function normalizeKeyToken(token: string): string | null {
  const raw = token.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase()
  if (/^[0-9]$/.test(lower)) return lower
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase()
  const alias = NAMED_KEY_ALIASES[lower]
  if (alias) return alias
  if (PUNCTUATION_KEYS.has(raw)) return raw
  return null
}

/** 把存储的快捷键文本解析成结构化描述；格式非法时返回 null。 */
export function parseShortcut(shortcut: string | null | undefined): ParsedShortcut | null {
  if (!shortcut) return null
  const tokens = shortcut
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null

  let primary = false
  let cmd = false
  let alt = false
  let shift = false
  let key = ''
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier === 'primary') primary = true
    else if (modifier === 'cmd') cmd = true
    else if (modifier === 'alt') alt = true
    else if (modifier === 'shift') shift = true
    else {
      if (key) return null // 组合中只允许一个主键
      const normalized = normalizeKeyToken(token)
      if (!normalized) return null
      key = normalized
    }
  }
  if (!key) return null
  return { primary, cmd, alt, shift, key }
}

export function isValidShortcut(shortcut: string | null | undefined): boolean {
  return parseShortcut(shortcut) !== null
}

function keyMatches(eventKey: string, expected: string): boolean {
  if (expected === 'Space') return eventKey === ' ' || eventKey === 'Spacebar'
  if (/^[A-Z]$/.test(expected)) return eventKey.toLowerCase() === expected.toLowerCase()
  if (/^F\d+$/.test(expected)) return eventKey.toUpperCase() === expected
  if (expected === 'Escape') return eventKey === 'Escape' || eventKey === 'Esc'
  if (expected === 'Enter') return eventKey === 'Enter' || eventKey === 'Return'
  if (expected === 'ArrowUp') return eventKey === 'ArrowUp' || eventKey === 'Up'
  if (expected === 'ArrowDown') return eventKey === 'ArrowDown' || eventKey === 'Down'
  if (expected === 'ArrowLeft') return eventKey === 'ArrowLeft' || eventKey === 'Left'
  if (expected === 'ArrowRight') return eventKey === 'ArrowRight' || eventKey === 'Right'
  return eventKey === expected || SHIFTED_CHARS[expected] === eventKey
}

export interface ShortcutMatchOptions {
  /** 忽略 Shift 状态：用于“保存 / 另存为”这类把 Shift 当作附加信号的动作。 */
  ignoreShift?: boolean
}

/** 判断一次键盘事件是否命中给定的快捷键文本（或解析结果）。 */
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
  shortcut: string | ParsedShortcut | null | undefined,
  options: ShortcutMatchOptions = {},
): boolean {
  const parsed = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut
  if (!parsed) return false
  const { ctrlKey, metaKey, altKey, shiftKey, key } = event
  const isMac = isMacPlatform()

  // 平台主修饰键按下且互斥：macOS 上是 Command，其余平台是 Control。
  let primaryOk = true
  if (parsed.primary) {
    primaryOk = isMac ? metaKey && !ctrlKey : ctrlKey && !metaKey
  }
  // 显式 Command / Meta 键。
  let cmdOk = true
  if (parsed.cmd) {
    cmdOk = isMac ? metaKey && !ctrlKey : metaKey
  }
  // 没有声明任何命令修饰键时，Ctrl / Cmd 都不能按下。
  let noCommandKeys = true
  if (!parsed.primary && !parsed.cmd) {
    noCommandKeys = !ctrlKey && !metaKey
  }
  const altOk = altKey === parsed.alt
  const shiftOk = options.ignoreShift ? true : shiftKey === parsed.shift
  return primaryOk && cmdOk && noCommandKeys && altOk && shiftOk && keyMatches(key, parsed.key)
}

/** 从一次键盘事件生成规范化的快捷键文本；单独按下修饰键等无效组合返回 null。 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null

  const keyToken = keyTokenFromEvent(event)
  if (!keyToken) return null

  const isMac = isMacPlatform()
  const parts: string[] = []
  if (isMac) {
    if (event.metaKey && !event.ctrlKey) parts.push('Cmd')
    else if (event.ctrlKey) parts.push('Ctrl')
  } else {
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.metaKey) parts.push('Cmd')
  }
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(keyToken)
  return parts.join('+')
}

function keyTokenFromEvent(event: KeyboardEvent): string | null {
  const code = event.code
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code]
  if (code && /^Key[A-Z]$/.test(code)) return code.slice(3).toUpperCase()
  if (code && /^Digit[0-9]$/.test(code)) return code.slice(5)
  if (code && /^F\d+$/.test(code)) return code
  // 兜底：无法从 code 识别时使用事件自身的 key。
  return normalizeKeyToken(event.key)
}

/** 把快捷键文本拆成用于键帽展示的片段，例如 ['Ctrl', 'Shift', 'S']。 */
export function formatShortcutParts(
  shortcut: string | null | undefined,
): string[] {
  const parsed = typeof shortcut === 'string' ? parseShortcut(shortcut) : null
  if (!parsed) return []
  const parts: string[] = []
  if (parsed.primary) parts.push(PRIMARY_MODIFIER_LABEL())
  if (parsed.cmd) parts.push('Cmd')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  parts.push(displayKey(parsed.key))
  return parts
}

function displayKey(key: string): string {
  if (key === 'Escape') return 'Esc'
  if (key === 'ArrowUp') return '↑'
  if (key === 'ArrowDown') return '↓'
  if (key === 'ArrowLeft') return '←'
  if (key === 'ArrowRight') return '→'
  if (key === 'PageUp') return 'PgUp'
  if (key === 'PageDown') return 'PgDn'
  return key
}
