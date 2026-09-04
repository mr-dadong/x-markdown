import type { Editor } from "@tiptap/core";

/**
 * 飞书式块多选的纯计算逻辑。
 * 顶层块 = 编辑器根节点（editor.view.dom）的直接子元素，与 doc 的子节点一一对应。
 * 这里只做位置换算，不触碰 DOM class / 事件，便于单元测试。
 */

export interface BlockPosition {
  position: number;
  element: HTMLElement;
  isHeading: boolean;
}

export interface MultiSelectRange {
  from: number;
  to: number;
  startIndex: number;
  endIndex: number;
}

// 顶层块按文档顺序排列，把块 position 换算成其在 doc 子节点中的索引。
export const blockPositionToIndex = (
  editor: Editor,
  position: number,
): number => {
  const doc = editor.state.doc;
  let cursor = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    if (position === cursor) return index;
    cursor += doc.child(index).nodeSize;
  }
  return -1;
};

// 锚点块与当前块之间的连续区间（按块索引），返回文档位置范围与索引范围。
export const computeMultiSelectRange = (
  editor: Editor,
  anchorPosition: number,
  currentPosition: number,
): MultiSelectRange | null => {
  const anchorIndex = blockPositionToIndex(editor, anchorPosition);
  const currentIndex = blockPositionToIndex(editor, currentPosition);
  if (anchorIndex < 0 || currentIndex < 0) return null;

  const startIndex = Math.min(anchorIndex, currentIndex);
  const endIndex = Math.max(anchorIndex, currentIndex);
  const doc = editor.state.doc;

  let from = 0;
  for (let index = 0; index < startIndex; index += 1) {
    from += doc.child(index).nodeSize;
  }
  let to = from;
  for (let index = startIndex; index <= endIndex; index += 1) {
    to += doc.child(index).nodeSize;
  }
  return { from, to, startIndex, endIndex };
};

// 根据视口 Y 坐标定位顶层块：自上而下找第一个包含该坐标的块，
// 落点在文档前后留白时收敛到最近的首块或末块。折叠隐藏的块 rect 为零，自动跳过。
export const resolveBlockAtClientY = (
  editor: Editor,
  clientY: number,
): BlockPosition | null => {
  const root = editor.view.dom;
  const children = Array.from(root.children);
  if (children.length === 0) return null;

  let lastValid: BlockPosition | null = null;
  let position = 0;
  for (let index = 0; index < children.length; index += 1) {
    const element = children[index] as HTMLElement;
    const rect = element.getBoundingClientRect();
    const node = editor.state.doc.child(index);
    const candidate: BlockPosition = {
      position,
      element,
      isHeading: node.type.name === "heading",
    };
    if (rect.height > 0) {
      if (clientY < rect.top) break;
      lastValid = candidate;
      if (clientY <= rect.bottom) return candidate;
    }
    position += node.nodeSize;
  }
  return lastValid;
};
