import type { Editor } from "@tiptap/core";

/**
 * 附件复制进度卡片（attachmentTransfer 节点）的统一操作入口。
 *
 * 斜杠菜单插入附件和编辑器内粘贴/拖入附件走的是同一套交互：
 * 复制开始时插入一张进度卡片，复制过程中反复刷新进度，复制结束后
 * 把卡片替换成最终的附件卡片。此前这两条路径各自实现了一遍，
 * 节点名、请求编号匹配规则和属性拼装都写了两份，容易改一漏一。
 * 这里收敛成唯一来源，两个调用方只负责「在哪里插入」。
 */
export interface AttachmentTransferTracker {
  /** 按请求编号查找进度卡片当前所在位置；找不到返回 null。 */
  findPosition(): number | null;
  /** 在指定位置插入进度卡片与后续段落，随后由 update 刷新进度。 */
  insert(insertPosition: number, progress: AttachmentCopyProgressLike): void;
  /** 刷新已存在卡片的进度数据；卡片已被删除时安全跳过。 */
  update(progress: AttachmentCopyProgressLike): void;
  /** 把进度卡片替换成最终附件卡片；卡片已被删除时返回 false。 */
  replaceWithAttachment(attachment: AttachmentResultLike): boolean;
}

/** 进度事件里与本模块相关的字段（与主进程 AttachmentCopyProgress 对应）。 */
interface AttachmentCopyProgressLike {
  fileName: string;
  copiedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  status: string;
  error?: string;
}

/** 复制成功后得到的最终附件信息。 */
interface AttachmentResultLike {
  fileName: string;
  fileSize: number;
  fileType: string;
  url: string;
}

/**
 * 创建进度卡片操作器。
 * @param editor 目标编辑器
 * @param requestId 本次复制的请求编号，用于区分同时进行的多个附件
 */
export function createAttachmentTransferTracker(
  editor: Editor,
  requestId: string,
): AttachmentTransferTracker {
  // 进度卡片与请求编号一一对应，按编号查找可避免多个附件互相覆盖进度。
  const findPosition = (): number | null => {
    let position: number | null = null;
    editor.state.doc.descendants((node, nodePosition) => {
      if (node.type.name === "attachmentTransfer" && node.attrs.requestId === requestId) {
        position = nodePosition;
        return false;
      }
      return position === null;
    });
    return position;
  };

  // 进度卡片携带的全部属性；插入与刷新共用，保证两处字段不会写得不一致。
  const buildTransferAttributes = (progress: AttachmentCopyProgressLike): Record<string, unknown> => ({
    requestId,
    fileName: progress.fileName,
    copiedBytes: progress.copiedBytes,
    totalBytes: progress.totalBytes,
    bytesPerSecond: progress.bytesPerSecond,
    status: progress.status,
    error: progress.error ?? "",
  });

  return {
    findPosition,
    insert: (insertPosition, progress) => {
      editor.chain().focus().insertContentAt(insertPosition, [
        { type: "attachmentTransfer", attrs: buildTransferAttributes(progress) },
        { type: "paragraph" },
      ]).run();
    },
    update: (progress) => {
      const position = findPosition();
      if (position === null) return;
      const currentAttributes = editor.state.doc.nodeAt(position)?.attrs;
      if (!currentAttributes) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(position, undefined, {
          ...currentAttributes,
          ...buildTransferAttributes(progress),
        }),
      );
    },
    replaceWithAttachment: (attachment) => {
      const position = findPosition();
      if (position === null) return false;
      const transferNode = editor.state.doc.nodeAt(position);
      if (!transferNode) return false;
      editor.view.dispatch(
        editor.state.tr.replaceWith(
          position,
          position + transferNode.nodeSize,
          editor.schema.nodes.attachment.create({
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            fileType: attachment.fileType,
            url: attachment.url,
          }),
        ),
      );
      return true;
    },
  };
}
