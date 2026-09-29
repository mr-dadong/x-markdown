import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * HTML 注释的弱化显示（照 Typora 的做法）。
 *
 * 背景：块级注释（`<!-- ... -->` 独占一行、连续几行也算）在编辑器里落成可编辑的
 * 普通段落（见 HtmlBlock 的 parseMarkdown），内容与正文长得一模一样，看不出这是
 * 写给作者自己看的备注。这里按内容给整段挂一个装饰类，样式写在
 * MarkdownEditor.vue 的 .xmd-html-comment 规则里，只做颜色弱化。
 *
 * 为什么用装饰而不是节点属性：装饰是纯视图层的显示状态 ——
 * - 不进文档模型、不参与节点指纹，增量保存与 Markdown 序列化完全不受影响；
 * - 不进入导出的 HTML/DOM 内容序列化，导出行为保持原样；
 * - 每次文档变化都按内容重算，用户把注释改写成正文后样式立即消失，
 *   不会留下「这段曾经是注释」的陈旧标记；直接手打一条注释也会立刻变灰。
 */

/** 整段就是一个或多个 HTML 注释（允许注释周围与之间只有空白）。 */
const COMMENT_ONLY_PATTERN = /^(?:<!--[\s\S]*?-->\s*)+$/u;

/** 装饰类名，与 MarkdownEditor.vue 里的样式规则对应。 */
export const HTML_COMMENT_CLASS = "xmd-html-comment";

export const htmlCommentKey = new PluginKey<DecorationSet>("xmdHtmlComment");

/** 收集文档里「整段都是 HTML 注释」的段落，逐个挂上装饰类。 */
const collectCommentDecorations = (doc: ProseMirrorNode): DecorationSet => {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    // 只有段落承载注释文本；其余节点（含列表、引用等容器）继续往下找。
    if (node.type.name !== "paragraph") return true;

    // 廉价的前置判断：正文段落基本都在这里返回，不必取整段文本做正则。
    const first = node.firstChild;
    if (!first?.isText || !(first.text ?? "").startsWith("<!--")) return true;
    if (!COMMENT_ONLY_PATTERN.test(node.textContent.trim())) return true;

    decorations.push(
      Decoration.node(position, position + node.nodeSize, { class: HTML_COMMENT_CLASS }),
    );
    return true;
  });

  return DecorationSet.create(doc, decorations);
};

export const HtmlComment = Extension.create({
  name: "htmlComment",

  addProseMirrorPlugins() {
    /*
     * 只服务于编辑区的显示：导出用的隐藏编辑器是只读的（editable: false），
     * 不需要这层装饰，免得内部类名被写进导出的 HTML。
     * 这里读 options.editable 而不是 editor.isEditable：插件是在视图建好之后才安装的，
     * 那个 getter 在此期间恒为 true（见 @tiptap/core 的 Editor.isEditable 注释）。
     */
    if (!this.editor.options.editable) return [];

    return [
      new Plugin({
        key: htmlCommentKey,
        state: {
          init: (_config, state) => collectCommentDecorations(state.doc),
          // 只有文档真的变了才重算；光标移动这类纯选区事务直接把已有装饰映射过去。
          apply: (transaction, value) =>
            transaction.docChanged
              ? collectCommentDecorations(transaction.doc)
              : value.map(transaction.mapping, transaction.doc),
        },
        props: {
          decorations: (state) => htmlCommentKey.getState(state) ?? null,
        },
      }),
    ];
  },
});
