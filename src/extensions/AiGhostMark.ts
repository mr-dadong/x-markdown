import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface AiGhostMarkOptions {
  /**
   * AI生成内容的CSS类名
   */
  ghostClass?: string;
  /**
   * 书写位置指示条的CSS类名
   */
  caretClass?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiGhostMark: {
      /**
       * 标记指定范围为AI生成内容；withCaret 为 true 时在范围末尾显示书写位置指示条
       */
      markAsAiGenerated: (from: number, to: number, withCaret?: boolean) => ReturnType;
      /**
       * 清除AI生成标记
       */
      clearAiGhostMarks: () => ReturnType;
    };
  }
}

const aiGhostMarkKey = new PluginKey("aiGhostMark");

// 构建装饰集合：范围整体加行内背景高亮，可选在范围末尾追加书写位置指示条
const buildDecorations = (
  doc: ProseMirrorNode,
  range: { from: number; to: number },
  withCaret: boolean,
  options: AiGhostMarkOptions
): DecorationSet => {
  const decorations: Decoration[] = [
    Decoration.inline(range.from, range.to, {
      class: options.ghostClass || "ai-ghost-content",
    }),
  ];

  if (withCaret) {
    decorations.push(
      Decoration.widget(
        range.to,
        () => {
          const span = document.createElement("span");
          span.className = options.caretClass || "ai-ghost-caret";
          return span;
        },
        // side 为 1：该位置插入新内容时，指示条保持在内容之后
        { side: 1 }
      )
    );
  }

  return DecorationSet.create(doc, decorations);
};

const emptyState = {
  decorations: DecorationSet.empty,
  range: null as { from: number; to: number } | null,
  caret: false,
};

export const AiGhostMark = Extension.create<AiGhostMarkOptions>({
  name: "aiGhostMark",

  addOptions() {
    return {
      ghostClass: "ai-ghost-content",
      caretClass: "ai-ghost-caret",
    };
  },

  addCommands() {
    return {
      markAsAiGenerated:
        (from: number, to: number, withCaret = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(aiGhostMarkKey, {
              type: "mark",
              from,
              to,
              caret: withCaret,
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
            return { ...emptyState };
          },

          apply(tr, value) {
            const meta = tr.getMeta(aiGhostMarkKey);

            if (meta) {
              if (meta.type === "mark") {
                const range = { from: meta.from, to: meta.to };
                // 流式渲染每次都会重新标记完整的AI范围，直接覆盖旧范围，
                // 避免范围数组不断累积产生重叠装饰
                return {
                  decorations: buildDecorations(tr.doc, range, meta.caret, options),
                  range,
                  caret: meta.caret,
                };
              }

              if (meta.type === "clear") {
                return { ...emptyState };
              }
            }

            // 文档变化时更新装饰位置
            if (value.range && tr.docChanged) {
              const from = tr.mapping.map(value.range.from);
              const to = tr.mapping.map(value.range.to);

              if (from >= to) {
                return { ...emptyState };
              }

              const range = { from, to };
              return {
                decorations: buildDecorations(tr.doc, range, value.caret, options),
                range,
                caret: value.caret,
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
