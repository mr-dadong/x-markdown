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
       * 在正文写入点显示等待提示，并标出稍后会被替换的原文范围。
       */
      markAiWritingTarget: (from: number, to: number, label: string) => ReturnType;
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
  options: AiGhostMarkOptions,
  placeholder = "",
): DecorationSet => {
  const decorations: Decoration[] = [];

  if (range.from < range.to) {
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: placeholder ? "ai-writing-target" : options.ghostClass || "ai-ghost-content",
      }),
    );
  }

  if (placeholder) {
    decorations.push(
      Decoration.widget(
        range.to,
        () => {
          const span = document.createElement("span");
          span.className = "ai-writing-placeholder";

          const reasoningPrefix = "AI 思考：";
          const isReasoning = placeholder.startsWith(reasoningPrefix);
          if (isReasoning) span.classList.add("ai-writing-placeholder-reasoning");

          // 使用真实子节点拆分状态、正文与快捷键，便于稳定控制流式思考的显示宽度。
          const statusDot = document.createElement("span");
          statusDot.className = "ai-writing-placeholder-dot";
          span.append(statusDot);

          if (isReasoning) {
            const label = document.createElement("span");
            label.className = "ai-writing-placeholder-label";
            label.textContent = "思考";
            span.append(label);

            const separator = document.createElement("span");
            separator.className = "ai-writing-placeholder-separator";
            span.append(separator);
          }

          const [message, shortcutHint] = placeholder.split("，Esc ");
          const messageSpan = document.createElement("span");
          messageSpan.className = "ai-writing-placeholder-text";
          messageSpan.textContent = isReasoning ? message.slice(reasoningPrefix.length) : message;
          span.append(messageSpan);

          if (isReasoning) {
            // 与 deepseek-harness 一致：摘要视口保持固定宽度，并持续跟随当前思考行末尾。
            requestAnimationFrame(() => {
              messageSpan.scrollLeft = messageSpan.scrollWidth - messageSpan.clientWidth;
            });
          }

          if (shortcutHint) {
            const shortcut = document.createElement("kbd");
            shortcut.className = "ai-writing-placeholder-key";
            shortcut.textContent = "Esc";
            span.append(shortcut);

            const hint = document.createElement("span");
            hint.className = "ai-writing-placeholder-hint";
            hint.textContent = shortcutHint;
            span.append(hint);
          }
          return span;
        },
        { side: 1 },
      ),
    );
  }

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
  placeholder: "",
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

      markAiWritingTarget:
        (from: number, to: number, label: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(aiGhostMarkKey, {
              type: "target",
              from,
              to,
              label,
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
                  placeholder: "",
                };
              }

              if (meta.type === "target") {
                const range = { from: meta.from, to: meta.to };
                return {
                  decorations: buildDecorations(tr.doc, range, false, options, meta.label),
                  range,
                  caret: false,
                  placeholder: meta.label,
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

              if (from > to || (from === to && !value.placeholder)) {
                return { ...emptyState };
              }

              const range = { from, to };
              return {
                decorations: buildDecorations(
                  tr.doc,
                  range,
                  value.caret,
                  options,
                  value.placeholder,
                ),
                range,
                caret: value.caret,
                placeholder: value.placeholder,
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
