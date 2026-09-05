<template>
  <div class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#3d3f45] bg-[#1e1f22]">
    <div class="flex h-9 shrink-0 items-center justify-between border-b border-[#3d3f45] bg-[#292a2e] px-3">
      <span class="flex items-center gap-3">
        <span class="flex items-center gap-1.5">
          <span class="flex h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span class="flex h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span class="flex h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span class="font-mono text-[10px] font-medium uppercase tracking-wider text-[#bec1c7]">{{ languageLabel }}</span>
      </span>
      <button v-if="language === 'mermaid' || language === 'callout'" type="button" :title="lineWrapping ? '关闭自动换行' : '开启自动换行'"
        class="flex h-6 items-center justify-center gap-1 rounded px-2 font-mono text-[10px] text-[#969aa3] hover:bg-[#3a3b40] hover:text-[#e4e6eb]"
        :class="lineWrapping ? 'bg-[#45464c] text-[#e4e6eb]' : ''" @mousedown.prevent="toggleLineWrapping">
        <Icon icon="lucide:wrap-text" :size="13" />
        <span>换行</span>
      </button>
    </div>
    <div ref="editorElement" class="flex min-w-0 bg-[#1e1f22]" :style="editorSize" />
  </div>
</template>

<script setup lang="ts">
import { defaultKeymap } from '@codemirror/commands'
import { Compartment, EditorState, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import { Icon } from '@iconify/vue/offline'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  language: 'mermaid' | 'math' | 'callout'
  minHeight?: number
}>(), {
  minHeight: 48,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const editorElement = ref<HTMLElement | null>(null)
const editorSize = computed(() => ({ minHeight: `${props.minHeight}px` }))
const languageLabel = computed(() => props.language === 'mermaid' ? 'Mermaid' : props.language === 'callout' ? 'Callout' : 'TeX')
const lineWrapping = ref(true)
let editorView: EditorView | null = null
const lineWrappingCompartment = new Compartment()

type SourceMark = { from: number; to: number; className: string }

const collectMarks = (state: EditorState): SourceMark[] => {
  const source = state.doc.toString()
  const marks: SourceMark[] = []
  const patterns = props.language === 'mermaid'
    ? [
        { expression: /\b(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|subgraph|end)\b/gu, className: 'cm-module-keyword' },
        { expression: /\b(?:LR|RL|TB|TD|BT)\b/gu, className: 'cm-module-operator' },
        { expression: /\p{Script=Han}+/gu, className: 'cm-module-value' },
      ]
    : props.language === 'math'
      ? [
          { expression: /\\[A-Za-z]+/gu, className: 'cm-module-keyword' },
          { expression: /\b\d+(?:\.\d+)?\b/gu, className: 'cm-module-value' },
        ]
      : [
          // Callout：正文是普通 Markdown，高亮标题、粗体与行内代码。
          { expression: /^#{1,6}\s.*$/gmu, className: 'cm-module-keyword' },
          { expression: /`[^`\n]+`|\*\*[^*\n]+\*\*/gu, className: 'cm-module-value' },
        ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.expression)) {
      if (match.index === undefined) continue
      const from = match.index
      marks.push({ from, to: from + match[0].length, className: pattern.className })
    }
  }
  return marks.sort((left, right) => left.from - right.from)
}

const sourceHighlight = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(collectMarks(state).map((mark) => Decoration.mark({ class: mark.className }).range(mark.from, mark.to))),
  update: (_value, transaction) => Decoration.set(
    collectMarks(transaction.state).map((mark) => Decoration.mark({ class: mark.className }).range(mark.from, mark.to)),
  ),
  provide: (field) => EditorView.decorations.from(field),
})

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1e1f22',
    color: '#e4e6eb',
    flex: '1',
    fontSize: '14px',
    minWidth: '0',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'SF Mono, Fira Code, Consolas, Menlo, monospace',
    lineHeight: '24px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '12px 16px', caretColor: '#e4e6eb' },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#45464c' },
  '.cm-cursor': { borderLeftColor: '#e4e6eb' },
  '.cm-module-keyword': { color: '#ff8a8a' },
  '.cm-module-operator': { color: '#70a0ff' },
  '.cm-module-value': { color: '#73c991' },
})

const toggleLineWrapping = (): void => {
  lineWrapping.value = !lineWrapping.value
  editorView?.dispatch({
    effects: lineWrappingCompartment.reconfigure(lineWrapping.value ? EditorView.lineWrapping : []),
  })
}

onMounted(() => {
  if (!editorElement.value) return
  editorView = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: props.modelValue,
      selection: { anchor: 0 },
      extensions: [
        keymap.of(defaultKeymap),
        sourceHighlight,
        lineWrappingCompartment.of(EditorView.lineWrapping),
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false
            event.preventDefault()
            emit('submit')
            return true
          },
        }),
      ],
    }),
  })
  editorView.focus()
})

watch(() => props.modelValue, (value) => {
  if (!editorView || editorView.state.doc.toString() === value) return
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: value } })
})

onBeforeUnmount(() => editorView?.destroy())
</script>
