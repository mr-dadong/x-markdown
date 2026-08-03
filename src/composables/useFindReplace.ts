import { computed, onUnmounted, ref, type Ref } from "vue";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// 一次匹配在文档中的起止位置，字符偏移与 ProseMirror 文档位置一致。
export interface FindMatch {
  from: number;
  to: number;
}

// 查找高亮通过事务 meta 传给插件，文档被编辑时高亮会随映射自动平移。
const findReplaceKey = new PluginKey("xmd-find-replace");

const findReplacePlugin = new Plugin({
  key: findReplaceKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, value) => {
      const meta = tr.getMeta(findReplaceKey) as { decorations?: DecorationSet } | undefined;
      if (meta?.decorations) return meta.decorations.map(tr.mapping, tr.doc);
      return value.map(tr.mapping, tr.doc);
    },
  },
  props: {
    decorations: (state) => findReplaceKey.getState(state) ?? DecorationSet.empty,
  },
});

// 在单个文本片段内收集全部匹配；跨节点文本（例如加粗与普通文字交界处）不参与匹配。
const collectTextMatches = (text: string, query: string, caseSensitive: boolean): FindMatch[] => {
  const matches: FindMatch[] = [];
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

// 富文本模式：遍历文档的全部文本节点，把节点内的局部偏移换算成文档位置。
const collectEditorMatches = (
  editor: Editor,
  query: string,
  caseSensitive: boolean,
): FindMatch[] => {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    collectTextMatches(node.text, query, caseSensitive).forEach((match) => {
      matches.push({ from: pos + match.from, to: pos + match.to });
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
  getSourceTextarea: () => HTMLTextAreaElement | null,
  isSourceMode: Ref<boolean>,
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
  const resolveCurrentIndex = (collected: FindMatch[], anchor?: number): number => {
    if (collected.length === 0) return 0;
    if (anchor !== undefined) {
      const next = collected.findIndex((match) => match.from >= anchor);
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
  const setEditorDecorations = (editor: Editor, collected: FindMatch[], current: number): void => {
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

  const refreshEditor = (anchor?: number): void => {
    const editor = getEditor();
    if (!editor) {
      matches.value = [];
      currentIndex.value = 0;
      return;
    }
    ensurePlugin(editor);
    const collected = collectEditorMatches(editor, query.value, caseSensitive.value);
    matches.value = collected;
    currentIndex.value = resolveCurrentIndex(collected, anchor);
    setEditorDecorations(editor, collected, currentIndex.value);
  };

  const refreshSource = (anchor?: number): void => {
    const textarea = getSourceTextarea();
    if (!textarea) {
      matches.value = [];
      currentIndex.value = 0;
      return;
    }
    const collected = collectTextMatches(textarea.value, query.value, caseSensitive.value);
    matches.value = collected;
    currentIndex.value = resolveCurrentIndex(collected, anchor);
  };

  // 立即刷新，替换等需要拿到最新匹配列表的操作必须走这里。
  const refreshNow = (anchor?: number): void => {
    if (!isOpen.value) return;
    if (isSourceMode.value) refreshSource(anchor);
    else refreshEditor(anchor);
  };

  // 输入和文档变化会高频触发刷新，合并到同一帧执行避免大文档反复全量扫描。
  let refreshFrame: number | null = null;
  const refresh = (): void => {
    if (!isOpen.value) return;
    if (refreshFrame !== null) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      refreshNow();
    });
  };

  // 跳转到当前匹配：富文本模式选中并滚动，源码模式定位选区并估算滚动位置。
  const goToEditorMatch = (editor: Editor, match: FindMatch): void => {
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
        .scrollIntoView(),
    );
  };

  const scrollSourceToMatch = (textarea: HTMLTextAreaElement, match: FindMatch): void => {
    textarea.setSelectionRange(match.from, match.to);
    // 通过目标行号估算滚动位置，让匹配行尽量出现在可视区域中间。
    const textBefore = textarea.value.slice(0, match.from);
    const targetLine = textBefore.split("\n").length;
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
    const paddingTop = Number.parseFloat(getComputedStyle(textarea).paddingTop);
    const targetTop = (targetLine - 1) * lineHeight + paddingTop - textarea.clientHeight / 2;
    textarea.scrollTop = Math.max(0, Math.min(targetTop, textarea.scrollHeight - textarea.clientHeight));
  };

  const jumpToCurrent = (): void => {
    const match = matches.value[currentIndex.value];
    if (!match) return;
    if (isSourceMode.value) {
      const textarea = getSourceTextarea();
      if (textarea) scrollSourceToMatch(textarea, match);
      return;
    }
    const editor = getEditor();
    if (editor) goToEditorMatch(editor, match);
  };

  const goToNext = (): void => {
    if (matches.value.length === 0) return;
    currentIndex.value = (currentIndex.value + 1) % matches.value.length;
    refreshNow();
    jumpToCurrent();
  };

  const goToPrev = (): void => {
    if (matches.value.length === 0) return;
    currentIndex.value = (currentIndex.value - 1 + matches.value.length) % matches.value.length;
    refreshNow();
    jumpToCurrent();
  };

  const toggleCaseSensitive = (): void => {
    caseSensitive.value = !caseSensitive.value;
    currentIndex.value = 0;
    refreshNow();
    jumpToCurrent();
  };

  const replaceCurrent = (): void => {
    const match = matches.value[currentIndex.value];
    if (!match) return;
    const anchorFrom = match.from;
    const editor = getEditor();
    const textarea = getSourceTextarea();

    if (isSourceMode.value) {
      if (!textarea) return;
      // 替换当前匹配，光标停留在替换文本之后，方便继续查看上下文。
      textarea.setRangeText(replacement.value, match.from, match.to, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (!editor) return;
      // 一次事务完成替换，撤销时能一步回到替换前的内容。
      editor.view.dispatch(editor.state.tr.insertText(replacement.value, match.from, match.to));
    }

    // 文档内容已变化，重新收集匹配并跳到替换位置之后的第一个匹配。
    if (isSourceMode.value) refreshSource(anchorFrom);
    else refreshEditor(anchorFrom);
    jumpToCurrent();
  };

  const replaceAll = (): void => {
    const editor = getEditor();
    const textarea = getSourceTextarea();

    if (isSourceMode.value) {
      if (!textarea) return;
      const collected = collectTextMatches(textarea.value, query.value, caseSensitive.value);
      if (collected.length === 0) return;
      // 从后往前拼接，一次写回 textarea 并只触发一次内容更新。
      let result = textarea.value;
      for (let i = collected.length - 1; i >= 0; i--) {
        const match = collected[i];
        result = result.slice(0, match.from) + replacement.value + result.slice(match.to);
      }
      textarea.value = result;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      refreshSource();
      return;
    }

    if (!editor) return;
    const collected = collectEditorMatches(editor, query.value, caseSensitive.value);
    if (collected.length === 0) return;
    // 从后往前合并进同一个事务，前面的位置不受后面替换的影响。
    let tr = editor.state.tr;
    for (let i = collected.length - 1; i >= 0; i--) {
      tr = tr.insertText(replacement.value, collected[i].from, collected[i].to);
    }
    editor.view.dispatch(tr);
    refreshEditor();
  };

  const open = (): void => {
    isOpen.value = true;
    focusRequest.value += 1;
    refreshNow();
    jumpToCurrent();
  };

  const close = (): void => {
    isOpen.value = false;
    matches.value = [];
    currentIndex.value = 0;
    // 清空富文本高亮，避免关闭面板后残留黄色标记。
    const editor = getEditor();
    if (editor) {
      editor.view.dispatch(
        editor.state.tr.setMeta(findReplaceKey, { decorations: DecorationSet.empty }),
      );
    }
  };

  onUnmounted(() => {
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
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
