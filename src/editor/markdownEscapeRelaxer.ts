import { Extension } from "@tiptap/core";
import { relaxMarkdownEscapes } from "./markdownSerialization";

/**
 * 放宽序列化器的保守转义（Typora 风格最小转义）。
 *
 * 官方 @tiptap/markdown 会把正文里每个字面 `*` 都转义成 `\*`，哪怕它两侧都是空白、
 * 根本不可能构成任何语法。Typora 对“重点 * 请注意”这类文本保存时就不加转义。
 * 本扩展在输出（保存、复制、内容同步）前统一还原这类惰性转义，让源码模式与
 * 存盘文本更干净。
 *
 * 转义规则本身与解析侧的保真补丁都在 createEditorExtensions 里安装
 * （见 markdownTextEscaping.ts 与 markdownInlineHtmlLiteral.ts）—— 它们覆盖官方
 * MarkdownManager 的原型方法，必须早于任何 Editor 构造，不能放在本扩展的钩子里。
 * 本扩展只负责需要 manager 实例的序列化包装。
 */
export const MarkdownEscapeRelaxer = Extension.create({
  name: "markdownEscapeRelaxer",

  onCreate() {
    // 官方把序列化统一收敛到 storage.markdown.manager.serialize，
    // editor.getMarkdown() 也是直接委托给它，因此包装这里即可覆盖全部输出路径。
    // 序列化都发生在 Editor 创建之后，onCreate 的时机足够。
    const manager = this.editor.storage.markdown?.manager;
    if (!manager) return;

    const originalSerialize = manager.serialize.bind(manager);
    manager.serialize = (docOrContent: Parameters<typeof originalSerialize>[0]) =>
      relaxMarkdownEscapes(originalSerialize(docOrContent));
  },
});
