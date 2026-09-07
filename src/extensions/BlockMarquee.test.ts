import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { Editor, Node as TiptapNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { installDomEnvironment } from '../test/domEnvironment'
import { BlockMarquee, blockMarqueeKey, selectableBlocks, selectedBlockSlice, deleteSelectedBlocks, copyBlocks } from './BlockMarquee'

// 使用真实编辑器验证节点结构和撤销，避免仅验证矩形公式。
let browser: ReturnType<typeof installDomEnvironment>
before(() => { browser = installDomEnvironment() })
after(async () => { await browser.happyDOM.abort() })
const createEditor = (): Editor => new Editor({
  extensions: [StarterKit, TaskList, TaskItem, BlockMarquee],
  content: '<p>前文</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>第一项</p></li><li data-type="taskItem" data-checked="true"><p>第二项</p></li></ul><p>后文</p>',
})

test('不透明组件的外层保留蓝色选中轮廓，取消后移除且不写入文档', () => {
  // 模拟代码块、媒体卡片的节点视图：背景位于内部，不能依赖外层底色表示选中。
  const opaqueComponent = TiptapNode.create({
    name: 'opaqueComponent',
    group: 'block',
    atom: true,
    parseHTML: () => [{ tag: 'section[data-component]' }],
    renderHTML: () => ['section', { 'data-component': '' }],
    addNodeView() {
      return () => {
        const dom = document.createElement('div')
        const content = document.createElement('div')
        content.style.backgroundColor = '#242529'
        content.textContent = '具有不透明背景的组件'
        dom.append(content)
        return { dom }
      }
    },
  })
  const editor = new Editor({
    extensions: [StarterKit, opaqueComponent, BlockMarquee],
    content: '<pre><code>const value = 1</code></pre><section data-component></section><p>正文</p>',
  })
  // 模拟挂载及布局，验证组件表面确实生成覆盖层，而不只是添加背景类名。
  const scroller = document.createElement('div')
  scroller.className = 'editor-scroll'
  document.body.append(scroller)
  scroller.append(editor.view.dom)
  const rect = (top: number, height: number): DOMRect =>
    ({ left: 0, right: 600, top, bottom: top + height, width: 600, height, x: 0, y: top, toJSON() {} })
  scroller.getBoundingClientRect = () => rect(0, 400)
  Object.defineProperty(scroller, 'clientWidth', { value: 600 })
  Object.defineProperty(scroller, 'clientHeight', { value: 400 })
  let scrollOffset = 0
  selectableBlocks(editor.state.doc).forEach((range, index) => {
    const dom = editor.view.nodeDOM(range.from) as HTMLElement
    dom.getBoundingClientRect = () => rect(index * 100 - scrollOffset, 80)
  })
  try {
    const original = editor.state.doc.toJSON()
    const ranges = selectableBlocks(editor.state.doc).slice(0, 2)
    editor.view.dispatch(editor.state.tr.setMeta(blockMarqueeKey, ranges))
    const surfaces = document.querySelector<HTMLElement>('[data-block-selection-surfaces]')!
    assert.equal(surfaces.childElementCount, 2)
    assert.equal((surfaces.firstElementChild as HTMLElement).style.height, '80px')
    assert.ok(surfaces.classList.contains('pointer-events-none'))
    scrollOffset = 20
    scroller.dispatchEvent(new browser.Event('scroll') as unknown as Event)
    assert.equal((surfaces.firstElementChild as HTMLElement).style.top, '-20px')
    for (const range of ranges) {
      const dom = editor.view.nodeDOM(range.from) as HTMLElement
      assert.ok(dom.classList.contains('outline'))
      assert.ok(dom.classList.contains('outline-1'))
      assert.ok(dom.classList.contains('outline-offset-0'))
    }
    assert.deepEqual(editor.state.doc.toJSON(), original)
    editor.view.dispatch(editor.state.tr.setMeta(blockMarqueeKey, []))
    assert.equal(surfaces.childElementCount, 0)
    for (const range of ranges) {
      const dom = editor.view.nodeDOM(range.from) as HTMLElement
      assert.equal(dom.classList.contains('outline'), false)
    }
  } finally { editor.destroy(); scroller.remove() }
  assert.equal(document.querySelector('[data-block-selection-surfaces]'), null)
})

test('任务项独立选中，复制保留同一个列表和完成状态', () => {
  const editor = createEditor()
  try {
    const ranges = selectableBlocks(editor.state.doc)
    assert.equal(ranges.length, 4)
    const slice = selectedBlockSlice(editor.state.doc, ranges.slice(1, 3))
    assert.equal(slice.content.childCount, 1)
    assert.equal(slice.content.firstChild?.type.name, 'taskList')
    assert.equal(slice.content.firstChild?.childCount, 2)
    assert.equal(slice.content.firstChild?.lastChild?.attrs.checked, true)
  } finally { editor.destroy() }
})

test('删除一个任务项保留另一项，删除全部任务项不留下空列表，支持撤销', () => {
  const editor = createEditor()
  try {
    const original = editor.state.doc.toJSON()
    const ranges = selectableBlocks(editor.state.doc)
    editor.view.dispatch(editor.state.tr.setMeta(blockMarqueeKey, [ranges[1]]))
    deleteSelectedBlocks(editor.view)
    assert.equal(editor.state.doc.child(1).childCount, 1)
    assert.equal(editor.state.doc.child(1).textContent, '第二项')
    editor.commands.undo()
    assert.deepEqual(editor.state.doc.toJSON(), original)
    editor.view.dispatch(editor.state.tr.setMeta(blockMarqueeKey, ranges.slice(1, 3)))
    deleteSelectedBlocks(editor.view)
    assert.equal(editor.state.doc.childCount, 2)
    assert.equal(editor.state.doc.textContent, '前文后文')
  } finally { editor.destroy() }
})

test('内容插入映射块位置，剪切只删除选中块并写入 HTML', () => {
  const editor = createEditor()
  try {
    const range = selectableBlocks(editor.state.doc)[2]
    editor.view.dispatch(editor.state.tr.setMeta(blockMarqueeKey, [range]))
    editor.view.dispatch(editor.state.tr.insertText('增加', 1))
    assert.equal(blockMarqueeKey.getState(editor.state)?.[0].from, range.from + 2)
    const data = new Map<string, string>()
    const event = { clipboardData: { setData: (type: string, value: string) => data.set(type, value) }, preventDefault() {} } as unknown as ClipboardEvent
    assert.equal(copyBlocks(editor.view, event, true), true)
    assert.match(data.get('text/html')!, /第二项/)
    assert.doesNotMatch(data.get('text/html')!, /第一项/)
    assert.equal(editor.state.doc.textContent, '增加前文第一项后文')
  } finally { editor.destroy() }
})

test('挂载后左右留白均能框选，正文点击清除，取消移除矩形', () => {
  const editor = createEditor()
  const scroller = document.createElement('div')
  scroller.className = 'editor-scroll'
  document.body.append(scroller)
  scroller.append(editor.view.dom)
  // happy-dom 不执行布局，为实际节点提供固定视口矩形和指针捕获。
  const rect = (left: number, top: number, width: number, height: number): DOMRect =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} })
  scroller.getBoundingClientRect = () => rect(0, 0, 600, 400)
  Object.defineProperty(scroller, 'clientWidth', { value: 600 })
  editor.view.dom.getBoundingClientRect = () => rect(0, 0, 600, 400)
  Object.defineProperty(editor.view.dom, 'offsetWidth', { value: 600 })
  editor.view.dom.style.padding = '0 80px'
  let captured = false
  scroller.setPointerCapture = () => { captured = true }
  scroller.hasPointerCapture = () => captured
  scroller.releasePointerCapture = () => { captured = false }
  selectableBlocks(editor.state.doc).forEach((range, index) => {
    const dom = editor.view.nodeDOM(range.from) as HTMLElement
    dom.getBoundingClientRect = () => rect(80, 20 + index * 60, 440, 40)
  })
  const pointer = (type: string, x: number, y: number, target: HTMLElement = scroller): void => {
    target.dispatchEvent(new browser.PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y }) as unknown as Event)
  }
  try {
    for (const startX of [20, 580]) {
      pointer('pointerdown', startX, 75)
      pointer('pointermove', 300, 180)
      pointer('pointerup', 300, 180)
      assert.equal(blockMarqueeKey.getState(editor.state)?.length, 2)
      pointer('pointerdown', 100, 30, editor.view.dom.firstElementChild as HTMLElement)
      assert.equal(blockMarqueeKey.getState(editor.state)?.length, 0)
    }
    pointer('pointerdown', 20, 75)
    pointer('pointermove', 300, 180)
    pointer('pointercancel', 300, 180)
    assert.equal(blockMarqueeKey.getState(editor.state)?.length, 0)
    assert.equal(captured, false)
  } finally { editor.destroy(); scroller.remove() }
})
