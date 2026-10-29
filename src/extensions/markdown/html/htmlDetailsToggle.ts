import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * 收起折叠面板时把光标移出面板。
 *
 * 收起只是隐藏内容区：如果光标还停在面板内部，选区就落在不可见的内容里，
 * 用户继续输入会莫名写进被隐藏的区域。这里在收起时把光标挪到面板之后，
 * 和用户对「收起 = 离开这块内容」的直觉一致。
 */
export const moveSelectionOutOfDetails = (
  editor: Editor,
  position: number | undefined,
  nodeSize: number,
): void => {
  if (typeof position !== "number") return;

  const { state, view } = editor;
  const end = position + nodeSize;
  // 光标本来就在面板外：不打断用户的选区。
  if (state.selection.from <= position || state.selection.from >= end) return;

  view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(end))));
};
