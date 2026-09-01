import { onUnmounted, ref } from "vue";
import { aiService } from "../services/aiService";
import { normalizeAiMarkdown } from "../utils/aiMarkdown";
import type { AiEditAction, AiFinishReason } from "../types/ai";
import type { Editor } from "@tiptap/vue-3";
import type { Slice } from "@tiptap/pm/model";

export type InlineWriterStatus = "idle" | "streaming" | "done" | "error";

export interface InlineWriterOptions {
  editor: () => Editor | null;
  getSelection: () => string;
  getDocumentContext: () => string;
}

// 首屏优先快速出现；输出变长后逐步降低完整 Markdown 重解析频率，
// 避免长内容每几个字符就整体替换一次而拖慢编辑器。
const streamRenderInterval = (hasRenderedOutput: boolean, textLength: number): number => {
  if (!hasRenderedOutput) return 32;
  if (textLength < 600) return 80;
  if (textLength < 2400) return 140;
  return 220;
};

export const useInlineWriter = (options: InlineWriterOptions) => {
  const status = ref<InlineWriterStatus>("idle");
  const ghostText = ref("");
  const reasoningText = ref("");
  const finishReason = ref<AiFinishReason | null>(null);
  const completionTokens = ref<number | null>(null);
  const error = ref("");
  const activeRequestId = ref("");
  const currentAction = ref<AiEditAction | null>(null);
  const lastInstruction = ref<string>("");
  let originalSlice: Slice | null = null;
  let editorWasEditable = true;

  // 记录AI开始写入时的光标位置
  const startPos = ref<number | null>(null);
  // 记录AI写入的结束位置
  const endPos = ref<number | null>(null);

  // 待执行的流式渲染定时器句柄
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  // 首段正文返回前按顺序展示真实请求阶段，避免用户长时间只看到静止的“准备中”。
  let waitingMessageTimer: ReturnType<typeof setInterval> | null = null;
  let reasoningRenderTimer: ReturnType<typeof setTimeout> | null = null;
  let hasRenderedOutput = false;
  let revealWritingFrame = 0;

  // 流式内容增长后只把 AI 当前写入位置带回视口，不直接滚到整篇文档底部。
  // 这样在文档中间续写时仍停留在当前章节，同时可以实时看到新生成的文字。
  const revealWritingEnd = (position: number): void => {
    if (revealWritingFrame !== 0) cancelAnimationFrame(revealWritingFrame);
    revealWritingFrame = requestAnimationFrame(() => {
      revealWritingFrame = 0;
      const editor = options.editor();
      const scroller = editor?.view.dom.closest<HTMLElement>(".editor-scroll");
      if (!editor || !scroller) return;

      const safePosition = Math.min(position, editor.state.doc.content.size);
      const writingEnd = editor.view.coordsAtPos(safePosition);
      const viewport = scroller.getBoundingClientRect();
      const bottomGap = 24;
      const hiddenDistance = writingEnd.bottom - (viewport.bottom - bottomGap);
      if (hiddenDistance > 0) scroller.scrollTop += hiddenDistance;
    });
  };

  const restoreEditorEditing = (): void => {
    const editor = options.editor();
    if (editor && editor.isEditable !== editorWasEditable) editor.setEditable(editorWasEditable);
  };

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
    hasRenderedOutput = true;
    revealWritingEnd(endPos.value);
  };

  const stopWaitingMessages = (): void => {
    if (waitingMessageTimer === null) return;
    clearInterval(waitingMessageTimer);
    waitingMessageTimer = null;
  };

  const cancelReasoningRender = (): void => {
    if (reasoningRenderTimer === null) return;
    clearTimeout(reasoningRenderTimer);
    reasoningRenderTimer = null;
  };

  // 节流调度一次流式渲染，保证渲染实时感的同时控制解析频率
  const scheduleRender = (): void => {
    if (renderTimer !== null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderStreamedMarkdown(true);
    }, streamRenderInterval(hasRenderedOutput, ghostText.value.length));
  };

  const clearGhost = (): void => {
    const editor = options.editor();
    if (!editor) return;

    // 取消尚未执行的流式渲染，避免状态重置后定时器又把旧内容写回文档
    cancelPendingRender();
    stopWaitingMessages();
    cancelReasoningRender();

    // 清除AI生成标记
    editor.commands.clearAiGhostMarks();
    restoreEditorEditing();

    ghostText.value = "";
    reasoningText.value = "";
    finishReason.value = null;
    completionTokens.value = null;
    error.value = "";
    status.value = "idle";
    activeRequestId.value = "";
    currentAction.value = null;
    startPos.value = null;
    endPos.value = null;
    originalSlice = null;
    hasRenderedOutput = false;
  };

  /**
   * 停止流式跟踪但保留错误状态与 currentAction：
   * clearGhost 会把 status 重置为 idle，出错时用它会把错误提示一并吞掉，
   * 导致提示条直接消失、用户看不到任何失败原因。
   */
  const resetStreamingState = (): void => {
    cancelPendingRender();
    stopWaitingMessages();
    cancelReasoningRender();

    const editor = options.editor();
    if (editor) editor.commands.clearAiGhostMarks();
    restoreEditorEditing();

    ghostText.value = "";
    reasoningText.value = "";
    finishReason.value = null;
    completionTokens.value = null;
    activeRequestId.value = "";
    startPos.value = null;
    endPos.value = null;
    originalSlice = null;
    hasRenderedOutput = false;
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
    restoreEditorEditing();
    editor.commands.focus();

    ghostText.value = "";
    reasoningText.value = "";
    finishReason.value = null;
    completionTokens.value = null;
    status.value = "idle";
    currentAction.value = null;
    startPos.value = null;
    endPos.value = null;
    originalSlice = null;
    hasRenderedOutput = false;
  };

  const rejectResult = (): void => {
    const editor = options.editor();
    if (editor && startPos.value !== null && endPos.value !== null) {
      // 拒绝时丢弃未渲染的增量，并删除文档中已写入的AI内容
      cancelPendingRender();
      const from = startPos.value;
      const to = Math.min(endPos.value, editor.state.doc.content.size);
      const transaction = editor.state.tr;
      if (originalSlice) transaction.replaceRange(from, to, originalSlice);
      else if (to > from) transaction.delete(from, to);
      transaction.setMeta("addToHistory", false);
      editor.view.dispatch(transaction);
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

    // 记录当前目标范围。首个正文增量到达前保留原文，避免模型思考时页面突然空白。
    const { from, to } = editor.state.selection;
    startPos.value = from;
    endPos.value = to;
    originalSlice = editor.state.doc.slice(from, to);
    editorWasEditable = editor.isEditable;

    const waitingMessages = from === to
      ? ["已读取当前上下文", "请求已发送，正在等待模型响应", "模型仍在处理，请稍候"]
      : ["已读取选中内容", "请求已发送，正在等待模型响应", "模型仍在处理，原文保持不变"];
    let waitingMessageIndex = 0;
    const showWaitingMessage = (): void => {
      editor.commands.markAiWritingTarget(
        from,
        to,
        waitingMessages[waitingMessageIndex],
      );
    };
    showWaitingMessage();
    waitingMessageTimer = setInterval(() => {
      if (waitingMessageIndex >= waitingMessages.length - 1) {
        stopWaitingMessages();
        return;
      }
      waitingMessageIndex += 1;
      showWaitingMessage();
    }, 1800);
    // 未决的 AI 变更使用固定文档坐标；临时锁定正文可避免用户输入导致范围错位或覆盖。
    editor.setEditable(false);

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

    // 首个增量证明模型已经响应；短暂更新阶段文字，随后由正文流式内容替换。
    if (!ghostText.value) {
      stopWaitingMessages();
      cancelReasoningRender();
      editor.commands.markAiWritingTarget(
        startPos.value,
        endPos.value ?? startPos.value,
        "模型已响应，正在写入",
      );
    }

    // 只累积增量，由节流任务统一解析渲染：
    // 单个增量只是几个字符，单独解析无法凑齐表格等块级语法，
    // 必须拿累积全文整体替换才能实时渲染出样式
    ghostText.value += event.delta;
    scheduleRender();
  });

  const offReasoningDelta = aiService.onReasoningDelta((event) => {
    if (event.requestId !== activeRequestId.value || ghostText.value) return;

    reasoningText.value += event.delta;
    stopWaitingMessages();
    if (reasoningRenderTimer !== null) return;

    // 合并高频推理 token，只展示最近一段实际返回的内容，不写入 Markdown 文档。
    reasoningRenderTimer = setTimeout(() => {
      reasoningRenderTimer = null;
      const editor = options.editor();
      if (!editor || startPos.value === null || endPos.value === null || ghostText.value) return;
      // 保留当前完整思考行，不再按字符数从中间截断；换行时滚动到模型最新输出的一行。
      const reasoningLines = reasoningText.value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const visibleText = reasoningLines.at(-1) ?? "";
      if (!visibleText) return;
      editor.commands.markAiWritingTarget(
        startPos.value,
        endPos.value,
        `AI 思考：${visibleText}`,
      );
    }, 120);
  });

  const offDone = aiService.onDone((event) => {
    if (event.requestId !== activeRequestId.value) return;
    // 结束时立即渲染最后一次增量，保证完整内容都按Markdown样式呈现
    renderStreamedMarkdown();
    finishReason.value = event.finishReason ?? "unknown";
    completionTokens.value = event.completionTokens ?? null;
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
    stopWaitingMessages();
    cancelReasoningRender();
    if (revealWritingFrame !== 0) cancelAnimationFrame(revealWritingFrame);
    if (activeRequestId.value) aiService.cancel(activeRequestId.value);
    offDelta();
    offReasoningDelta();
    offDone();
    offError();
  });

  return {
    status,
    ghostText,
    error,
    finishReason,
    completionTokens,
    currentAction,
    startWriting,
    acceptResult,
    rejectResult,
    retry,
    cancel,
    clearGhost,
  };
};
