import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// 代码块内「选中匹配高亮」：出现非空选区且落在代码块内时，把当前代码块中
// 所有相同文本标记为浅色底色，视觉上类似 VS Code 的 selection highlight。
// 只影响显示，不修改文档内容，因此不会污染 Markdown 导出或撤销历史。
const occurrenceKey = new PluginKey<DecorationSet>("codeOccurrenceHighlight");

// 定位选区起点所在的 codeBlock 祖先；选区必须完全落在同一个代码块内才算命中。
const resolveCodeBlockRange = (selection: Selection): { node: ProseMirrorNode; start: number } | null => {
  const { $from, $to } = selection;

  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== "codeBlock") {
    depth -= 1;
  }
  if (depth === 0) return null;

  const node = $from.node(depth);
  // `before(depth)` 返回 codeBlock 节点本身的位置；`start(depth)` 返回的是
  // 节点内容起点（= 节点位置 + 1），误用会令匹配区间整体右移一个字符。
  const start = $from.before(depth);
  if ($to.pos < start || $to.pos >= start + node.nodeSize) return null;

  return { node, start };
};

const buildOccurrenceDecorations = (
  doc: ProseMirrorNode,
  selection: Selection,
): DecorationSet => {
  if (selection.empty) return DecorationSet.empty;

  const range = resolveCodeBlockRange(selection);
  if (!range) return DecorationSet.empty;

  const { node, start } = range;
  const selectedText = doc.textBetween(selection.from, selection.to, "\n", "");

  // 纯空白选区不参与匹配，避免整块无意义的误高亮。
  if (!/\S/u.test(selectedText)) return DecorationSet.empty;

  // 不区分大小写、非整词匹配：与查找替换一致，用降小写后的 indexOf 扫描。
  const source = node.textContent.toLowerCase();
  const needle = selectedText.toLowerCase();

  const decorations: Decoration[] = [];
  let offset = 0;
  while (true) {
    const found = source.indexOf(needle, offset);
    if (found === -1) break;

    // codeBlock 的文本从节点起始位置 +1 开始，逐字符线性映射。
    const from = start + 1 + found;
    const to = from + needle.length;

    // 跳过被选中的那一处，让原生选区背景独立呈现。
    if (from !== selection.from || to !== selection.to) {
      decorations.push(
        Decoration.inline(from, to, { class: "xmd-occurrence-match" }),
      );
    }

    offset = found + needle.length;
  }

  return DecorationSet.create(doc, decorations);
};

const occurrencePlugin = new Plugin<DecorationSet>({
  key: occurrenceKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (transaction, previous) => {
      // 只有文档或选区变化时才重算，避免无关事务触发无谓的重新布局。
      if (!transaction.docChanged && !transaction.selectionSet) return previous;
      return buildOccurrenceDecorations(transaction.doc, transaction.selection);
    },
  },
  props: {
    decorations: (state) => occurrenceKey.getState(state) ?? DecorationSet.empty,
  },
});

export const CodeOccurrenceHighlight = Extension.create({
  name: "codeOccurrenceHighlight",

  addProseMirrorPlugins() {
    return [occurrencePlugin];
  },
});
