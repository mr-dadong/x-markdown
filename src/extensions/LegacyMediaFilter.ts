import { Extension } from "@tiptap/core";

// 新软件只接受标准 Markdown 兼容链接，旧私有 HTML 节点在进入编辑器前直接移除。
export const LegacyMediaFilter = Extension.create({
  name: "legacyMediaFilter",
  priority: 1100,

  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            element
              .querySelectorAll(
                "div[data-xmd-attachment]:not([data-xmd-compatible-attachment]), video:not([data-xmd-compatible-video])",
              )
              .forEach((legacyNode) => legacyNode.remove());
          },
        },
      },
    };
  },
});
