import { MarkdownManager } from "@tiptap/markdown";

/**
 * 行内文本里的 HTML 实体解码（`&reg;` → ®、`&#182;` → ¶）。
 *
 * 官方 @tiptap/markdown 解析 text token 时会调用 @tiptap/core 的 decodeHtmlEntities，
 * 而那个实现只认四个实体：
 * `&lt; &gt; &quot; &amp;`（见 node_modules/@tiptap/core/dist/index.js）。
 * 于是 `&reg;`、`&nbsp;`、`&#182;`、`&frac14;` 会原样留在文档里，预览显示 "&reg;"
 * 而不是 ®，与 Typora 不一致（Typora 的文档例子是
 * "HTML entities like &reg; &#182;" → ® ¶）。
 *
 * decodeHtmlEntities 是 @tiptap/core 的模块级函数，原型上没有可覆盖的方法，
 * 所以改为在解析行内 token 之前就地改写 text token：
 * 先做全量解码，再把结果里的 `&` 还原成 `&amp;`，官方那个解码器随后会把它变回 `&`,
 * 最终得到的正是全量解码的结果。
 *
 * 「先解码、再补 `&amp;`」这个顺序是必须的：像 `&amp;reg;`（用户想表示字面量
 * "&reg;"）如果在官方解码之后再补一次解码，就会错成 ®；先整体解码再补 `&amp;`
 * 则两次结果都是字面量 "&reg;"，与浏览器一致。
 *
 * 解码用 textarea 的 RCDATA 语义：只解析实体、不把 `<` 当标签，
 * 因此 `&lt;b&gt;` 解码成字面文本 `<b>`，而普通文本里的 `<` 完全不受影响。
 */

/** 只匹配带分号的合法实体写法（命名实体或十进制/十六进制数字引用）。 */
const HTML_ENTITY_PATTERN = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/gu;

/** 交给浏览器解码单个实体；不是合法实体时原样返回。 */
const decodeEntity = (entity: string): string => {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = entity;
  return textarea.value;
};

/** 把一段文本里的 HTML 实体全部解码成字符。 */
const decodeEntities = (value: string): string =>
  value.replace(HTML_ENTITY_PATTERN, (entity) => decodeEntity(entity));

/** 把 `&` 还原成官方解码器认得的形式，其余字符原样交给它。 */
const protectAmpersands = (value: string): string => value.replaceAll("&", "&amp;");

/** marked 行内 token 的最小形态：只需要识别 text token 及其文本。 */
type InlineTokenLike = { type?: string; text?: string };

/** 是否已经打过补丁，避免重复安装时把覆盖层层叠加。 */
let entityDecodingInstalled = false;

/**
 * 让行内文本在解析时完成全量 HTML 实体解码。
 *
 * 覆盖的是原型方法，因此对已经创建的 manager 实例同样生效；函数幂等，
 * 重复调用不会重复包装。必须在任何 Editor 构造之前调用
 * （与另外几个 MarkdownManager 补丁同样的原因，见 editorExtensions.ts）。
 */
export const installHtmlEntityDecoding = (): void => {
  if (entityDecodingInstalled) return;
  entityDecodingInstalled = true;

  const prototype = MarkdownManager.prototype as unknown as {
    parseInlineTokens: (tokens: InlineTokenLike[]) => unknown;
  };
  const originalParseInlineTokens = prototype.parseInlineTokens;

  prototype.parseInlineTokens = function (
    this: unknown,
    tokens: InlineTokenLike[],
  ): unknown {
    for (const token of tokens) {
      if (token.type !== "text" || typeof token.text !== "string") continue;
      // 没有 `&` 的文本不必解析，省掉绝大多数按键上的开销。
      if (!token.text.includes("&")) continue;
      token.text = protectAmpersands(decodeEntities(token.text));
    }
    return originalParseInlineTokens.call(this, tokens);
  };
};
