import { Extension } from "@tiptap/core";
import { relaxMarkdownEscapes } from "./markdownSerialization";

/**
 * 放宽序列化器的保守转义（Typora 风格最小转义）。
 *
 * prosemirror-markdown 会把正文中每个字面 `*` 都转义成 `\*`，
 * 哪怕它两侧都是空白、根本不可能构成任何语法。Typora 对
 * “重点 * 请注意”这类文本保存时就不加转义。本扩展包装
 * tiptap-markdown 的序列化器，在输出（保存、复制、内容同步）
 * 前统一还原这类惰性转义，让源码模式与存盘文本更干净。
 */
export const MarkdownEscapeRelaxer = Extension.create({
  name: "markdownEscapeRelaxer",

  onCreate() {
    const storage = this.editor.storage.markdown;
    if (!storage?.serializer) return;

    const serializer = storage.serializer;
    const originalSerialize = serializer.serialize.bind(serializer);
    serializer.serialize = (content: Parameters<typeof originalSerialize>[0]) =>
      relaxMarkdownEscapes(originalSerialize(content));
  },
});
