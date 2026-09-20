import { Extension } from "@tiptap/core";
import { relaxMarkdownEscapes } from "./markdownSerialization";
import { installMinimalTextEscaping } from "./markdownTextEscaping";

/**
 * 放宽序列化器的保守转义（Typora 风格最小转义）。
 *
 * 官方 @tiptap/markdown 会把正文里每个字面 `*` 都转义成 `\*`，哪怕它两侧都是空白、
 * 根本不可能构成任何语法。Typora 对“重点 * 请注意”这类文本保存时就不加转义。
 * 本扩展在输出（保存、复制、内容同步）前统一还原这类惰性转义，让源码模式与
 * 存盘文本更干净。
 *
 * 另外接管正文文本节点本身的转义规则：反斜杠只在 Markdown 会误解时才写成 `\\`，
 * `<` 只在可能开启 HTML 时才写成 `\<`，不再无差别地输出 `\\` 与 `&lt;`
 * （详见 markdownTextEscaping.ts）。
 */
export const MarkdownEscapeRelaxer = Extension.create({
  name: "markdownEscapeRelaxer",

  onCreate() {
    // 覆盖官方 manager 原型的文本转义（幂等，内部只安装一次）。
    installMinimalTextEscaping();

    // 官方把序列化统一收敛到 storage.markdown.manager.serialize，
    // editor.getMarkdown() 也是直接委托给它，因此包装这里即可覆盖全部输出路径。
    const manager = this.editor.storage.markdown?.manager;
    if (!manager) return;

    const originalSerialize = manager.serialize.bind(manager);
    manager.serialize = (docOrContent: Parameters<typeof originalSerialize>[0]) =>
      relaxMarkdownEscapes(originalSerialize(docOrContent));
  },
});
