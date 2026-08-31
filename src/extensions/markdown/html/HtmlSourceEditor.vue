<template>
  <div ref="editorElement" class="flex min-h-24 min-w-0 flex-1 overflow-hidden" />
</template>

<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { html } from '@codemirror/lang-html'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  lineWrapping: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const editorElement = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null
const lineWrappingCompartment = new Compartment()

const htmlHighlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: '#7fd5c5' },
  { tag: tags.attributeName, color: '#d9c97c' },
  { tag: tags.string, color: '#e69a72' },
  { tag: tags.angleBracket, color: '#969aa3' },
  { tag: tags.comment, color: '#747780', fontStyle: 'italic' },
  { tag: tags.invalid, color: '#ff8a8a' },
])

// 编辑器、行号和滚动条由同一个视图绘制，选中源码时文字不会再被高亮遮罩覆盖。
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1e1f22',
    color: '#e4e6eb',
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
    backgroundColor: '#25262a',
    borderRight: '1px solid #3d3f45',
    color: '#747780',
  },
  '.cm-gutterElement': { minWidth: '42px', padding: '0 10px 0 6px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#303137' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#45464c',
  },
  '.cm-cursor': { borderLeftColor: '#e4e6eb' },
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
        syntaxHighlighting(htmlHighlightStyle),
        lineWrappingCompartment.of(props.lineWrapping ? EditorView.lineWrapping : []),
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

watch(() => props.lineWrapping, (enabled) => {
  editorView?.dispatch({
    effects: lineWrappingCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
  })
})

onBeforeUnmount(() => editorView?.destroy())
</script>
