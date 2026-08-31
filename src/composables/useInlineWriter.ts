import { onUnmounted, ref } from "vue";
import { aiService } from "../services/aiService";
import { normalizeAiMarkdown } from "../utils/aiMarkdown";
import type { AiEditAction } from "../types/ai";
import type { Editor } from "@tiptap/vue-3";

export type InlineWriterStatus = "idle" | "streaming" | "done" | "error";

export interface InlineWriterOptions {
  editor: () => Editor | null;
  getSelection: () => string;
  getDocumentContext: () => string;
}

// 流式渲染节流间隔（毫秒）：流式增量往往几个字符就来一次，
// 合并到一起再统一解析渲染，避免频繁全量替换文档造成卡顿
const STREAM_RENDER_INTERVAL_MS = 100;

export const useInlineWriter = (options: InlineWriterOptions) => {
  const status = ref<InlineWriterStatus>("idle");
  const ghostText = ref("");
  const error = ref("");
  const activeRequestId = ref("");
  const currentAction = ref<AiEditAction | null>(null);
  const lastInstruction = ref<string>("");

  // 记录AI开始写入时的光标位置
  const startPos = ref<number | null>(null);
  // 记录AI写入的结束位置
  const endPos = ref<number | null>(null);

  // 待执行的流式渲染定时器句柄
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  // 取消尚未执行的流式渲染，避免清除后又把旧内容写回文档
  const cancelPendingRender = (): void => {
    if (renderTimer === null) return;
    clearTimeout(renderTimer);
    renderTimer = null;
  };

  /**
   * 把累积的AI输出整体替换进 startPos..endPos 范围。
   * tiptap-markdown 接管了 insertContentAt：传入字符串会先按 Markdown 解析，
   * 因此表格、标题、代码块等语法一旦凑齐就会实时渲染，而不是显示为纯文本。
   * withCaret 为 true 时在内容末尾显示书写位置指示条（仅流式中使用）。
   */
const renderStreamedMarkdown = (withCaret = false): void => {
  cancelPendingRender();

  const editor = options.editor();
  if (!editor || startPos.value === null || endPos.value === null || !ghostText.value) return;

  const from = startPos.value;
  const to = Math.min(endPos.value, editor.state.doc.content.size);

  let mappedFrom = from;
  let mappedTo = to;

  editor
    .chain()
    .focus()
    // 先还原模型过度转义的 \*\* 等标记，再交给 insertContentAt 按 Markdown 解析
    .insertContentAt({ from, to }, normalizeAiMarkdown(ghostText.value))
      .command(({ tr }) => {
        // 流式写入每100ms发生一次，排除出撤销历史，
        // 否则按 Ctrl+Z 会逐条回退几十次渲染记录
        tr.setMeta("addToHistory", false);
        // 借助事务映射获取替换后AI内容的真实范围：
        // 在空段落中插入块级内容时，编辑器会吞并段落边界，起始位置会前移
        mappedFrom = tr.mapping.map(from, -1);
        mappedTo = tr.mapping.map(to, 1);
        return true;
      })
      .run();

    startPos.value = mappedFrom;
    endPos.value = mappedTo;

    // 重新标记AI生成范围，高亮当前已写入的内容
    editor.commands.markAsAiGenerated(startPos.value, endPos.value, withCaret);
  };

  // 节流调度一次流式渲染，保证渲染实时感的同时控制解析频率
  const scheduleRender = (): void => {
    if (renderTimer !== null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderStreamedMarkdown(true);
    }, STREAM_RENDER_INTERVAL_MS);
  };

  const clearGhost = (): void => {
    const editor = options.editor();
    if (!editor) return;

    // 取消尚未执行的流式渲染，避免状态重置后定时器又把旧内容写回文档
    cancelPendingRender();

    // 清除AI生成标记
    editor.commands.clearAiGhostMarks();

    ghostText.value = "";
    error.value = "";
    status.value = "idle";
    activeRequestId.value = "";
    currentAction.value = null;
    startPos.value = null;
    endPos.value = null;
  };

  /**
   * 停止流式跟踪但保留错误状态与 currentAction：
   * clearGhost 会把 status 重置为 idle，出错时用它会把错误提示一并吞掉，
   * 导致提示条直接消失、用户看不到任何失败原因。
   */
  const resetStreamingState = (): void => {
    cancelPendingRender();

    const editor = options.editor();
    if (editor) editor.commands.clearAiGhostMarks();

    ghostText.value = "";
    activeRequestId.value = "";
    startPos.value = null;
    endPos.value = null;
  };

  const cancel = (): void => {
    if (!activeRequestId.value) return;
    aiService.cancel(activeRequestId.value);

    // 停止时保留已生成的部分：先把当前累积内容渲染成最终样式，再清除AI标记
    renderStreamedMarkdown();
    clearGhost();
  };

  const acceptResult = (): void => {
    if (!ghostText.value || status.value === "streaming") return;

    const editor = options.editor();
    if (!editor || startPos.value === null || endPos.value === null) return;

    // 清除AI生成标记，内容变为正式内容
    editor.commands.clearAiGhostMarks();

    ghostText.value = "";
    status.value = "idle";
    currentAction.value = null;
    startPos.value = null;
    endPos.value = null;
  };

  const rejectResult = (): void => {
    const editor = options.editor();
    if (editor && startPos.value !== null && endPos.value !== null) {
      // 拒绝时丢弃未渲染的增量，并删除文档中已写入的AI内容
      cancelPendingRender();
      const from = startPos.value;
      const to = Math.min(endPos.value, editor.state.doc.content.size);
      if (to > from) {
        editor.chain().focus().deleteRange({ from, to }).run();
      }
    }
    clearGhost();
  };

  const startWriting = async (action: AiEditAction, instruction?: string): Promise<void> => {
    const editor = options.editor();
    if (!editor) return;

    const selection = options.getSelection().trim();
    const documentContext = options.getDocumentContext().trim();

    // 如果有指令，允许空的selection和documentContext
    if (!instruction && !selection && !documentContext) {
      error.value = "请先选中文本或输入内容";
      status.value = "error";
      return;
    }

    // 清除之前的幽灵文本
    clearGhost();

    const requestId = `inline-writer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    currentAction.value = action;
    lastInstruction.value = instruction || "";
    activeRequestId.value = requestId;
    status.value = "streaming";
    ghostText.value = "";
    error.value = "";

    // 记录当前光标位置
    const { from, to } = editor.state.selection;
    startPos.value = from;

    // 如果有选区，先删除选区内容
    if (from !== to) {
      editor.chain()
        .focus()
        .deleteRange({ from, to })
        .run();
      startPos.value = from;
    }

    endPos.value = startPos.value;

    try {
      await aiService.invoke({
        requestId,
        action,
        selection: selection || undefined,
        documentContext: documentContext || undefined,
        options: {
          instruction,
        },
      });
    } catch (invokeError) {
      console.error('[useInlineWriter] invoke error:', invokeError);
      if (status.value === "streaming") {
        status.value = "error";
        error.value = invokeError instanceof Error ? invokeError.message : String(invokeError);
        // 保留错误状态供提示条展示，只停止流式跟踪
        resetStreamingState();
      }
    }
  };

  // 监听流式事件，实时更新幽灵文本
  const offDelta = aiService.onDelta((event) => {
    if (event.requestId !== activeRequestId.value) return;

    const editor = options.editor();
    if (!editor || startPos.value === null) return;

    // 只累积增量，由节流任务统一解析渲染：
    // 单个增量只是几个字符，单独解析无法凑齐表格等块级语法，
    // 必须拿累积全文整体替换才能实时渲染出样式
    ghostText.value += event.delta;
    scheduleRender();
  });

  const offDone = aiService.onDone((event) => {
    if (event.requestId !== activeRequestId.value) return;
    // 结束时立即渲染最后一次增量，保证完整内容都按Markdown样式呈现
    renderStreamedMarkdown();
    status.value = "done";
    activeRequestId.value = "";
  });

  const offError = aiService.onError((event) => {
    if (event.requestId !== activeRequestId.value) return;
    status.value = "error";
    error.value = event.error;
    // 出错时保留已生成的部分并渲染成最终样式；只停止流式跟踪，
    // 保留错误状态和 currentAction，提示条才能显示原因并支持重试
    renderStreamedMarkdown();
    resetStreamingState();
  });

  const retry = (): void => {
    if (!currentAction.value) return;
    void startWriting(currentAction.value, lastInstruction.value);
  };

  onUnmounted(() => {
    // 组件卸载时取消待执行的渲染，防止定时器访问已销毁的编辑器
    cancelPendingRender();
    if (activeRequestId.value) aiService.cancel(activeRequestId.value);
    offDelta();
    offDone();
    offError();
  });

  return {
    status,
    ghostText,
    error,
    currentAction,
    startWriting,
    acceptResult,
    rejectResult,
    retry,
    cancel,
    clearGhost,
  };
};
