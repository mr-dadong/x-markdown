import { Extension, type JSONContent, type MarkdownParseHelpers } from "@tiptap/core";
// 官方段落扩展：项目要改它的 Markdown 解析（见下方 InlineImageParagraph）。
// 与 @tiptap/core、@tiptap/pm 一样，属于 StarterKit 带来的同级包，仓库未单独声明版本。
import { Paragraph } from "@tiptap/extension-paragraph";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { FIND_REPLACE_EDIT_META } from "../constants";

/*
 * 段落解析：独占一段的图片必须留在段落里。
 *
 * 官方 @tiptap/extension-paragraph 的 parseMarkdown 有一条规则：段落里只有一个图片
 * token 时，交给 parseChildren 在块级重新解析，把图片提升成顶层节点。这假设图片是
 * 块级节点（官方 Image 的默认值）。
 *
 * 但项目的图片是行内节点（`inline: true`）：链接里的行内小图标、正文中的徽章都必须能
 * 放进段落。提升之后 doc 里出现行内节点，属于非法结构 —— doc 的内容表达式不允许它，
 * 于是针对该节点的所有结构修改都会被静默丢弃：表现是独占一段的图片拖动改不了宽度、
 * 也无法重命名或移动（modules/imageFileActions.ts 依赖 setNodeMarkup）。
 *
 * 这里只去掉那条提升规则，其余分支继续走官方实现；HTML 写的独占 `<img>` 向来就是
 * 包在段落里的（见 extensions/markdown/html/HtmlBlock.ts），两种写法因此保持一致。
 */
export const InlineImageParagraph = Paragraph.extend({
  parseMarkdown(token: unknown, helpers: MarkdownParseHelpers): JSONContent {
    const tokens = (token as { tokens?: { type: string }[] }).tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === "image") {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    }

    // this.parent 由 TipTap 在解析字段时注入，但未出现在 parseMarkdown 的公开类型里。
    const parentParse = (
      this as unknown as {
        parent?: (token: unknown, helpers: MarkdownParseHelpers) => JSONContent | undefined;
      }
    ).parent?.(token, helpers);
    // 官方实现不可用时直接报错，避免段落解析静默退化成空段落。
    if (!parentParse) throw new Error("官方 Paragraph 的 parseMarkdown 不可用");
    return parentParse;
  },
});

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
 * 查找替换在编辑器未聚焦（焦点在查找输入框）时执行，替换事务显式带上
 * FIND_REPLACE_EDIT_META 标记，表示这是一次真实的用户编辑，仍须同步给文档层。
 */
export const shouldEmitMarkdownUpdate = (
  transaction: MetaReadableTransaction,
  editorIsFocused: boolean,
): boolean => {
  if (transaction.getMeta("preventUpdate") === true) return false;
  return (
    editorIsFocused ||
    transaction.getMeta("uiEvent") !== undefined ||
    transaction.getMeta(FIND_REPLACE_EDIT_META) === true
  );
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
