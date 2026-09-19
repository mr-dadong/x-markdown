import type { MarkdownStorage } from "tiptap-markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownIt } from "markdown-it";

/**
 * tiptap-markdown 0.9.0 只导出了 MarkdownStorage 类型，没有像其它扩展那样为
 * @tiptap/core 的 Storage 接口补模块增强，导致 editor.storage.markdown 在整个
 * 项目里失去类型（升级前由该库旧版本的类型声明间接提供）。
 *
 * 这里按该库 addStorage() 的实际返回值补回声明：options / getMarkdown 来自它自己
 * 导出的 MarkdownStorage，parser / serializer 是它额外挂在 storage 上的解析与
 * 序列化器实例（项目需要直接取用，见 sourcePreservingSerializer.ts）。
 */
declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage & {
      /** 复用编辑器同一套 markdown-it 规则的解析器包装。 */
      parser: {
        /** markdown-it 实例，用于按 token 做块级源码映射。 */
        md: MarkdownIt;
        /** 把 Markdown 源码解析成 HTML 字符串。 */
        parse(source: string, options?: { inline?: boolean }): string;
      };
      /** 复用编辑器节点/标记规则表的 Markdown 序列化器。 */
      serializer: {
        serialize(content: ProseMirrorNode): string;
      };
    };
  }
}
