import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface AiGhostMarkOptions {
  /**
   * AI生成内容的CSS类名
   */
  ghostClass?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiGhostMark: {
      /**
       * 标记当前选区为AI生成内容
       */
      markAsAiGenerated: (from: number, to: number) => ReturnType;
      /**
       * 清除AI生成标记
       */
      clearAiGhostMarks: () => ReturnType;
    };
  }
}

const aiGhostMarkKey = new PluginKey("aiGhostMark");

export const AiGhostMark = Extension.create<AiGhostMarkOptions>({
  name: "aiGhostMark",

  addOptions() {
    return {
      ghostClass: "ai-ghost-content",
    };
  },

  addCommands() {
    return {
      markAsAiGenerated:
        (from: number, to: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(aiGhostMarkKey, {
              type: "mark",
              from,
              to,
            });
            dispatch(tr);
          }
          return true;
        },

      clearAiGhostMarks:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(aiGhostMarkKey, { type: "clear" });
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
        key: aiGhostMarkKey,

        state: {
          init() {
            return {
              decorations: DecorationSet.empty,
              ranges: [] as Array<{ from: number; to: number }>,
            };
          },

          apply(tr, value) {
            const meta = tr.getMeta(aiGhostMarkKey);

            if (meta) {
              if (meta.type === "mark") {
                const { from, to } = meta;
                const decoration = Decoration.inline(from, to, {
                  class: options.ghostClass || "ai-ghost-content",
                });
                const newRanges = [...value.ranges, { from, to }];
                return {
                  decorations: DecorationSet.create(tr.doc, [decoration]),
                  ranges: newRanges,
                };
              }

              if (meta.type === "clear") {
                return {
                  decorations: DecorationSet.empty,
                  ranges: [],
                };
              }
            }

            // 文档变化时更新装饰位置
            if (value.ranges.length > 0 && tr.docChanged) {
              const newRanges = value.ranges
                .map((range) => ({
                  from: tr.mapping.map(range.from),
                  to: tr.mapping.map(range.to),
                }))
                .filter((range) => range.from < range.to);

              if (newRanges.length === 0) {
                return {
                  decorations: DecorationSet.empty,
                  ranges: [],
                };
              }

              const decorations = newRanges.map((range) =>
                Decoration.inline(range.from, range.to, {
                  class: options.ghostClass || "ai-ghost-content",
                })
              );

              return {
                decorations: DecorationSet.create(tr.doc, decorations),
                ranges: newRanges,
              };
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
