import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'

/**
 * 光标是否位于标题块的开头：未选中任何文字、且停在该块第一个字符之前。
 * 只有这个位置才对应"标题标记"所在处，Backspace 降级、输入 # 升级都只在这里生效，
 * 避免影响标题正文中间的正常删除与输入。
 */
const isAtHeadingStart = (view: EditorView): boolean => {
  const { selection } = view.state
  const { $from } = selection
  return selection.empty && $from.parent.type.name === 'heading' && $from.parentOffset === 0
}

/**
 * Typora 风格：光标在标题开头按 Backspace 时，标题级别降一级。
 * 例如 ## 标题 → # 标题；一级标题去掉唯一的 #，转为普通段落。
 * 不再触发默认行为（把整个标题并进上一行）。
 */
export const handleHeadingBackspace = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key !== 'Backspace' || !isAtHeadingStart(view)) return false

  event.preventDefault()
  const { $from } = view.state.selection
  const heading = $from.parent
  const headingPos = $from.before($from.depth)
  const level = Number(heading.attrs.level)

  const transaction = view.state.tr
  if (level > 1) {
    // 多级标题去掉一个 #：保留原标题属性，只改级别。
    transaction.setNodeMarkup(headingPos, undefined, { ...heading.attrs, level: level - 1 })
  } else {
    // 一级标题唯一的 # 被移除后，块类型变为普通段落。
    transaction.setNodeMarkup(headingPos, view.state.schema.nodes.paragraph)
  }
  // setNodeMarkup 不改变节点位置，内容起点仍是 块位置 + 1，光标保持原位。
  transaction.setSelection(TextSelection.create(transaction.doc, headingPos + 1))
  view.dispatch(transaction)
  return true
}

/**
 * Typora 风格：光标在标题开头输入 # 时，标题级别升一级。
 * 例如 # 标题 → ## 标题；六级标题已是最高级别，吞掉按键避免正文混入多余的 #。
 */
export const handleHeadingPromote = (view: EditorView, event: KeyboardEvent): boolean => {
  if (
    event.key !== '#' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    !isAtHeadingStart(view)
  ) return false

  const { $from } = view.state.selection
  const heading = $from.parent
  const level = Number(heading.attrs.level)

  // 已到最高级别：按键被处理但不产生任何效果。
  if (level >= 6) {
    event.preventDefault()
    return true
  }

  event.preventDefault()
  const headingPos = $from.before($from.depth)
  const transaction = view.state.tr.setNodeMarkup(headingPos, undefined, {
    ...heading.attrs,
    level: level + 1,
  })
  // 升级同样不改变节点位置，光标保持原位。
  transaction.setSelection(TextSelection.create(transaction.doc, headingPos + 1))
  view.dispatch(transaction)
  return true
}
