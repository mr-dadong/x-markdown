import type { Editor } from '@tiptap/core'

export type SelectionBlock = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'orderedList' | 'bulletList' | 'taskList' | 'codeBlock' | 'blockquote'

/** 类型选择是转换操作：解除原有容器后设置目标类型，避免意外嵌套列表。 */
export function applySelectionBlock(editor: Editor, block: SelectionBlock): boolean {
  const chain = editor.chain().focus().clearNodes()
  switch (block) {
    // clearNodes 已经把文本块还原为正文，无需再次设置相同节点。
    case 'paragraph': return chain.run()
    case 'heading1': return chain.setHeading({ level: 1 }).run()
    case 'heading2': return chain.setHeading({ level: 2 }).run()
    case 'heading3': return chain.setHeading({ level: 3 }).run()
    case 'orderedList': return chain.toggleOrderedList().run()
    case 'bulletList': return chain.toggleBulletList().run()
    case 'taskList': return chain.toggleTaskList().run()
    case 'codeBlock': return chain.setCodeBlock().run()
    case 'blockquote': return chain.setBlockquote().run()
  }
}
