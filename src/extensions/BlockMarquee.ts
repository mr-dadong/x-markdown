import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as DocumentNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// 范围始终落在完整节点的前后，列表按任务项或列表项选择。
export interface BlockRange { from: number; to: number }
export const blockMarqueeKey = new PluginKey<BlockRange[]>('blockMarquee')
const isList = (node: DocumentNode): boolean =>
  ['bulletList', 'orderedList', 'taskList'].includes(node.type.name)

// 普通文字块直接使用底色，带内部背景的组件另外绘制表面选中层。
const isTextBlock = (node: DocumentNode): boolean =>
  ['paragraph', 'heading', 'listItem', 'taskItem'].includes(node.type.name)

// 列表拆成独立条目；其他顶层块保持完整，避免同时选中父子节点。
export const selectableBlocks = (doc: DocumentNode): BlockRange[] => {
  const ranges: BlockRange[] = []
  doc.forEach((node, position) => {
    if (isList(node)) {
      node.forEach((item, offset) => {
        const from = position + 1 + offset
        ranges.push({ from, to: from + item.nodeSize })
      })
    } else ranges.push({ from: position, to: position + node.nodeSize })
  })
  return ranges
}

// 复制时保留列表容器及其属性，连续条目合并到同一个列表中。
export const selectedBlockSlice = (doc: DocumentNode, ranges: BlockRange[]): Slice => {
  const nodes: DocumentNode[] = []
  let previousParent = -1
  for (const range of ranges) {
    const node = doc.nodeAt(range.from)
    if (!node) continue
    const position = doc.resolve(range.from)
    if (isList(position.parent)) {
      const parentPosition = position.before()
      if (previousParent === parentPosition) {
        const previous = nodes[nodes.length - 1]
        nodes[nodes.length - 1] = previous.copy(previous.content.append(Fragment.from(node)))
      } else nodes.push(position.parent.copy(Fragment.from(node)))
      previousParent = parentPosition
    } else {
      nodes.push(node)
      previousParent = -1
    }
  }
  return new Slice(Fragment.fromArray(nodes), 0, 0)
}

// 从后往前删除，前面节点的位置不会因后面的删除发生变化。
export const deleteSelectedBlocks = (view: EditorView): void => {
  const ranges = blockMarqueeKey.getState(view.state)
  if (!ranges?.length) return
  const transaction = view.state.tr
  for (const range of [...ranges].reverse()) transaction.deleteRange(range.from, range.to)
  view.dispatch(transaction.setMeta(blockMarqueeKey, []).setMeta('uiEvent', 'cut').scrollIntoView())
}

