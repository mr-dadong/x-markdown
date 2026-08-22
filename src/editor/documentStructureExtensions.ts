import { Extension } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

type TemporaryParagraphMeta =
  | { add: number }
  | { replace: number[] };

// 只跟踪通过点击块间空隙产生的段落，避免误删用户主动按回车创建的空行。
const temporaryParagraphPluginKey = new PluginKey<number[]>(
  "temporaryGapParagraph",
);

/** 判断一组来源事务是否明确要求禁止触发编辑器更新事件。 */
interface MetaReadableTransaction {
  getMeta: (key: string) => unknown;
}

/**
 * 只有真实编辑才允许把重新序列化的 Markdown 发送给文档层。
 * preventUpdate 是 TipTap 加载外部内容时的明确标记，即使编辑器仍有焦点也必须优先拦截。
 */
export const shouldEmitMarkdownUpdate = (
  transaction: MetaReadableTransaction,
  editorIsFocused: boolean,
): boolean => {
  if (transaction.getMeta("preventUpdate") === true) return false;
  return editorIsFocused || transaction.getMeta("uiEvent") !== undefined;
};

export const shouldPreventAppendedUpdate = (
  transactions: readonly MetaReadableTransaction[],
): boolean =>
  transactions.some(
    (transaction) => transaction.getMeta("preventUpdate") === true,
  );

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
          const transaction = newState.tr.insert(
            newState.doc.content.size,
            paragraph,
          );

          /*
           * TipTap 的 setContent(..., false) 会通过 preventUpdate 标记说明这是加载文件，
           * 不是用户编辑。这里生成的是追加事务；如果不继承该标记，TipTap 会把追加的
           * 空段落误判成用户修改，随后文档层就可能启动自动保存并覆盖原始 Markdown。
           */
          if (shouldPreventAppendedUpdate(transactions)) {
            transaction.setMeta("preventUpdate", true);
          }

          return transaction;
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
          transaction.setMeta(temporaryParagraphPluginKey, {
            add: newState.selection.from,
          } satisfies TemporaryParagraphMeta);
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
      new Plugin<number[]>({
        key: temporaryParagraphPluginKey,
        state: {
          init: () => [],
          apply: (transaction, positions) => {
            const meta = transaction.getMeta(
              temporaryParagraphPluginKey,
            ) as TemporaryParagraphMeta | undefined;
            if (meta && "replace" in meta) return meta.replace;

            // 文档变化后同步位置；段落一旦有内容，就不再属于临时段落。
            const mappedPositions = positions
              .map((position) => transaction.mapping.mapResult(position, 1))
              .filter((result) => !result.deleted)
              .map((result) => result.pos)
              .filter((position) => {
                const node = transaction.doc.nodeAt(position);
                return node?.type.name === "paragraph" && node.content.size === 0;
              });

            if (meta && "add" in meta && !mappedPositions.includes(meta.add)) {
              mappedPositions.push(meta.add);
            }
            return mappedPositions;
          },
        },
        appendTransaction: (_transactions, _oldState, newState) => {
          const positions = temporaryParagraphPluginKey.getState(newState) ?? [];
          const positionsToDelete = positions.filter((position) => {
            const node = newState.doc.nodeAt(position);
            if (node?.type.name !== "paragraph" || node.content.size !== 0) return false;

            // 光标还在临时段落内时保留，移到其他内容后再清理。
            const cursorPosition = position + 1;
            return !(
              newState.selection.from === cursorPosition &&
              newState.selection.to === cursorPosition
            );
          });
          if (positionsToDelete.length === 0) return null;

          const transaction = newState.tr;
          positionsToDelete
            .slice()
            .sort((left, right) => right - left)
            .forEach((position) => {
              const node = transaction.doc.nodeAt(position);
              if (node?.type.name === "paragraph" && node.content.size === 0) {
                transaction.delete(position, position + node.nodeSize);
              }
            });

          const remainingPositions = positions
            .filter((position) => !positionsToDelete.includes(position))
            .map((position) => transaction.mapping.map(position, 1));
          transaction.setMeta(temporaryParagraphPluginKey, {
            replace: remainingPositions,
          } satisfies TemporaryParagraphMeta);
          return transaction;
        },
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
              transaction.setMeta(temporaryParagraphPluginKey, {
                add: position,
              } satisfies TemporaryParagraphMeta);
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
