import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface GhostDecorationOptions {
  /**
   * 幽灵文本的CSS类名
   */
  ghostClass?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ghostDecoration: {
      /**
       * 设置幽灵文本
       */
      setGhostText: (text: string, from: number) => ReturnType;
      /**
       * 清除幽灵文本
       */
      clearGhostText: () => ReturnType;
      /**
       * 接受幽灵文本（移除装饰但保留文本）
       */
      acceptGhostText: () => ReturnType;
    };
  }
}

const ghostDecorationKey = new PluginKey("ghostDecoration");

export const GhostDecoration = Extension.create<GhostDecorationOptions>({
  name: "ghostDecoration",

  addOptions() {
    return {
      ghostClass: "ai-ghost-text",
    };
  },

  addCommands() {
    return {
      setGhostText:
        (text: string, from: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // 存储幽灵文本信息到meta
            tr.setMeta(ghostDecorationKey, {
              type: "set",
              text,
              from,
            });
            dispatch(tr);
          }
          return true;
        },

      clearGhostText:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(ghostDecorationKey, { type: "clear" });
            dispatch(tr);
          }
          return true;
        },

      acceptGhostText:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(ghostDecorationKey, { type: "accept" });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: ghostDecorationKey,

        state: {
          init() {
            return {
              decorations: DecorationSet.empty,
              ghostText: "",
              ghostFrom: 0,
              ghostTo: 0,
            };
          },

          apply(tr, value) {
            const meta = tr.getMeta(ghostDecorationKey);

            if (meta) {
              if (meta.type === "set") {
                // 设置幽灵文本装饰
                const { text, from } = meta;
                const decorations = [
                  Decoration.widget(from, () => {
                    const span = document.createElement("span");
                    span.className = options.ghostClass || "ai-ghost-text";
                    span.textContent = text;
                    span.style.cssText = `
                      color: var(--color-muted);
                      opacity: 0.6;
                      font-style: italic;
                      pointer-events: none;
                      user-select: none;
                    `;
                    return span;
                  }),
                ];

                return {
                  decorations: DecorationSet.create(tr.doc, decorations),
                  ghostText: text,
                  ghostFrom: from,
                  ghostTo: from,
                };
              }

              if (meta.type === "clear") {
                return {
                  decorations: DecorationSet.empty,
                  ghostText: "",
                  ghostFrom: 0,
                  ghostTo: 0,
                };
              }

              if (meta.type === "accept") {
                // 接受时清除装饰但保留文本
                return {
                  decorations: DecorationSet.empty,
                  ghostText: "",
                  ghostFrom: 0,
                  ghostTo: 0,
                };
              }
            }

            // 文档变化时更新装饰位置
            if (value.ghostText && tr.docChanged) {
              const newFrom = tr.mapping.map(value.ghostFrom);
              const newTo = tr.mapping.map(value.ghostTo);

              if (newFrom !== value.ghostFrom || newTo !== value.ghostTo) {
                const decorations = [
                  Decoration.widget(newFrom, () => {
                    const span = document.createElement("span");
                    span.className = options.ghostClass || "ai-ghost-text";
                    span.textContent = value.ghostText;
                    span.style.cssText = `
                      color: var(--color-muted);
                      opacity: 0.6;
                      font-style: italic;
                      pointer-events: none;
                      user-select: none;
                    `;
                    return span;
                  }),
                ];

                return {
                  decorations: DecorationSet.create(tr.doc, decorations),
                  ghostText: value.ghostText,
                  ghostFrom: newFrom,
                  ghostTo: newTo,
                };
              }
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
