import { Extension } from "@tiptap/core";
import {
  findTable,
  selectedRect,
  TableMap,
} from "@tiptap/pm/tables";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type TableAlignment = "left" | "center" | "right" | null;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableColumnAlignment: {
      alignTableColumn: (
        alignment: Exclude<TableAlignment, null>,
      ) => ReturnType;
    };
  }
}

const setCellAlignment = (
  node: ProseMirrorNode,
  alignment: TableAlignment,
): Record<string, unknown> => {
  const { alignment: _ignored, ...rest } = node.attrs as Record<string, unknown>;
  return { ...rest, alignment };
};

/**
 * 借鉴 marktext 的列对齐行为：点击当前列的对齐按钮时，若该列已经是该对齐
 * 方式则切回“无对齐”，否则整列统一写入对齐标记。
 */
export const TableColumnAlignment = Extension.create({
  name: "tableColumnAlignment",

  addCommands() {
    return {
      alignTableColumn:
        (alignment: Exclude<TableAlignment, null>) =>
        ({ state, dispatch }): boolean => {
          const table = findTable(state.selection.$anchor);
          if (!table) return false;

          const rect = selectedRect(state);
          const tableMap = TableMap.get(table.node);
          if (rect.left < 0 || rect.left >= tableMap.width) return false;

          const anchorGridIndex = rect.top * tableMap.width + rect.left;
          const anchorCell = table.node.nodeAt(tableMap.map[anchorGridIndex]);
          const alreadyAligned = anchorCell?.attrs.alignment === alignment;
          const nextAlignment: TableAlignment = alreadyAligned ? null : alignment;

          // 遍历整个表格网格，收集覆盖目标列的单元格。合并单元格会在多个
          // 网格位置重复出现，用 Set 去重后逐格写入，避免误改相邻列。
          const cellsToAlign = new Set<number>();
          for (let column = rect.left; column < rect.right; column += 1) {
            for (let row = 0; row < tableMap.height; row += 1) {
              const gridIndex = row * tableMap.width + column;
              if (gridIndex >= 0 && gridIndex < tableMap.map.length) {
                cellsToAlign.add(tableMap.map[gridIndex]);
              }
            }
          }

          let changed = false;
          const transaction = state.tr;
          for (const position of cellsToAlign) {
            const cell = table.node.nodeAt(position);
            if (!cell || cell.attrs.alignment === nextAlignment) continue;
            transaction.setNodeMarkup(
              table.start + position,
              undefined,
              setCellAlignment(cell, nextAlignment),
            );
            changed = true;
          }

          if (!changed || !dispatch) return changed;
          dispatch(transaction.scrollIntoView());
          return true;
        },
    };
  },
});
