import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import CodeBlockView from "../components/CodeBlockView.vue";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { serializeFencedCodeBlock } from "./markdownSerialization";
// 编辑器与 AI 对话共用同一份语言注册表，避免两处维护导致高亮不一致。
export { editorLowlight } from "../modules/codeBlockHighlight";

// 代码块的解析能力与 Vue 节点界面在此统一装配。
export const InteractiveCodeBlock = CodeBlockLowlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const content = node.textContent;
          const language = String(node.attrs.language ?? "");

          state.write(serializeFencedCodeBlock(content, language));
          state.closeBlock(node);
        },
        parse: {
          setup(
            this: { options: { languageClassPrefix?: string } },
            markdown: { set: (options: { langPrefix: string }) => void },
          ) {
            markdown.set({
              langPrefix: this.options.languageClassPrefix ?? "language-",
            });
          },
          updateDOM(element: HTMLElement) {
            /*
             * markdown-it 会在代码内容末尾附加一个用于连接关闭围栏的结构性换行。
             * 这里只删除这一个换行，用户实际输入的尾随空行仍会保留。
             */
            element.querySelectorAll("pre > code").forEach((codeElement) => {
              const lastChild = codeElement.lastChild;
              if (lastChild?.nodeType !== Node.TEXT_NODE) return;
              lastChild.textContent = lastChild.textContent?.replace(/\n$/u, "") ?? "";
            });
          },
        },
      },
    };
  },
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView);
  },
});
