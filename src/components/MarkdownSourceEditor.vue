<template>
  <div ref="hostRef" class="editor-scroll min-h-0 min-w-0 flex-1 overflow-hidden bg-paper" :style="sourceStyle" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, Language, LanguageDescription, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { tags } from '@lezer/highlight'
import { useSettings, type EditorLineWidth } from '../composables/useSettings'
import type { SourceEditorHandle } from '../types/editor'

const props = defineProps<{
  content: string
  isDarkTheme: boolean
}>()

const emit = defineEmits<{
  'update:content': [content: string]
}>()

const { settings } = useSettings()

// 行宽以正文列宽为准，通过水平内边距把源码列居中；窗口较窄时至少保留 80px 边距。
const SOURCE_LINE_WIDTHS: Record<EditorLineWidth, number | null> = {
  narrow: 640,
  medium: 800,
  wide: 960,
  full: null,
}

const hostRef = ref<HTMLElement | null>(null)
// EditorView 是不可深度代理的编辑器实例，shallowRef 保持原始对象引用。
const view = shallowRef<EditorView | null>(null)

// 行号栏宽度会随行数位数增长（99→100→10000），实时测量后从居中公式里扣除，
// 保证正文列在任意行数下都保持水平居中。
const gutterWidth = ref(0)
let gutterObserver: ResizeObserver | null = null

// 高亮颜色全部走 CSS 变量，白天/夜晚主题切换时自动跟随，无需重建编辑器。
const sourceHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--color-link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--color-link)' },
  { tag: tags.monospace, color: 'var(--color-code-text)' },
  { tag: tags.quote, color: 'var(--color-muted)', fontStyle: 'italic' },
  { tag: [tags.contentSeparator, tags.list, tags.meta], color: 'var(--color-muted)' },
  { tag: tags.comment, color: 'var(--color-muted)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--color-danger)' },
])

// 查找替换装饰系统：通过 StateEffect 传入匹配列表，StateField 生成行内高亮装饰。
const sourceSearchUpdate = StateEffect.define<{ from: number; to: number; isCurrent: boolean }[]>()

const sourceSearchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, tr) => {
    // 文档编辑时让已有装饰跟随变更平移
    decorations = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(sourceSearchUpdate)) {
        const ranges: Range<Decoration>[] = effect.value
          .filter((match) => match.from < tr.newDoc.length && match.to <= tr.newDoc.length)
          .map((match) => Decoration.mark({
            class: match.isCurrent ? 'cm-source-search-current' : 'cm-source-search-match',
          }).range(match.from, match.to))
        decorations = Decoration.set(ranges, true)
      }
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

// 外部调用接口：把查找面板的匹配结果同步为 CodeMirror 行内装饰。
const updateSearch = (
  view: EditorView,
  matches: { from: number; to: number }[],
  currentIndex: number,
): void => {
  view.dispatch({
    effects: sourceSearchUpdate.of(
      matches.map((match, index) => ({ ...match, isCurrent: index === currentIndex })),
    ),
  })
}

// 清空源码模式的查找装饰，面板关闭时调用。
const clearSearch = (view: EditorView): void => {
  view.dispatch({ effects: sourceSearchUpdate.of([]) })
}

const sourceTheme = (dark: boolean): Extension => EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-paper)',
    color: 'var(--color-ink)',
    fontSize: '14px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Menlo', monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    lineHeight: '24px',
  },
  '.cm-content': {
    paddingTop: '16px',
    paddingBottom: '200px',
    paddingLeft: 'var(--source-h-padding)',
    paddingRight: 'var(--source-h-padding)',
    caretColor: 'var(--color-ink)',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  /* 行号栏：无背景块，只用细分隔线与内容区分，当前行行号用深色加粗标识。 */
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--color-line)',
    color: 'var(--color-muted)',
    lineHeight: '24px',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Menlo', monospace",
    fontSize: '13px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px',
    minWidth: '28px',
    /* CodeMirror 默认行号右对齐，这里改为在行号栏内水平居中。 */
    textAlign: 'center',
  },
  /* 活动行：只标记行号（深色加粗），不给正文加背景，避免与选区颜色冲突。 */
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-ink)',
    fontWeight: '600',
  },
  /* 选区使用独立的蓝灰色，与活动行、页面背景都能明显区分，选中文字不会“消失”。 */
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(101, 118, 155, 0.28)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-ink)',
  },
  '.cm-placeholder': {
    color: 'var(--color-placeholder)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--color-control-active)',
    outline: '1px solid var(--color-muted)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--color-mark-bg)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--color-control-active)',
  },
  /* 查找面板高亮：普通匹配与当前匹配使用不同强度，便于快速定位。 */
  '.cm-source-search-match': {
    backgroundColor: 'rgba(255, 205, 40, 0.35)',
  },
  '.cm-source-search-current': {
    backgroundColor: 'rgba(255, 130, 40, 0.55)',
    outline: '1.5px solid rgba(255, 130, 40, 0.85)',
    outlineOffset: '-1px',
    borderRadius: '2px',
  },
  /* 选中文字匹配高亮：当选中某个词时，文档中其他相同词显示此背景。 */
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(255, 205, 40, 0.35)',
  },
}, { dark })

// 围栏代码块根据标注语言选择已有的语法解析器，覆盖常见别名写法。
const codeLanguages = (info: string): Language | LanguageDescription | null => {
  const name = info.trim().toLowerCase()
  if (['html', 'htm', 'xhtml', 'vue', 'xml'].includes(name)) return html().language
  if (['css', 'scss', 'less'].includes(name)) return css().language
  if (['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx', 'json'].includes(name)) return javascript().language
  return null
}

