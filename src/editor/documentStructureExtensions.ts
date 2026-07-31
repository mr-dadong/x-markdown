import { Extension } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Plugin, TextSelection } from "@tiptap/pm/state";

// 文档以块内容结尾时补充可输入段落，确保用户能继续输入。
export const TrailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          if (newState.doc.lastChild?.type.name === "paragraph") return null;

          const paragraph = newState.schema.nodes.paragraph.create();
          return newState.tr.insert(newState.doc.content.size, paragraph);
        },
      }),
    ];
  },
});

// 将顶层块之间的临时 GapCursor 转换成真正的空段落。
export const ReadableGapCursor = Extension.create({
  name: "readableGapCursor",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.selectionSet)) return null;
          if (!(newState.selection instanceof GapCursor)) return null;

          const { $from } = newState.selection;
          if ($from.depth !== 0) return null;

          const paragraph = newState.schema.nodes.paragraph;
          const insertIndex = $from.index();
          if (!$from.parent.canReplaceWith(insertIndex, insertIndex, paragraph)) return null;

          const transaction = newState.tr.insert(
            newState.selection.from,
            paragraph.create(),
          );
          transaction.setSelection(
            TextSelection.create(transaction.doc, newState.selection.from + 1),
          );
          return transaction.scrollIntoView();
        },
      }),
    ];
  },
});

// 文本块旁边无法产生 GapCursor 时，也允许通过点击视觉间隙插入空段落。
export const ClickableBlockGap = Extension.create({
  name: "clickableBlockGap",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (view, _position, event) => {
            const paragraph = view.state.schema.nodes.paragraph;
            const clickY = event.clientY;
            const editorRectangle = view.dom.getBoundingClientRect();
            let boundaryPosition = 0;
            let previousBottom: number | null = null;
            let previousNode: typeof view.state.doc.firstChild = null;

            // 边界附近已有空段落时直接把光标放进去，否则创建新的可输入段落。
            const focusOrInsertParagraph = (
              position: number,
              paragraphPosition: number | null,
            ): boolean => {
              if (paragraphPosition !== null) {
                const transaction = view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, paragraphPosition + 1),
                );
                view.dispatch(transaction.scrollIntoView());
                view.focus();
                return true;
              }

              const insertIndex = view.state.doc.resolve(position).index();
              if (!view.state.doc.canReplaceWith(insertIndex, insertIndex, paragraph)) {
                return false;
              }

              const transaction = view.state.tr.insert(position, paragraph.create());
              transaction.setSelection(
                TextSelection.create(transaction.doc, position + 1),
              );
              view.dispatch(transaction.scrollIntoView());
              view.focus();
              return true;
            };

            const isEmptyParagraph = (
              node: typeof view.state.doc.firstChild,
            ): boolean => node?.type === paragraph && node.content.size === 0;

            for (let index = 0; index < view.state.doc.childCount; index += 1) {
              const node = view.state.doc.child(index);
              const nodeDom = view.nodeDOM(boundaryPosition);
              const element =
                nodeDom instanceof HTMLElement
                  ? nodeDom
                  : nodeDom?.parentElement ?? null;

              if (element) {
                const rectangle = element.getBoundingClientRect();

                // 点击第一个块上方的编辑区空白时，在文档开头提供输入位置。
                if (
                  index === 0 &&
                  clickY >= editorRectangle.top &&
                  clickY < rectangle.top
                ) {
                  return focusOrInsertParagraph(
                    0,
                    isEmptyParagraph(node) ? 0 : null,
                  );
                }

                // 只响应两个顶层块真实存在的空白区域，避免改变块内容本身的点击行为。
                if (
                  previousBottom !== null &&
                  clickY >= previousBottom &&
                  clickY <= rectangle.top &&
                  rectangle.top > previousBottom
                ) {
                  const emptyParagraphPosition = isEmptyParagraph(previousNode)
                    ? boundaryPosition - (previousNode?.nodeSize ?? 0)
                    : isEmptyParagraph(node)
                      ? boundaryPosition
                      : null;
                  return focusOrInsertParagraph(
                    boundaryPosition,
                    emptyParagraphPosition,
                  );
                }

                previousBottom = rectangle.bottom;
              }

              boundaryPosition += node.nodeSize;
              previousNode = node;
            }

            // 单个代码块或其他块位于文档末尾时，点击其下方也能继续输入。
            if (
              previousBottom !== null &&
              clickY > previousBottom &&
              clickY <= editorRectangle.bottom
            ) {
              const lastNodePosition =
                boundaryPosition - (previousNode?.nodeSize ?? 0);
              return focusOrInsertParagraph(
                boundaryPosition,
                isEmptyParagraph(previousNode) ? lastNodePosition : null,
              );
            }

            return false;
          },
        },
      }),
    ];
  },
});
