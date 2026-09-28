import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { runWithInlineHtmlSourceForm } from "./inlineHtmlSourceForm";

/**
 * 行内 HTML 的保真解析：标签要么变成真正的节点/标记，要么原样保留为字面文本。
 *
 * 官方 @tiptap/markdown 处理行内 HTML token 时，会把它交给 DOMParser 解析，
 * 再只保留其中的行内节点（见 node_modules/@tiptap/markdown/dist/index.js:887-903
 * 的 parseHTMLToken）。这条路径有两个会吃掉用户内容的出口：
 *
 * 1. 解析不出行内节点时返回 null，上游 parseInlineTokens 把整个 token 丢掉。
 *    例：`<a/>` 解析成空的 `<a>` 元素，`<a>sddd<a/>` 重开后只剩 `sddd`。
 *
 * 2. 解析出了节点，但没有任何标记 —— 说明标签没有被 schema 认领，标签被直接吃掉，
 *    只剩文字。例：`<a>sss</a>`（`<a>` 没有 href，匹配不上 Link 的 `a[href]` 规则）
 *    重开后变成 `sss`，`<span>sss</span>`（没有 style）同样退化成 `sss`。
 *
 * 两者都是「用户写的内容无声消失」，而且源码视图也会跟着退化成纯文本。
 * 官方只对「认不出的标签名」（如 `<enter foo>`）有 htmlAsLiteralText 兜底，
 * 标准标签名不在其列，恰好绕过了兜底。
 *
 * 这里把两个出口都补上：退回字面文本，而不是丢弃。判据是「解析结果里有没有
 * 真正的标记或非文本节点」——有就说明标签被 schema 认领了（如 `<em>` 变斜体、
 * `<a href>` 变链接、`<img>` 变图片节点），保持官方行为；没有就说明标签白写了，
 * 原样保留。块级 HTML 由 HtmlBlock 扩展接管，不在本补丁的干预范围内。
 */

/** 官方 MarkdownManager 内部使用、但未出现在公开类型里的字段。 */
type MarkdownManagerInternals = {
  /** 官方原本的 HTML token 解析实现，签名固定但未公开导出。 */
  parseHTMLToken: (token: { block?: boolean; raw?: string; text?: string }) => unknown;
  /** 把原始 HTML 原样收成字面文本节点，block 决定是否包一层段落。 */
  htmlAsLiteralText: (html: string, isBlock: boolean) => JSONContent | null;
};

/** 无标记的纯文本节点：标签没有换来任何格式，等于白写。 */
const isUnformattedTextNode = (node: unknown): boolean => {
  if (node === null || typeof node !== "object") return false;
  const candidate = node as { type?: unknown; marks?: unknown };
  if (candidate.type !== "text") return false;
  return !Array.isArray(candidate.marks) || candidate.marks.length === 0;
};

/**
 * 判断解析结果是否「只剩没有格式的文字」。
 *
 * 空数组也算：官方行内分支本应在内容为空时返回 null，真出现空数组说明同样没产出东西，
 * 按字面文本收下更安全。
 */
const isPlainTextResult = (result: unknown): boolean =>
  Array.isArray(result) ? result.every(isUnformattedTextNode) : isUnformattedTextNode(result);

/** 是否已经打过补丁，避免重复安装时把覆盖层层叠加。 */
let literalInlineHtmlInstalled = false;

/**
 * 让行内 HTML 在解析不出节点、或解析不出任何格式时退回字面文本，不再静默丢内容。
 *
 * 覆盖的是原型方法，因此对已经创建的 manager 实例同样生效；函数幂等，
 * 重复调用不会重复包装。
 */
export const installLiteralInlineHtmlParsing = (): void => {
  if (literalInlineHtmlInstalled) return;
  literalInlineHtmlInstalled = true;

  const prototype = MarkdownManager.prototype as unknown as MarkdownManagerInternals;
  const originalParseHTMLToken = prototype.parseHTMLToken;

  prototype.parseHTMLToken = function (
    this: MarkdownManagerInternals,
    token: { block?: boolean; raw?: string; text?: string },
  ): unknown {
    const html = String(token.raw ?? token.text ?? "");

    // 只接管行内 HTML：块级 HTML 由 HtmlBlock 扩展负责，且必须以 `<` 开头，
    // 避免把纯空白等无内容 token 也收成节点。
    const isInlineHtml = !token.block && html.startsWith("<");

    /*
     * 行内 HTML 交给官方解析时打开「记录源码形态」开关：schema 认领出来的标记与节点
     * 会记住用户写的那个标签，序列化时按原样输出（见 inlineHtmlSourceForm.ts）。
     */
    const parseToken = (): unknown => originalParseHTMLToken.call(this, token);
    const result = isInlineHtml ? runWithInlineHtmlSourceForm(parseToken) : parseToken();

    if (!isInlineHtml) return result;

    // 出口 1：官方准备丢弃这个 token。
    if (result === null || result === undefined) return this.htmlAsLiteralText(html, false);

    // 出口 2：解析出了节点，但没有任何标记，说明标签没有被 schema 认领。
    if (isPlainTextResult(result)) return this.htmlAsLiteralText(html, false);

    return result;
  };
};