const buildExtensions = (dark: boolean): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(sourceHighlightStyle),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  sourceSearchField,
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ spellcheck: 'false' }),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
  markdown({ codeLanguages }),
  placeholder('开始输入 Markdown 源码...'),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      emit('update:content', update.state.doc.toString())
    }
  }),
  sourceTheme(dark),
]

onMounted(() => {
  const parent = hostRef.value
  if (!parent) return
  view.value = new EditorView({
    state: EditorState.create({
      doc: props.content,
      extensions: buildExtensions(props.isDarkTheme),
    }),
    parent,
  })
  // 监听行号栏宽度变化（行数位数增加时会变宽），同步给居中公式。
  const gutterElement = view.value.dom.querySelector<HTMLElement>('.cm-gutters')
  if (gutterElement) {
    gutterWidth.value = gutterElement.getBoundingClientRect().width
    gutterObserver = new ResizeObserver(() => {
      gutterWidth.value = gutterElement.getBoundingClientRect().width
    })
    gutterObserver.observe(gutterElement)
  }
})

onBeforeUnmount(() => {
  gutterObserver?.disconnect()
  gutterObserver = null
  view.value?.destroy()
  view.value = null
})

// 主题切换只重建主题扩展，文档内容、选区与滚动位置全部保留。
watch(
  () => props.isDarkTheme,
  (dark) => {
    view.value?.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions(dark)) })
  },
)

// 外部内容变化（切换文档、撤销恢复等）时同步到编辑器；自身输入产生的变化直接跳过。
watch(
  () => props.content,
  (newContent) => {
    const editor = view.value
    if (!editor || editor.state.doc.toString() === newContent) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: newContent } })
  },
)

// 视图切换定位：源码视图以视口顶部行号为锚点。
// 返回 0 起始行号，与 markdown-it token.map 的行号体系一致；文档为空时返回空。
const getViewportSourceLine = (): number | null => {
  const sourceView = view.value
  if (!sourceView || sourceView.state.doc.length === 0) return null
  // viewport 是“可见区 + 上下各约 1000px 预渲染边距”的绘制范围；无折叠装饰时
  // visibleRanges 与 viewport 相同，也都包含边距，不能直接当视口顶部用。
  // 这里改用几何换算：滚动容器可见顶部相对文档顶部的距离，交给 lineBlockAtHeight
  // 换算成真实可见首行；滚到底部留白时该方法会钳制到最后一行。
  const visibleTop = sourceView.scrollDOM.getBoundingClientRect().top + 1 - sourceView.documentTop
  const topBlock = sourceView.lineBlockAtHeight(Math.max(0, visibleTop))
  // CodeMirror 行号 1 起始，减 1 换算为 0 起始。
  return sourceView.state.doc.lineAt(topBlock.from).number - 1
}

// 把指定行（0 起始，允许小数，向下取整）滚动到视口顶部，不改动光标与选区。
// 用 scrollIntoView 效果而非直接写 scrollTop：编辑器刚从隐藏切回显示时，
// 直接写 scrollTop 可能落在过期的高度估算上，交给 CodeMirror 测量更可靠。
const scrollToSourceLine = (line: number): void => {
  const sourceView = view.value
  if (!sourceView) return
  const document = sourceView.state.doc
  const lineNumber = Math.max(1, Math.min(Math.floor(line) + 1, document.lines))
  const targetLine = document.line(lineNumber)
  sourceView.dispatch({
    effects: EditorView.scrollIntoView(targetLine.from, { y: 'start' }),
  })
}

const getView = (): EditorView | null => view.value

const getSelectionText = (): string => {
  const sourceView = view.value
  if (!sourceView) return ''
  const { from, to } = sourceView.state.selection.main
  return sourceView.state.sliceDoc(from, to)
}

const replaceSelection = (text: string): void => {
  const sourceView = view.value
  if (!sourceView) return
  const { from, to } = sourceView.state.selection.main
  sourceView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  })
  sourceView.focus()
}

const insertAtCursor = (text: string): void => {
  const sourceView = view.value
  if (!sourceView) return
  const { from } = sourceView.state.selection.main
  sourceView.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  })
  sourceView.focus()
}

// CodeMirror 的光标 head 就是源码中的字符偏移，与 documentText 坐标系一致。
const getCursorOffset = (): number | null => {
  const sourceView = view.value
  if (!sourceView) return null
  return sourceView.state.selection.main.head
}

defineExpose<SourceEditorHandle>({
  getViewportSourceLine,
  scrollToSourceLine,
  getView,
  updateSearch: (matches: { from: number; to: number }[], currentIndex: number) => {
    if (view.value) updateSearch(view.value, matches, currentIndex)
  },
  clearSearch: () => {
    if (view.value) clearSearch(view.value)
  },
  getSelectionText,
  replaceSelection,
  insertAtCursor,
  getCursorOffset,
})

const sourceStyle = computed<Record<string, string>>(() => {
  const width = SOURCE_LINE_WIDTHS[settings.lineWidth]
  /*
   * 居中公式必须扣除行号栏宽度：padding 的 100% 是滚动区总宽，
   * 而正文列可用宽 = 总宽 − 行号栏。不扣除的话行数位数增多时正文会偏离中心。
   * CodeMirror 虚拟化渲染可见行，行号栏随位数自动加宽，几万行也能正常显示。
   */
  const horizontalPadding = width === null
    ? '48px'
    : `max(48px, calc((100% - ${gutterWidth.value}px - ${width}px) / 2))`
  return { '--source-h-padding': horizontalPadding }
})
</script>
