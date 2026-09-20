import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import CodeBlockView from "../components/CodeBlockView.vue";
import { serializeFencedCodeBlock } from "./markdownSerialization";
import { jsonTextContent } from "../extensions/markdown/shared/officialMarkdown";
// 编辑器与 AI 对话共用同一份语言注册表，避免两处维护导致高亮不一致。
export { editorLowlight } from "../modules/codeBlockHighlight";

// 代码块的解析能力与 Vue 节点界面在此统一装配。
export const InteractiveCodeBlock = CodeBlockLowlight.extend({
  // 官方代码块扩展自带 renderMarkdown，这里覆盖为项目版本：
  // 按内容里最长的反引号串选择更长的围栏，避免内容中的 ``` 提前关闭代码块。
  renderMarkdown: (node) =>
    serializeFencedCodeBlock(jsonTextContent(node), String(node.attrs?.language ?? "")),

  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView);
  },
});
