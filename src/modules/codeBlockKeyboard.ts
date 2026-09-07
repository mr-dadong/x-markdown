import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'

const TAB_TEXT = '  '

/** 在代码块内按 Ctrl+X 或 Cmd+X（且未选中任何文字）时，剪切光标所在的整行内容。 */
export const handleCodeBlockCut = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key.toLocaleLowerCase() !== 'x' || (!event.ctrlKey && !event.metaKey) || event.altKey) return false

  const { selection } = view.state
  const { $from, $to } = selection
  if (!selection.empty) return false
  if ($from.parent.type.name !== 'codeBlock' || $to.parent.type.name !== 'codeBlock') return false
  if ($from.before() !== $to.before()) return false

  event.preventDefault()

  const codeText = $from.parent.textContent
  const cursorOffset = $from.parentOffset
  // 光标所在行的起始与结束（结束位置不含行尾换行符）。
  const lineStart = codeText.lastIndexOf('\n', Math.max(0, cursorOffset - 1)) + 1
  const maybeLineEnd = codeText.indexOf('\n', cursorOffset)
  const lineEnd = maybeLineEnd === -1 ? codeText.length : maybeLineEnd

  // 整行删除范围：优先连同行尾换行一起删，避免留下空行。
  let deleteFrom = lineStart
  let deleteTo = lineEnd
  if (lineEnd < codeText.length) {
    // 行后有换行：连着换行一起删除。
    deleteTo += 1
  } else if (lineStart > 0) {
    // 最后一行且前面还有内容：删除其前面的换行符，避免代码块残留尾部空行。
    deleteFrom -= 1
  }

  const transaction = view.state.tr.delete(
    $from.start() + deleteFrom,
    $from.start() + deleteTo,
  )
  const nextPos = $from.start() + deleteFrom
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(nextPos)))
  view.dispatch(transaction)
  // 把整行内容写入系统剪贴板（不含行尾换行符）。
  void navigator.clipboard.writeText(codeText.slice(lineStart, lineEnd))
  return true
}

/** 在代码块中缩进当前行或选中的多行，操作后继续保留原来的文本选区。 */
export const handleCodeBlockTab = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false

  const { selection } = view.state
  const { $from, $to } = selection
  if ($from.parent.type.name !== 'codeBlock' || $to.parent !== $from.parent) return false

  event.preventDefault()

  if (selection.empty && !event.shiftKey) {
    view.dispatch(view.state.tr.insertText(TAB_TEXT, selection.from, selection.to))
    return true
  }

  const codeText = $from.parent.textContent
  const selectionStartOffset = $from.parentOffset
  const selectionEndOffset = $to.parentOffset
  const firstLineOffset = codeText.lastIndexOf('\n', Math.max(0, selectionStartOffset - 1)) + 1
  // 选区恰好停在下一行行首时，不处理这条未真正选中的行。
  const effectiveEndOffset = selectionEndOffset > selectionStartOffset && codeText[selectionEndOffset - 1] === '\n'
    ? selectionEndOffset - 1
    : selectionEndOffset
  const lastLineEnd = codeText.indexOf('\n', effectiveEndOffset)
  const blockEndOffset = lastLineEnd === -1 ? codeText.length : lastLineEnd
  const selectedLines = codeText.slice(firstLineOffset, blockEndOffset)

  if (!event.shiftKey) {
    const indentedText = TAB_TEXT + selectedLines.replaceAll('\n', `\n${TAB_TEXT}`)
    const lineCount = selectedLines.split('\n').length
    const transaction = view.state.tr.insertText(
      indentedText,
      $from.start() + firstLineOffset,
      $from.start() + blockEndOffset,
    )
    const nextFrom = selection.from + TAB_TEXT.length
    const nextTo = selection.empty ? nextFrom : selection.to + TAB_TEXT.length * lineCount
    transaction.setSelection(TextSelection.create(transaction.doc, nextFrom, nextTo))
    view.dispatch(transaction)
    return true
  }

  const lineTexts = selectedLines.split('\n')
  const removedLengths = lineTexts.map((line) => line.match(/^ {1,2}/)?.[0].length ?? 0)
  if (removedLengths.every((length) => length === 0)) return true

  const unindentedText = lineTexts.map((line, index) => line.slice(removedLengths[index])).join('\n')
  const transaction = view.state.tr.insertText(
    unindentedText,
    $from.start() + firstLineOffset,
    $from.start() + blockEndOffset,
  )
  const removedBeforeStart = removedLengths[0]
  const totalRemoved = removedLengths.reduce((total, length) => total + length, 0)
  const nextFrom = Math.max($from.start() + firstLineOffset, selection.from - removedBeforeStart)
  const nextTo = selection.empty ? nextFrom : Math.max(nextFrom, selection.to - totalRemoved)
  transaction.setSelection(TextSelection.create(transaction.doc, nextFrom, nextTo))
  view.dispatch(transaction)
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
