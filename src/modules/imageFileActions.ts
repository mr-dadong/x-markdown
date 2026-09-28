import type { Editor } from "@tiptap/core";

/*
 * 图片文件整理后，文档里的引用要跟着改：只处理地址完全相同的图片节点。
 * 图片地址在文档里就是用户写的那串文本（如 assets/a.png），因此按字符串比较即可。
 */

/** 收集文档里引用指定地址的图片节点位置。 */
const findImagePositions = (editor: Editor, src: string): number[] => {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "image" && node.attrs.src === src) {
      positions.push(position);
    }
    return true;
  });
  return positions;
};

/** 把文档里所有引用旧地址的图片改写成新地址，返回改写的数量。 */
export const rewriteImageSource = (
  editor: Editor,
  from: string,
  to: string,
): number => {
  const positions = findImagePositions(editor, from);
  if (positions.length === 0) return 0;

  const transaction = editor.state.tr;
  for (const position of positions) {
    const node = editor.state.doc.nodeAt(position);
    if (!node) continue;
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, src: to });
  }
  editor.view.dispatch(transaction);
  return positions.length;
};

/** 删除文档里引用指定地址的图片节点，返回删除的数量。 */
export const removeImageReferences = (editor: Editor, src: string): number => {
  const positions = findImagePositions(editor, src);
  if (positions.length === 0) return 0;

  // 从后往前删除，避免前面的删除让后面的位置失效。
  const transaction = editor.state.tr;
  for (const position of [...positions].reverse()) {
    const node = editor.state.doc.nodeAt(position);
    if (!node) continue;
    transaction.delete(position, position + node.nodeSize);
  }
  editor.view.dispatch(transaction);
  return positions.length;
};

/** 远程地址与 data URL 没有本地文件可整理，只提供删除引用。 */
export const isLocalImageSource = (src: string): boolean =>
  !/^https?:/iu.test(src) && !/^data:/iu.test(src);
