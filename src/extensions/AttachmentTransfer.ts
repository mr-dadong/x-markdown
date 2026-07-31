import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import AttachmentTransferView from '../components/AttachmentTransferView.vue'

// 复制进度节点只在当前编辑会话中短暂存在，完成后会被正式附件节点替换。
export const AttachmentTransfer = Node.create({
  name: 'attachmentTransfer',
  group: 'block',
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      requestId: { default: '' },
      fileName: { default: '正在准备文件' },
      copiedBytes: { default: 0 },
      totalBytes: { default: 0 },
      status: { default: 'copying' },
      error: { default: '' },
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(AttachmentTransferView)
  },

  // 临时节点不写入 Markdown，避免复制过程中保存文档时产生无效链接。
  addStorage() {
    return {
      markdown: {
        serialize(state: { closeBlock: (node: unknown) => void }, node: unknown) {
          state.closeBlock(node)
        },
      },
    }
  },

  renderHTML() {
    return ['div', { 'data-xmd-attachment-transfer': '' }]
  },
})
