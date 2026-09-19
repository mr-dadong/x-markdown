import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

/**
 * 正文文本节点的最小转义规则。
 *
 * tiptap-markdown 内置的 text 节点序列化会先做 HTML 实体转义（把 `<` `>` 换成
 * `&lt;` `&gt;`），再交给 prosemirror-markdown 的 `esc()`（把每个反斜杠都写成
 * `\\`）。两者都不区分「这个字符在 Markdown 里是否真的会被误解」，于是渲染视图
 * 里输入的字面文本会在源码视图和存盘文件里被改写：
 *
 * - 输入 `\d`   → 存成 `\\d`
 * - 输入 `<a>`  → 存成 `&lt;a&gt;`
 *
 * 这里改成「只有 Markdown 真的会误解时才补转义」的规则，源码视图尽量保持
 * 用户输入的原样，同时保证存盘后重新打开语义完全不变。
 */

/** prosemirror-markdown 内部使用、但未出现在类型声明里的序列化状态字段。 */
type TextSerializerState = MarkdownSerializerState & {
  /** 当前位置是否位于块首；块首字符有额外的 Markdown 语法含义。 */
  atBlockStart: boolean;
};

/** 需要补反斜杠的字面字符：它们在任何位置都能开启 Markdown 语法。 */
const ALWAYS_ESCAPED_CHARACTERS = new Set(["`", "*", "~", "[", "]"]);

/**
 * 判断字符是否是可被反斜杠转义的 ASCII 标点。
 * CommonMark 只承认 ASCII 标点前的反斜杠是转义符，其余位置的 `\` 是字面反斜杠。
 */
const isEscapableAsciiPunctuation = (character: string): boolean => {
  if (character === "") return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 0x21 && code <= 0x2f)
    || (code >= 0x3a && code <= 0x40)
    || (code >= 0x5b && code <= 0x60)
    || (code >= 0x7b && code <= 0x7e)
  );
};

/**
 * 判断下标处的 `<` 是否会被 Markdown 当成 HTML 标签或自动链接的开头。
 *
 * 只有这种位置才需要写成 `\<`；像 `a<b` 这种不成对的尖括号会被原样当作文本，
 * 不补转义，源码视图才不会被无谓的反斜杠塞满。
 */
const startsInlineHtml = (value: string, index: number): boolean => {
  const rest = value.slice(index);
  return (
    // 普通标签与闭合标签：<div>、</div>、<br/>，以及 <?php ... ?>、<!DOCTYPE ...>
    /^<[/!?]?[A-Za-z][^<>]*>/u.test(rest)
    // HTML 注释
    || /^<!--/u.test(rest)
    // 网址自动链接 <https://example.com>
    || /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*>/u.test(rest)
    // 邮箱自动链接 <user@example.com>
    || /^<[^\s<>@]+@[^\s<>@]+>/u.test(rest)
  );
};

/**
 * 把一段正文文本转义成 Markdown 源码。
 *
 * @param value 编辑器文档里该文本节点的原始内容
 * @param startOfLine 这段文本是否位于块的起始位置
 */
export const escapeMarkdownText = (value: string, startOfLine: boolean): string => {
  let escaped = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "\\") {
      // 反斜杠后面是可转义标点（或行尾）时会被当成转义符，必须写成 `\\` 才能表示一个反斜杠；
      // 后面是普通字符时 Markdown 本来就把它当字面反斜杠，再补一个反而会多出一个字符。
      const next = value[index + 1] ?? "";
      escaped += isEscapableAsciiPunctuation(next) || next === "" ? "\\\\" : "\\";
      continue;
    }

    if (character === "<") {
      escaped += startsInlineHtml(value, index) ? "\\<" : "<";
      continue;
    }

    if (character === "_") {
      // 词中间的 `_` 无法开启强调，与 prosemirror-markdown 的默认判断保持一致。
      const previous = value[index - 1] ?? "";
      const next = value[index + 1] ?? "";
      const insideWord = /\w/u.test(previous) && /\w/u.test(next);
      escaped += insideWord ? "_" : "\\_";
      continue;
    }

    escaped += ALWAYS_ESCAPED_CHARACTERS.has(character) ? `\\${character}` : character;
  }

  if (!startOfLine) return escaped;

  // 行首字符有额外的语法含义（列表标记、标题、有序列表），规则与 prosemirror-markdown 一致。
  return escaped
    .replace(/^(\+[ ]|[-*>])/u, "\\$&")
    .replace(/^(\s*)(#{1,6})(\s|$)/u, "$1\\$2$3")
    .replace(/^(\s*\d+)\.\s/u, "$1\\. ");
};

/**
 * 用最小转义规则接管正文文本节点的 Markdown 序列化。
 *
 * tiptap-markdown 把内置的 text 序列化规则放在自己模块内部的扩展表里，
 * 序列化时按扩展名查找（`markdownExtensions.find(e => e.name === 'text')`），
 * 因此改不到那个对象。不过它取规则时会用编辑器 schema 里同名扩展的
 * `storage.markdown` 覆盖内置实现，所以把规则写到 schema 的 text 扩展上即可生效。
 */
export const installMarkdownTextSerializer = (editor: Editor): void => {
  const textExtension = editor.extensionManager.extensions.find(
    (extension) => extension.name === "text",
  );
  if (!textExtension) {
    throw new Error("未找到 text 节点扩展，无法接管正文文本的 Markdown 序列化");
  }

  textExtension.storage = {
    markdown: {
      serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
        const textState = state as TextSerializerState;
        // escape 传 false：转义已由 escapeMarkdownText 完成，不能再走 prosemirror-markdown 的 esc()。
        state.text(escapeMarkdownText(node.text ?? "", textState.atBlockStart), false);
      },
    },
  };
};
