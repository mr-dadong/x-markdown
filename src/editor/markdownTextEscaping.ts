import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

/**
 * 正文文本节点的最小转义规则。
 *
 * 官方 @tiptap/markdown 的文本转义是硬编码的：MarkdownManager.renderNodeToMarkdown
 * 遇到 text 节点会先于任何扩展 handler 直接返回 encodeTextForMarkdown 的结果
 * （见 node_modules/@tiptap/markdown/src/MarkdownManager.ts:1178-1180 与 :1283），
 * 而该方法与 escapeMarkdownSyntax 都是 private，官方没有留出覆盖钩子。
 * 其内置规则正是本项目刻意要摆脱的保守转义：先做 HTML 实体转义（把 `<` `>` 换成
 * `&lt;` `&gt;`），再给 `\`、反引号、`*`、`_`、`[`、`]`、`~` 无差别补反斜杠。
 *
 * 于是渲染视图里输入的字面文本会在源码视图和存盘文件里被改写：
 *
 * - 输入 `\d`   → 存成 `\\d`
 * - 输入 `<a>`  → 存成 `&lt;a&gt;`
 *
 * TypeScript 的 private 只在编译期生效，运行时方法仍挂在 MarkdownManager 的原型上，
 * 因此这里覆盖原型方法，把转义换回「只有 Markdown 真的会误解时才补转义」的规则，
 * 源码视图尽量保持用户输入的原样，同时保证存盘后重新打开语义完全不变。
 */

/**
 * 官方 MarkdownManager 内部使用、但未出现在公开类型里的字段。
 *
 * 不能写成 `MarkdownManager & { ... }`：`codeTypes` 在 MarkdownManager 里是
 * private，交叉后 TS 会把整个类型收缩成 never，反而取不到这些字段。
 */
type MarkdownManagerInternals = {
  /** 声明了 `code: true` 的扩展名集合，代码上下文内不做任何转义。 */
  codeTypes: Set<string>;
  /** 官方原本的文本转义实现，签名固定但未公开导出。 */
  encodeTextForMarkdown: (
    text: string,
    node: JSONContent,
    parentNode?: JSONContent,
  ) => string;
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
 * 判断这段文本是否位于一行的开头。
 *
 * 行首字符有额外的 Markdown 语法含义（列表标记、标题、有序列表）。官方实现按
 * 输出位置判断块首，这里改为按兄弟节点位置判断：父节点没有子节点列表（顶层文本）
 * 或它本身就是父节点的第一个子节点时为行首；紧跟在硬换行之后的文本同样处于新行开头。
 */
const isAtLineStart = (node: JSONContent, parentNode?: JSONContent): boolean => {
  const siblings = parentNode?.content;
  if (!Array.isArray(siblings)) return true;
  const index = siblings.indexOf(node);
  if (index <= 0) return true;
  return siblings[index - 1]?.type === "hardBreak";
};

/** 代码上下文内的文本必须原样输出，判定依据沿用官方自己维护的 codeTypes。 */
const isInsideCodeContext = (
  manager: MarkdownManagerInternals,
  node: JSONContent,
  parentNode?: JSONContent,
): boolean => {
  if (parentNode?.type != null && manager.codeTypes.has(parentNode.type)) return true;
  return (node.marks ?? []).some((mark) =>
    manager.codeTypes.has(typeof mark === "string" ? mark : mark.type),
  );
};

/** 是否已经打过补丁，避免重复安装时把覆盖层层叠加。 */
let minimalEscapingInstalled = false;

/**
 * 用最小转义规则接管官方 MarkdownManager 的正文文本转义。
 *
 * 覆盖的是原型方法，因此对已经创建的 manager 实例同样生效；函数幂等，
 * 重复调用不会重复包装。
 */
export const installMinimalTextEscaping = (): void => {
  if (minimalEscapingInstalled) return;
  minimalEscapingInstalled = true;

  const prototype = MarkdownManager.prototype as unknown as MarkdownManagerInternals;
  prototype.encodeTextForMarkdown = function (
    this: MarkdownManagerInternals,
    text: string,
    node: JSONContent,
    parentNode?: JSONContent,
  ): string {
    // 代码上下文保持官方行为：原样输出，不补任何转义。
    if (isInsideCodeContext(this, node, parentNode)) return text;
    return escapeMarkdownText(text, isAtLineStart(node, parentNode));
  };
};
