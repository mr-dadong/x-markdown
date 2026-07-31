import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'

const TAB_TEXT = '  '

/** 在代码块中插入缩进；Shift+Tab 会移除当前行开头最多两个空格。 */
export const handleCodeBlockTab = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false

  const { selection } = view.state
  const { $from } = selection
  if ($from.parent.type.name !== 'codeBlock') return false

  event.preventDefault()

  if (!event.shiftKey) {
    view.dispatch(view.state.tr.insertText(TAB_TEXT, selection.from, selection.to))
    return true
  }

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset)
  const lineStartOffset = textBeforeCursor.lastIndexOf('\n') + 1
  const lineText = $from.parent.textBetween(lineStartOffset, $from.parentOffset)
  const indentationLength = lineText.match(/^ {1,2}/)?.[0].length ?? 0
  if (!indentationLength) return true

  const lineStartPosition = $from.start() + lineStartOffset
  view.dispatch(view.state.tr.delete(lineStartPosition, lineStartPosition + indentationLength))
  return true
}

/** 在代码块内按 Ctrl+A 或 Cmd+A 时，只选中当前代码块的正文。 */
export const handleCodeBlockSelectAll = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key.toLocaleLowerCase() !== 'a' || (!event.ctrlKey && !event.metaKey) || event.altKey) return false

  const { $from, $to } = view.state.selection
  if ($from.parent.type.name !== 'codeBlock' || $to.parent.type.name !== 'codeBlock') return false
  if ($from.before() !== $to.before()) return false

  event.preventDefault()
  const codeStart = $from.start()
  const codeEnd = codeStart + $from.parent.content.size
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, codeStart, codeEnd)))
  return true
}
