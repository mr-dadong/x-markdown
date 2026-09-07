import { computed, onUnmounted, ref, type Ref } from "vue";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@codemirror/view";
import type { SourceEditorHandle } from "../types/editor";
import type { OpenDocument } from "../types";
import { FIND_REPLACE_EDIT_META } from "../constants";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// 一次匹配在当前文档中的起止位置，字符偏移与 ProseMirror 文档位置一致。
// documentId 标识匹配所属的标签页；查找替换只针对当前文档，所有匹配属于同一标签页。
export interface FindMatch {
  from: number;
  to: number;
  documentId: number;
}

// 查找高亮通过事务 meta 传给插件，文档被编辑时高亮会随映射自动平移。
const findReplaceKey = new PluginKey("xmd-find-replace");

const findReplacePlugin = new Plugin({
  key: findReplaceKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, value) => {
      const meta = tr.getMeta(findReplaceKey) as
        | { decorations?: DecorationSet }
        | undefined;
      if (meta?.decorations) return meta.decorations.map(tr.mapping, tr.doc);
      return value.map(tr.mapping, tr.doc);
    },
  },
  props: {
    decorations: (state) =>
      findReplaceKey.getState(state) ?? DecorationSet.empty,
  },
});

// 在单个文本片段内收集全部匹配；跨节点文本（例如加粗与普通文字交界处）不参与匹配。
const collectTextMatches = (
  text: string,
  query: string,
  caseSensitive: boolean,
): { from: number; to: number }[] => {
  const matches: { from: number; to: number }[] = [];
  if (!query) return matches;
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let offset = 0;
  while (true) {
    const found = source.indexOf(needle, offset);
    if (found === -1) break;
    matches.push({ from: found, to: found + needle.length });
    offset = found + needle.length;
  }
  return matches;
};

// 富文本模式：遍历当前编辑器文档的全部文本节点，把节点内的局部偏移换算成文档位置。
const collectEditorMatches = (
  editor: Editor,
  query: string,
  caseSensitive: boolean,
  documentId: number,
): FindMatch[] => {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    collectTextMatches(node.text, query, caseSensitive).forEach((match) => {
      matches.push({
        from: pos + match.from,
        to: pos + match.to,
        documentId,
      });
    });
  });
  return matches;
};

// 提供给面板组件和编辑视图使用的完整接口。
export interface FindReplaceController {
  isOpen: Ref<boolean>;
  query: Ref<string>;
  replacement: Ref<string>;
  caseSensitive: Ref<boolean>;
  currentIndex: Ref<number>;
  matchCount: Ref<number>;
  // 每次打开面板时递增，组件据此把焦点还给查找输入框。
  focusRequest: Ref<number>;
  open: () => void;
  close: () => void;
  toggleCaseSensitive: () => void;
  goToNext: () => void;
  goToPrev: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
  refresh: () => void;
}

