import { TextSelection, type Selection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

/** 判断当前选区是否是“整表选中”或“跨单元格选中”，用于决定是否显示表格工具栏。 */
export const isTableSelection = (selection: Selection): boolean => {
  if (selection instanceof CellSelection) return true;
  return selection.$anchor.parent.type.name === "tableCell" && !selection.empty;
};

const isSelectionInTable = (selection: Selection): boolean => {
  for (let depth = selection.$anchor.depth; depth > 0; depth -= 1) {
    if (selection.$anchor.node(depth).type.spec.tableRole === "table") return true;
  }
  return false;
};

/** 返回光标所在单元格“内容末尾”的位置，用于把粘贴内容追加到该格末尾。不在单元格文本内时返回 null。 */
export const getCellContentEndPosition = (selection: Selection): number | null => {
  const { $anchor } = selection;
  if (!$anchor.parent.isTextblock) return null;

  let insideCell = false;
  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    const role = $anchor.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      insideCell = true;
      break;
    }
  }
  if (!insideCell) return null;

  return $anchor.start() + $anchor.parent.content.size;
};

/** 在表格内按 Ctrl+A / Cmd+A 时，只选中当前光标所在的这一个单元格内容。 */
export const handleTableSelectAll = (
  view: EditorView,
  event: KeyboardEvent,
): boolean => {
  if (
    event.key.toLocaleLowerCase() !== "a" ||
    (!event.ctrlKey && !event.metaKey) ||
    event.altKey
  )
    return false;
  if (!isSelectionInTable(view.state.selection)) return false;

  const { $anchor } = view.state.selection;
  let cellDepth: number | null = null;
  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    const role = $anchor.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      cellDepth = depth;
      break;
    }
  }
  if (cellDepth === null) return false;

  const cellStart = $anchor.before(cellDepth);
  const cellEnd = $anchor.after(cellDepth);
  event.preventDefault();
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, cellStart + 1, cellEnd - 1))
      .scrollIntoView(),
  );
  return true;
};
