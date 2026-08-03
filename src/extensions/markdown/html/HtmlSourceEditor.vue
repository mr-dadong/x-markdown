<template>
  <div ref="editorElement" class="flex min-h-40 min-w-0 flex-1 overflow-hidden" />
</template>

<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { html } from '@codemirror/lang-html'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const editorElement = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null

// 编辑器、行号和滚动条由同一个视图绘制，选中源码时文字不会再被高亮遮罩覆盖。
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-paper)',
    color: 'var(--color-ink)',
    flex: '1',
    fontSize: '12px',
    height: '100%',
    minWidth: '0',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'SF Mono, Fira Code, Consolas, Menlo, monospace',
    lineHeight: '20px',
    overflow: 'auto',
    scrollbarColor: 'var(--color-muted) transparent',
    scrollbarWidth: 'thin',
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-toolbar)',
    borderRight: '1px solid var(--color-line)',
    color: 'var(--color-muted)',
  },
  '.cm-gutterElement': { minWidth: '42px', padding: '0 10px 0 6px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-control-hover)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-selected)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
})

onMounted(() => {
  if (!editorElement.value) return
  editorView = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        html(),
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
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: value },
  })
})

onBeforeUnmount(() => editorView?.destroy())
</script>
