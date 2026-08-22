import { Extension, markInputRule } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * TipTap 默认规则会把左侧普通字符一并匹配，转换时会误删该字符。
 * 使用负向后顾只检查前一个字符，不把它放进完整匹配结果。
 */
export const safeInlineCodeInputRegex = /(?<!`)`([^`]+)`(?!`)$/;

/** 保留 TipTap 行内代码能力，仅替换会吞掉前置字符的输入规则。 */
export const SafeInlineCode = Code.extend({
  addInputRules() {
    return [
      markInputRule({
        find: safeInlineCodeInputRegex,
        type: this.type,
      }),
    ];
  },
});

/**
 * 查找光标右侧可以与新输入的单个反引号配对的位置。
 * 返回值是结束反引号相对光标的偏移量，也就是需要添加代码标记的文本长度。
 */
export const findClosingBacktickOffset = (textAfterCursor: string): number | null => {
  for (let index = 0; index < textAfterCursor.length; index += 1) {
    if (textAfterCursor[index] === "\n" || textAfterCursor[index] === "\ufffc") {
      return null;
    }
    if (textAfterCursor[index] !== "`") continue;

    let backslashCount = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && textAfterCursor[cursor] === "\\";
      cursor -= 1
    ) {
      backslashCount += 1;
    }
    if (backslashCount % 2 === 1) continue;

    // TipTap 自带的行内代码输入规则使用单个反引号，连续反引号交给普通文本处理。
    if (textAfterCursor[index + 1] === "`") return null;
    return index > 0 ? index : null;
  }
  return null;
};

/** 把本次输入的左侧反引号与右侧已有反引号转换为真正的 code mark。 */
export const handleOpeningBacktickInput = (
  view: Pick<EditorView, "state" | "dispatch">,
  from: number,
  to: number,
  text: string,
): boolean => {
  if (text !== "`" || from !== to) return false;

  const codeMark = view.state.schema.marks.code;
  if (!codeMark) return false;

  const cursor = view.state.doc.resolve(from);
  if (!cursor.parent.isTextblock) return false;

  const textAfterCursor = cursor.parent.textBetween(
    cursor.parentOffset,
    cursor.parent.content.size,
    "\n",
    "\ufffc",
  );
  const closingOffset = findClosingBacktickOffset(textAfterCursor);
  if (closingOffset === null) return false;

  const closingPosition = from + closingOffset;
  const transaction = view.state.tr
    .delete(closingPosition, closingPosition + 1)
    .addMark(from, closingPosition, codeMark.create())
    .removeStoredMark(codeMark);
  transaction.setSelection(
    TextSelection.create(transaction.doc, closingPosition),
  );
  transaction.scrollIntoView();
  view.dispatch(transaction);
  return true;
};

/** 支持先输入右侧反引号、最后再补左侧反引号的编辑顺序。 */
export const InlineCodeOpeningBacktick = Extension.create({
  name: "inlineCodeOpeningBacktick",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: handleOpeningBacktickInput,
        },
      }),
    ];
  },
});
