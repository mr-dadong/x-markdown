declare module "markdown-it-mark" {
  import type { MarkdownIt } from "markdown-it";

  // markdown-it 15 自带类型后不再导出 PluginSimple，按 use() 的插件签名显式声明。
  /** 无参插件：接收 md 实例并注册 ==高亮== 的行内与渲染规则。 */
  const markdownItMark: (markdown: MarkdownIt) => void;
  export default markdownItMark;
}
