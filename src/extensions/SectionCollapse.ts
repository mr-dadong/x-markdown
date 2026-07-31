import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface SectionCollapseMeta {
  type: 'toggle'
  position: number
}

interface SectionCollapseState {
  collapsedPositions: Set<number>
  decorations: DecorationSet
}

export const sectionCollapseKey = new PluginKey<SectionCollapseState>('sectionCollapse')

// 标题的章节范围截止到下一个同级或更高级标题，折叠只影响显示，不修改 Markdown 内容。
const findSectionEnd = (document: ProseMirrorNode, headingPosition: number): number => {
  const heading = document.nodeAt(headingPosition)
  if (!heading || heading.type.name !== 'heading') return headingPosition

  const headingLevel = Number(heading.attrs.level)
  let sectionEnd = document.content.size
  let foundBoundary = false

  document.forEach((node, position) => {
    if (
      !foundBoundary &&
      position > headingPosition &&
      node.type.name === 'heading' &&
      Number(node.attrs.level) <= headingLevel
    ) {
      sectionEnd = position
      foundBoundary = true
    }
  })

  return sectionEnd
}

const createDecorations = (document: ProseMirrorNode, collapsedPositions: Set<number>): DecorationSet => {
  const decorations: Decoration[] = []

  collapsedPositions.forEach((headingPosition) => {
    const heading = document.nodeAt(headingPosition)
    if (!heading || heading.type.name !== 'heading') return

    decorations.push(
      Decoration.node(headingPosition, headingPosition + heading.nodeSize, {
        class: 'is-heading-collapsed',
      }),
    )

    const sectionEnd = findSectionEnd(document, headingPosition)
    document.forEach((node, position) => {
      if (position <= headingPosition || position >= sectionEnd) return

      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: 'is-section-hidden',
        }),
      )
    })
  })

  return DecorationSet.create(document, decorations)
}

const mapCollapsedPositions = (transaction: Transaction, positions: Set<number>): Set<number> => {
  const mappedPositions = new Set<number>()

  positions.forEach((position) => {
    const mapped = transaction.mapping.mapResult(position)
    if (mapped.deleted) return

    const node = transaction.doc.nodeAt(mapped.pos)
    if (node?.type.name === 'heading') mappedPositions.add(mapped.pos)
  })

  return mappedPositions
}

export const SectionCollapse = Extension.create({
  name: 'sectionCollapse',

  addProseMirrorPlugins() {
    return [
      new Plugin<SectionCollapseState>({
        key: sectionCollapseKey,
        state: {
          init: (_, state) => ({
            collapsedPositions: new Set<number>(),
            decorations: DecorationSet.empty,
          }),
          apply: (transaction, pluginState) => {
            const collapsedPositions = transaction.docChanged
              ? mapCollapsedPositions(transaction, pluginState.collapsedPositions)
              : new Set(pluginState.collapsedPositions)
            const meta = transaction.getMeta(sectionCollapseKey) as SectionCollapseMeta | undefined

            if (meta?.type === 'toggle') {
              if (collapsedPositions.has(meta.position)) {
                collapsedPositions.delete(meta.position)
              } else if (transaction.doc.nodeAt(meta.position)?.type.name === 'heading') {
                collapsedPositions.add(meta.position)
              }
            }

            return {
              collapsedPositions,
              decorations: createDecorations(transaction.doc, collapsedPositions),
            }
          },
        },
        props: {
          decorations: (state) => sectionCollapseKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },
})