export const useFindReplace = (
  getEditor: () => Editor | null,
  getSourceHandle: () => SourceEditorHandle | null,
  isSourceMode: Ref<boolean>,
  // 读取打开的文档与当前文档 id，用于确认当前文件的内容。
  getDocuments: () => OpenDocument[],
  getActiveDocumentId: () => number | null,
): FindReplaceController => {
  const isOpen = ref(false);
  const query = ref("");
  const replacement = ref("");
  const caseSensitive = ref(false);
  const matches = ref<FindMatch[]>([]);
  const currentIndex = ref(0);
  const focusRequest = ref(0);

  const matchCount = computed(() => matches.value.length);

  // 刷新合成器：替换后以替换起点为锚，跳到锚之后的第一个匹配；越界时回到开头。
  const resolveCurrentIndex = (
    collected: FindMatch[],
    anchor?: number,
  ): number => {
    if (collected.length === 0) return 0;
    if (anchor !== undefined) {
      // 锚点是当前文档内替换刚发生的位置，跳到其后第一个匹配。
      const activeId = getActiveDocumentId();
      const next = collected.findIndex(
        (match) => match.documentId === activeId && match.from >= anchor,
      );
      return next === -1 ? 0 : next;
    }
    if (currentIndex.value >= collected.length) return 0;
    return currentIndex.value;
  };

  const ensurePlugin = (editor: Editor): void => {
    // 插件注册后能通过 key 取到状态，据此避免重复注册。
    if (findReplaceKey.getState(editor.state) === undefined) {
      editor.registerPlugin(findReplacePlugin);
    }
  };

  // 把匹配集合渲染成行内高亮，当前项使用更醒目的颜色区分。
  const setEditorDecorations = (
    editor: Editor,
    collected: FindMatch[],
    current: number,
  ): void => {
    const decorations = collected.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === current ? "xmd-find-current" : "xmd-find-match",
      }),
    );
    editor.view.dispatch(
      editor.state.tr.setMeta(findReplaceKey, {
        decorations: DecorationSet.create(editor.state.doc, decorations),
      }),
    );
  };

  // 汇总当前文档的匹配：查找、计数、高亮、替换全部只基于当前文件，
  // 避免出现“搜索横跨所有标签页、全部替换却只替换当前文件”的范围不一致问题。
  const collectAllMatches = (): FindMatch[] => {
    const queryValue = query.value;
    if (!queryValue) return [];
    const activeId = getActiveDocumentId();
    if (activeId === null) return [];
    const collected: FindMatch[] = [];
    const collectText = (text: string): void => {
      collectTextMatches(text, queryValue, caseSensitive.value).forEach(
        (match) => collected.push({ ...match, documentId: activeId }),
      );
    };

    if (!isSourceMode.value) {
      const editor = getEditor();
      if (editor) {
        collected.push(
          ...collectEditorMatches(
            editor,
            queryValue,
            caseSensitive.value,
            activeId,
          ),
        );
      } else {
        const activeDoc = getDocuments().find((doc) => doc.id === activeId);
        if (activeDoc) collectText(activeDoc.content);
      }
    } else {
      const sourceView = getSourceHandle()?.getView() ?? null;
      if (sourceView) {
        collectText(sourceView.state.doc.toString());
      } else {
        const activeDoc = getDocuments().find((doc) => doc.id === activeId);
        if (activeDoc) collectText(activeDoc.content);
      }
    }
    return collected;
  };

  // 为当前文档渲染高亮（查找只针对当前文档，匹配全部属于当前标签页）。
  const renderActiveDecorations = (): void => {
    const activeId = getActiveDocumentId();
    const activeMatches = matches.value.filter(
      (match) => match.documentId === activeId,
    );
    const currentInDoc = activeMatches.indexOf(matches.value[currentIndex.value]);
    if (isSourceMode.value) {
      const handle = getSourceHandle();
      if (!handle) return;
      const sourceView = handle.getView();
      if (!sourceView) return;
      handle.updateSearch(activeMatches, currentInDoc);
    } else {
      const editor = getEditor();
      if (!editor) return;
      ensurePlugin(editor);
      setEditorDecorations(editor, activeMatches, currentInDoc);
    }
  };

  // 立即刷新，替换等需要拿到最新匹配列表的操作必须走这里。
  const refreshNow = (anchor?: number): void => {
    if (!isOpen.value) return;
    matches.value = collectAllMatches();
    currentIndex.value = resolveCurrentIndex(matches.value, anchor);
    renderActiveDecorations();
  };

  // 查找需要遍历全文；连续输入时稍后只扫描最终内容，给编辑器绘制留出时间。
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (): void => {
    if (!isOpen.value) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshNow();
      // 输入关键词后自动滚动到第一个匹配，避免内容在视口外时用户看不到跳转
      void jumpToCurrent();
    }, 120);
  };

  // 富文本模式：选中匹配并把匹配块滚入可视区。
  // ProseMirror 只在浏览器选区位于编辑器内时才会执行滚动（scrollToSelection 的
  // 前置条件），而查找输入框持有焦点时该条件不成立，因此额外用 DOM 滚动兜底，
  // 保证任意焦点状态下点击“下一个”都能跳转。
  const goToEditorMatch = (editor: Editor, match: FindMatch): void => {
    editor.view.dispatch(
      editor.state.tr
        .setSelection(
          TextSelection.create(editor.state.doc, match.from, match.to),
        )
        .scrollIntoView(),
    );
    const domPosition = editor.view.domAtPos(match.from);
    const element =
      domPosition.node.nodeType === Node.TEXT_NODE
        ? domPosition.node.parentElement
        : (domPosition.node as HTMLElement | null);
    element?.scrollIntoView({ block: "nearest" });
  };

  // 源码模式：选中匹配并滚动到对应行。
  // CodeMirror 自带的 scrollIntoView 依赖测量循环，在当前应用中可能长时间不生效，
  // 这里按行号估算滚动位置，再等目标行渲染后做一次精确对齐。
  const scrollSourceToMatch = (
    sourceView: EditorView,
    match: FindMatch,
  ): void => {
    sourceView.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
    });
    const scroller = sourceView.scrollDOM;
    const line = sourceView.state.doc.lineAt(match.from);
    // 行高与内边距与源码主题保持一致，避免硬编码数值与样式脱节。
    const lineHeight =
      Number.parseFloat(getComputedStyle(scroller).lineHeight) || 24;
    const contentStyle = getComputedStyle(sourceView.contentDOM);
    const paddingTop = Number.parseFloat(contentStyle.paddingTop) || 16;
    const targetTop =
      (line.number - 1) * lineHeight + paddingTop - scroller.clientHeight / 2;
    scroller.scrollTop = Math.max(
      0,
      Math.min(scroller.scrollHeight - scroller.clientHeight, targetTop),
    );
    // 目标行渲染完成后，用原生滚动精确对齐（对折行等高度偏差做校正）。
    // 使用 setTimeout 而不是 rAF：窗口隐藏时 rAF 不触发，滚动校正会被跳过。
    setTimeout(() => {
      const domPosition = sourceView.domAtPos(match.from);
      if (!domPosition) return;
      const lineElement = domPosition.node as HTMLElement;
      const block =
        lineElement.nodeType === Node.TEXT_NODE
          ? lineElement.parentElement
          : lineElement;
      block?.scrollIntoView({ block: "nearest" });
    }, 0);
  };

  const scrollToMatch = (match: FindMatch): void => {
    if (isSourceMode.value) {
      const sourceView = getSourceHandle()?.getView() ?? null;
      if (sourceView) scrollSourceToMatch(sourceView, match);
      return;
    }
    const editor = getEditor();
    if (editor) goToEditorMatch(editor, match);
  };

  // 跳转到当前匹配：查找只针对当前文档，匹配必定在本视图内，直接滚动定位。
  const jumpToCurrent = async (): Promise<void> => {
    const match = matches.value[currentIndex.value];
    if (!match) return;
    scrollToMatch(match);
  };

  const goToNext = (): void => {
    if (matches.value.length === 0) return;
    currentIndex.value = (currentIndex.value + 1) % matches.value.length;
    refreshNow();
    void jumpToCurrent();
  };

  const goToPrev = (): void => {
    if (matches.value.length === 0) return;
    currentIndex.value =
      (currentIndex.value - 1 + matches.value.length) % matches.value.length;
    refreshNow();
    void jumpToCurrent();
  };

  const toggleCaseSensitive = (): void => {
    caseSensitive.value = !caseSensitive.value;
    currentIndex.value = 0;
    refreshNow();
    void jumpToCurrent();
  };

  const replaceCurrent = (): void => {
    // 查找只针对当前文档，匹配必定在当前视图内，直接替换即可。
    const match = matches.value[currentIndex.value];
    if (!match) return;
    performReplaceCurrent(match);
  };

  const performReplaceCurrent = (match: FindMatch): void => {
    const anchorFrom = match.from;
    const editor = getEditor();

    if (isSourceMode.value) {
      const handle = getSourceHandle();
      const sourceView = handle?.getView() ?? null;
      if (!sourceView) return;
      // 替换当前匹配，光标停留在替换文本之后，方便继续查看上下文。
      sourceView.dispatch({
        changes: { from: match.from, to: match.to, insert: replacement.value },
        selection: { anchor: match.from + replacement.value.length },
        scrollIntoView: true,
      });
    } else {
      if (!editor) return;
      // 一次事务完成替换，撤销时能一步回到替换前的内容。
      // 查找输入框持有焦点时编辑器未聚焦，带上 FIND_REPLACE_EDIT_META 标记，
      // 让 onUpdate 仍把这次替换当作用户编辑同步给文档层。
      editor.view.dispatch(
        editor.state.tr
          .setMeta(FIND_REPLACE_EDIT_META, true)
          .insertText(replacement.value, match.from, match.to),
      );
    }

    // 文档内容已变化，重新收集匹配并跳到替换位置之后的第一个匹配。
    refreshNow(anchorFrom);
    void jumpToCurrent();
  };

  const replaceAll = (): void => {
    const editor = getEditor();

    if (isSourceMode.value) {
      const handle = getSourceHandle();
      const sourceView = handle?.getView() ?? null;
      if (!sourceView) return;
      const collected = collectTextMatches(
        sourceView.state.doc.toString(),
        query.value,
        caseSensitive.value,
      );
      if (collected.length === 0) return;
      // 所有替换位置都基于同一份原始文档，可以在一个事务里从后往前合并。
      const changes = collected.map((item) => ({
        from: item.from,
        to: item.to,
        insert: replacement.value,
      }));
      sourceView.dispatch({ changes });
      refreshNow();
      return;
    }

    if (!editor) return;
    const collected = collectEditorMatches(
      editor,
      query.value,
      caseSensitive.value,
      getActiveDocumentId() ?? -1,
    );
    if (collected.length === 0) return;
    // 从后往前合并进同一个事务，前面的位置不受后面替换的影响。
    // 编辑器未聚焦时也要让这次替换同步给文档层，标记作用同“替换当前匹配”。
    let tr = editor.state.tr.setMeta(FIND_REPLACE_EDIT_META, true);
    for (let i = collected.length - 1; i >= 0; i--) {
      tr = tr.insertText(replacement.value, collected[i].from, collected[i].to);
    }
    editor.view.dispatch(tr);
    refreshNow();
  };

  const open = (): void => {
    isOpen.value = true;
    focusRequest.value += 1;
    refreshNow();
    void jumpToCurrent();
  };

  const close = (): void => {
    isOpen.value = false;
    matches.value = [];
    currentIndex.value = 0;
    // 清空富文本高亮，避免关闭面板后残留黄色标记。
    const editor = getEditor();
    if (editor) {
      editor.view.dispatch(
        editor.state.tr.setMeta(findReplaceKey, {
          decorations: DecorationSet.empty,
        }),
      );
    }
    // 清空源码模式的搜索装饰
    const handle = getSourceHandle();
    handle?.clearSearch();
  };

  onUnmounted(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    // EditorView 卸载时子编辑器组件已先销毁，unregisterPlugin 内部有 isDestroyed 守卫；
    // 若编辑器仍存活则主动注销查找插件，避免高亮装饰残留。
    getEditor()?.unregisterPlugin(findReplaceKey);
  });

  return {
    isOpen,
    query,
    replacement,
    caseSensitive,
    currentIndex,
    matchCount,
    focusRequest,
    open,
    close,
    toggleCaseSensitive,
    goToNext,
    goToPrev,
    replaceCurrent,
    replaceAll,
    refresh,
  };
};
