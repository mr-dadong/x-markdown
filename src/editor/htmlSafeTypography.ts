import { InputRule } from "@tiptap/core";
import Typography from "@tiptap/extension-typography";

/**
 * 排版替换（智能引号、破折号等）不作用在 HTML 标签内部。
 *
 * 官方 Typography 的输入规则只看光标前匹配到的那几个字符，不看上下文，于是写 HTML 时
 * 会被静默改写：
 *
 * - `<a href="#x">` 的直引号变成弯引号 → `<a href=”#x”>`，属性值被污染，
 *   重新打开后链接地址就成了 `”#x”`；
 * - `<!-- 注释 -->` 的 `<-` 变成 `←`、`--` 变成 `—`，注释根本敲不出来。
 *
 * 这里给所有排版规则统一加一道上下文判断：光标位于未闭合的 HTML 标签内部时直接跳过，
 * 让用户原样输入。正文里的智能引号、破折号等不受影响。
 *
 * 代价：`<-` 不再替换成 `←` —— 它与 `<!--` 在敲下第一个 `-` 时无法区分，
 * 两者相权取保真，`←` 需要直接输入。
 */

/**
 * 判断光标前这段文本是否位于一个未闭合的 HTML 标签内部。
 *
 * 判据是两条同时成立：最后一个 `<` 之后还没有 `>`，且 `<` 后紧跟标签起始字符。
 * `a < b` 这类比较符号不满足第二条，正文里的智能引号不会被误伤。
 */
const isInsideHtmlTag = (textBefore: string): boolean => {
  const lastOpen = textBefore.lastIndexOf("<");
  if (lastOpen < 0) return false;
  // `<` 之后已经出现 `>`，说明标签已经闭合，光标在标签之外。
  if (textBefore.indexOf(">", lastOpen) >= 0) return false;
  // `-` 也算标签起始字符，否则 `<!--` 会被 `<-` → `←` 的规则吃掉。
  return /^[A-Za-z/!?-]/u.test(textBefore.slice(lastOpen + 1));
};

/** 把一条排版规则包成「光标在 HTML 标签内就不生效」的版本。 */
const guardedByHtmlTag = (rule: InputRule): InputRule =>
  new InputRule({
    find: rule.find,
    undoable: rule.undoable,
    handler: (props) => {
      const { state, range } = props;
      const $from = state.doc.resolve(range.to);
      const textBefore = $from.parent.textBetween(0, $from.parentOffset);
      if (isInsideHtmlTag(textBefore)) return null;
      return rule.handler(props);
    },
  });

export const HtmlSafeTypography = Typography.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(guardedByHtmlTag);
  },
});