// 主编辑器的快捷键优先于扩展，复用同一入口以免旧光标触发标题降级等操作。
export const handleBlockMarqueeKey = (view: EditorView, event: KeyboardEvent): boolean => {
  if (!blockMarqueeKey.getState(view.state)?.length || event.isComposing) return false
  if (event.key === 'Backspace' || event.key === 'Delete') {
    if (!view.editable) return false
    deleteSelectedBlocks(view)
    return true
  }
  if (event.key === 'Escape') {
    view.dispatch(view.state.tr.setMeta(blockMarqueeKey, []))
    return true
  }
  // 复制和剪切保留块选区，其余快捷键交回正常编辑状态。
  if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase())) return false
  if (!['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) view.dispatch(view.state.tr.setMeta(blockMarqueeKey, []))
  return false
}

export const BlockMarquee = Extension.create({
  name: 'blockMarquee',
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin<BlockRange[]>({
      key: blockMarqueeKey,
      state: {
        init: () => [],
        apply(transaction, ranges) {
          const next = transaction.getMeta(blockMarqueeKey) as BlockRange[] | undefined
          if (next) return next
          // 正常文字选择或切换文档时退出块选区。
          if (transaction.selectionSet || transaction.getMeta('preventUpdate')) return []
          if (!transaction.docChanged) return ranges
          return ranges.flatMap(range => {
            const from = transaction.mapping.mapResult(range.from, 1)
            const to = transaction.mapping.mapResult(range.to, -1)
            const node = transaction.doc.nodeAt(from.pos)
            return !from.deleted && !to.deleted && node && from.pos + node.nodeSize === to.pos
              ? [{ from: from.pos, to: to.pos }] : []
          })
        },
      },
      props: {
        decorations(state) {
          return DecorationSet.create(state.doc, (blockMarqueeKey.getState(state) ?? []).map(range => {
            // 正文使用轻浅的系统蓝底色，避免每行都像获得焦点的输入框。
            const node = state.doc.nodeAt(range.from)
            const textBlock = node && isTextBlock(node)
            // 不透明组件保留贴边的细轮廓；取消外扩间距，消除代码卡片周围的白缝。
            const className = textBlock
              ? '!bg-[#007aff]/[0.12] dark:!bg-[#0a84ff]/[0.22] rounded-[4px]'
              : '!bg-[#007aff]/[0.08] dark:!bg-[#0a84ff]/[0.16] rounded-md outline outline-1 outline-[#007aff]/70 dark:outline-[#0a84ff]/80 outline-offset-0'
            return Decoration.node(range.from, range.to, { class: className })
          }))
        },
        handleKeyDown: handleBlockMarqueeKey,
        handleDOMEvents: {
          copy: (view, event) => copyBlocks(view, event, false),
          cut: (view, event) => copyBlocks(view, event, true),
        },
      },
      view(view) {
        // 监听滚动容器，正文最大宽度以外的左右留白也能发起框选。
        let scroller: HTMLElement | null = null
        const owner = view.dom.ownerDocument
        const overlay = owner.createElement('div')
        // 半透明蓝色不会盖住正文，也不受主题中不透明选中底色的影响。
        overlay.className = 'pointer-events-none fixed z-50 hidden rounded-[3px] border border-[#007aff]/60 bg-[#007aff]/[0.08] dark:border-[#0a84ff]/70 dark:bg-[#0a84ff]/[0.12]'
        owner.body.append(overlay)
        // 选中层位于组件表面，代码区、图片和 iframe 的背景无法遮住它。
        // 层本身不接收鼠标事件，并裁剪在编辑器视口内，避免覆盖工具栏和侧栏。
        const surfaces = owner.createElement('div')
        surfaces.dataset.blockSelectionSurfaces = ''
        surfaces.className = 'pointer-events-none fixed z-10 flex overflow-hidden'
        owner.body.append(surfaces)
        const paintSurfaces = (): void => {
          surfaces.replaceChildren()
          const container = view.dom.closest<HTMLElement>('.editor-scroll')
          const ranges = blockMarqueeKey.getState(view.state) ?? []
          if (!container || ranges.length === 0) return
          const viewport = container.getBoundingClientRect()
          Object.assign(surfaces.style, {
            left: `${viewport.left}px`, top: `${viewport.top}px`,
            width: `${container.clientWidth}px`, height: `${container.clientHeight}px`,
          })
          for (const range of ranges) {
            const node = view.state.doc.nodeAt(range.from)
            const dom = view.nodeDOM(range.from)
            if (!node || isTextBlock(node) || !(dom instanceof HTMLElement)) continue
            const rect = dom.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0 || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue
            const surface = owner.createElement('div')
            surface.className = 'pointer-events-none absolute flex rounded-md bg-[#007aff]/[0.20] dark:bg-[#0a84ff]/[0.24]'
            Object.assign(surface.style, {
              left: `${rect.left - viewport.left}px`, top: `${rect.top - viewport.top}px`,
              width: `${rect.width}px`, height: `${rect.height}px`,
            })
            surfaces.append(surface)
          }
        }
        // 图片加载、窗口缩放以及正文重排后，重新对齐表面选中层。
        const resizeObserver = new owner.defaultView!.ResizeObserver(paintSurfaces)
        resizeObserver.observe(view.dom)
        owner.addEventListener('scroll', paintSurfaces, true)
        owner.defaultView?.addEventListener('resize', paintSurfaces)
        let drag: { id: number; x: number; y: number; scroll: number; currentX: number; currentY: number; active: boolean } | null = null
        let frame = 0
        let suppressClick = false

        const clear = (): void => {
          if (blockMarqueeKey.getState(view.state)?.length) view.dispatch(view.state.tr.setMeta(blockMarqueeKey, []))
        }
        const finish = (): void => {
          cancelAnimationFrame(frame)
          overlay.style.display = 'none'
          scroller?.classList.remove('select-none')
          const pointerId = drag?.id
          drag = null
          if (pointerId !== undefined && scroller?.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId)
        }
        const draw = (): void => {
          if (!drag?.active || !scroller) return
          const viewport = scroller.getBoundingClientRect()
          const startY = drag.y - (scroller.scrollTop - drag.scroll)
          const left = Math.min(drag.x, drag.currentX)
          const right = Math.max(drag.x, drag.currentX)
          const top = Math.min(startY, drag.currentY)
          const bottom = Math.max(startY, drag.currentY)
          Object.assign(overlay.style, {
            display: 'flex', left: `${Math.max(left, viewport.left)}px`, top: `${Math.max(top, viewport.top)}px`,
            width: `${Math.max(0, Math.min(right, viewport.right) - Math.max(left, viewport.left))}px`,
            height: `${Math.max(0, Math.min(bottom, viewport.bottom) - Math.max(top, viewport.top))}px`,
          })
          const ranges = selectableBlocks(view.state.doc).filter(range => {
            const dom = view.nodeDOM(range.from)
            if (!(dom instanceof HTMLElement)) return false
            const rect = dom.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top
          })
          const previous = blockMarqueeKey.getState(view.state) ?? []
          if (JSON.stringify(previous) !== JSON.stringify(ranges)) view.dispatch(view.state.tr.setMeta(blockMarqueeKey, ranges))
        }
        const tick = (): void => {
          if (!drag?.active || !scroller) return
          const rect = scroller.getBoundingClientRect()
          // 指针靠近上下边缘时滚动，静止指针也能继续扩展选区。
          if (drag.currentY < rect.top + 32) scroller.scrollTop -= 12
          else if (drag.currentY > rect.bottom - 32) scroller.scrollTop += 12
          draw()
          frame = requestAnimationFrame(tick)
        }
        const down = (event: PointerEvent): void => {
          suppressClick = false
          // Vue 会在插件创建后挂载编辑器 DOM，因此在按下时获取当前容器。
          scroller = view.dom.closest<HTMLElement>('.editor-scroll')
          if (!scroller || !(event.target instanceof HTMLElement) || !scroller.contains(event.target)) return
          if (event.button !== 0 || !event.isPrimary || !view.editable) return
          clear()
          if (event.target !== scroller && event.target !== view.dom) return
          const viewport = scroller.getBoundingClientRect()
          if (event.clientX >= viewport.left + scroller.clientWidth) return
          const rootRect = view.dom.getBoundingClientRect()
          const style = getComputedStyle(view.dom)
          const scale = rootRect.width / view.dom.offsetWidth
          const left = rootRect.left + parseFloat(style.paddingLeft) * scale
          const right = rootRect.right - parseFloat(style.paddingRight) * scale
          if (event.clientX >= left && event.clientX <= right) return
          event.preventDefault()
          event.stopPropagation()
          view.focus()
          drag = { id: event.pointerId, x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY, scroll: scroller.scrollTop, active: false }
          scroller.setPointerCapture(event.pointerId)
        }
        const move = (event: PointerEvent): void => {
          if (!drag || !scroller || drag.id !== event.pointerId) return
          drag.currentX = event.clientX
          drag.currentY = event.clientY
          if (!drag.active && Math.hypot(drag.x - event.clientX, drag.y - event.clientY) >= 4) {
            drag.active = true
            suppressClick = true
            scroller.classList.add('select-none')
            owner.getSelection()?.removeAllRanges()
            tick()
          }
          if (drag.active) event.preventDefault()
        }
        const up = (): void => { draw(); finish() }
        const cancel = (): void => { finish(); clear() }
        const click = (event: MouseEvent): void => {
          if (!suppressClick) return
          suppressClick = false
          event.preventDefault()
          event.stopPropagation()
        }
        const key = (event: KeyboardEvent): void => {
          if (event.key === 'Escape' && drag) { cancel(); event.preventDefault() }
        }
        owner.addEventListener('pointerdown', down, true)
        owner.addEventListener('pointermove', move)
        owner.addEventListener('pointerup', up)
        owner.addEventListener('pointercancel', cancel)
        owner.addEventListener('lostpointercapture', up)
        owner.addEventListener('click', click, true)
        owner.addEventListener('keydown', key, true)
        owner.defaultView?.addEventListener('blur', cancel)
        return {
          update: paintSurfaces,
          destroy() {
            finish()
            overlay.remove()
            surfaces.remove()
            resizeObserver.disconnect()
            owner.removeEventListener('scroll', paintSurfaces, true)
            owner.defaultView?.removeEventListener('resize', paintSurfaces)
            owner.removeEventListener('pointerdown', down, true)
            owner.removeEventListener('pointermove', move)
            owner.removeEventListener('pointerup', up)
            owner.removeEventListener('pointercancel', cancel)
            owner.removeEventListener('lostpointercapture', up)
            owner.removeEventListener('click', click, true)
            owner.removeEventListener('keydown', key, true)
            owner.defaultView?.removeEventListener('blur', cancel)
          },
        }
      },
    })]
  },
})

// 使用编辑器自身的剪贴板序列化，富文本粘贴保留列表、图片和代码块结构。
export const copyBlocks = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
  const ranges = blockMarqueeKey.getState(view.state)
  if (!ranges?.length || !event.clipboardData || (cut && !view.editable)) return false
  const { dom, text } = view.serializeForClipboard(selectedBlockSlice(view.state.doc, ranges))
  event.clipboardData.setData('text/html', dom.innerHTML)
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
  if (cut) deleteSelectedBlocks(view)
  return true
}
