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
      bytesPerSecond: { default: 0 },
      status: { default: 'copying' },
      error: { default: '' },
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(AttachmentTransferView)
  },

  // 临时节点不写入 Markdown，避免复制过程中保存文档时产生无效链接。
  // 官方渲染侧没有兜底，未注册 renderMarkdown 的节点会被静默丢弃；
  // 这里显式声明空输出，让「不落盘」成为有意行为而不是依赖库的默认。
  renderMarkdown: () => '',

  renderHTML() {
    return ['div', { 'data-xmd-attachment-transfer': '' }]
  },
})
