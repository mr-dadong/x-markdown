import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { installDomEnvironment } from '../test/domEnvironment'
import { applySelectionBlock, type SelectionBlock } from './selectionToolbar'
import type { Editor } from '@tiptap/core'
import type { Window } from 'happy-dom'

let browserWindow: Window
let EditorConstructor: typeof import('@tiptap/core').Editor
let createEditorExtensions: typeof import('../editor/editorExtensions').createEditorExtensions
before(async () => {
  browserWindow = installDomEnvironment()
  ;({ Editor: EditorConstructor } = await import('@tiptap/core'))
  ;({ createEditorExtensions } = await import('../editor/editorExtensions'))
})
after(async () => { await browserWindow.happyDOM.abort() })
// 使用项目真实扩展，验证菜单操作与编辑器文档结构兼容。
function createEditor(): Editor {
  const editor = new EditorConstructor({ extensions: createEditorExtensions(), content: '测试文字\n\n保留段落' })
  editor.commands.setTextSelection({ from: 1, to: 5 })
  return editor
}
const targets: SelectionBlock[] = ['paragraph', 'heading1', 'heading2', 'heading3', 'orderedList', 'bulletList', 'taskList', 'codeBlock', 'blockquote']
for (const source of targets) {
  for (const target of targets) {
    test(`${source} 转换为 ${target} 保留文字和后续段落`, () => {
      const editor = createEditor()
      try {
        assert.equal(applySelectionBlock(editor, source), true)
        assert.equal(applySelectionBlock(editor, target), true)
        const type = target.startsWith('heading') ? 'heading' : target
        assert.equal(editor.state.doc.firstChild?.type.name, type)
        if (type === 'heading') assert.equal(editor.state.doc.firstChild?.attrs.level, Number(target.slice(-1)))
        assert.equal(editor.state.doc.firstChild?.textContent, '测试文字')
        assert.equal(editor.state.doc.lastChild?.type.name, 'paragraph')
        assert.equal(editor.state.doc.lastChild?.textContent, '保留段落')
      } finally { editor.destroy() }
    })
  }
}
test('格式可叠加、取消，链接和高亮可序列化并撤销', () => {
  const editor = createEditor()
  try {
    for (const mark of ['bold', 'strike', 'italic', 'underline', 'highlight']) {
      assert.equal(editor.commands.toggleMark(mark), true)
      assert.equal(editor.isActive(mark), true)
    }
    assert.equal(editor.commands.setLink({ href: 'https://example.com' }), true)
    assert.match(editor.storage.markdown.getMarkdown(), /https:\/\/example.com/)
    assert.match(editor.storage.markdown.getMarkdown(), /==/)
    editor.commands.unsetLink()
    assert.equal(editor.isActive('link'), false)
    for (const mark of ['bold', 'strike', 'italic', 'underline', 'highlight']) {
      editor.commands.toggleMark(mark)
      assert.equal(editor.isActive(mark), false)
    }
    editor.commands.toggleCode()
    assert.equal(editor.isActive('code'), true)
    editor.commands.undo()
    assert.equal(editor.state.doc.textContent, '测试文字保留段落')
  } finally { editor.destroy() }
})

