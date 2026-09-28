import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/*
 * 代码块内「选中匹配高亮」：出现非空选区且落在代码块内时，把当前代码块中
 * 所有相同文本标记为浅色底色，视觉上类似 VS Code 的 selection highlight。
 *
 * 这里用 CSS Custom Highlight API 登记 Range，而不是 ProseMirror 行内装饰。
 * 装饰会真实改写代码块 DOM：拖拽选区时每帧重写会让 ProseMirror 重写选区所在的
 * 文本节点，于是它专门为 Chrome 拖拽选区准备的保护被绕过（forceSelUpdate），
 * 紧接着它的滚动补偿又会拿一个已被换掉的参考节点算出错误位移，
 * 表现为拖拽过程中视口纵向跳动、选中动作被打断。
 * 登记 Range 由浏览器合成绘制、完全不碰 DOM，因此这类干扰从根上不存在，
 * 也就不需要冻结重算、延迟补算或滚动位置还原这些特殊处理。
 *
 * 样式见 MarkdownEditor.vue 里的 ::highlight(xmd-occurrence-match)，
 * 该伪元素已获豁免（理由写在那段样式注释里）。此处两边的名字必须一致。
 */
const HIGHLIGHT_NAME = "xmd-occurrence-match";

/** 正文里一个文本节点及其在正文中的字符区间。 */
interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/** 一次匹配扫描的结果：匹配的字符偏移，以及正文的文档位置区间。 */
interface OccurrenceResult {
  offsets: { start: number; end: number }[];
  // 正文（codeBlock 的内容）在文档中的位置区间，用来界定哪些文本节点属于正文。
  contentFrom: number;
  contentTo: number;
}

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

// 找出选区内文本在代码块中所有相同出现的位置，返回相对正文起点的字符偏移。
// 没有任何可高亮的匹配时返回 null，调用方据此清空登记。
const findOccurrences = (
  doc: ProseMirrorNode,
  selection: Selection,
): OccurrenceResult | null => {
  if (selection.empty) return null;

  const block = resolveCodeBlockRange(selection);
  if (!block) return null;

  const { node, start } = block;
  const selectedText = doc.textBetween(selection.from, selection.to, "\n", "");

  // 纯空白选区不参与匹配，避免整块无意义的误高亮。
  if (!/\S/u.test(selectedText)) return null;

  // 不区分大小写、非整词匹配：与查找替换一致，用降小写后的 indexOf 扫描。
  const source = node.textContent.toLowerCase();
  const needle = selectedText.toLowerCase();
  // 被选中的那一处在正文里的偏移，稍后要跳过它，让原生选区背景独立呈现。
  const selectedOffset = selection.from - (start + 1);

  const offsets: { start: number; end: number }[] = [];
  let searchFrom = 0;
  while (true) {
    const found = source.indexOf(needle, searchFrom);
    if (found === -1) break;

    const end = found + needle.length;
    if (found !== selectedOffset || end !== selectedOffset + needle.length) {
      offsets.push({ start: found, end });
    }
    searchFrom = end;
  }

  if (offsets.length === 0) return null;

  return {
    offsets,
    contentFrom: start + 1,
    contentTo: start + 1 + node.content.size,
  };
};

/*
 * 取代码块正文的 DOM 根。
 * 正文起止两个位置都落在同一个 codeBlock 的内容里，因此从其中之一向上走，
 * 一定能找到同时包含两者的祖先（实际上就是 NodeViewContent 渲染的那个元素）。
 * 这样就不必假设节点视图的标记结构，也不会把标题栏、行号列误当成正文。
 */
const resolveContentRoot = (view: EditorView, contentFrom: number, contentTo: number): Node => {
  const startNode = view.domAtPos(contentFrom).node;
  const endNode = view.domAtPos(contentTo).node;

  let root = startNode;
  while (!root.contains(endNode)) root = root.parentNode as Node;
  return root;
};

// 按文档顺序收集正文里的文本节点，并记录每个节点对应的字符区间。
const collectTextSegments = (root: Node): TextSegment[] => {
  const segments: TextSegment[] = [];
  let offset = 0;

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      segments.push({ node: text, start: offset, end: offset + text.length });
      offset += text.length;
      return;
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      visit(node.childNodes[index]);
    }
  };

  visit(root);
  return segments;
};

/*
 * 生成"字符偏移 → 文本节点位置"的查询函数。
 *
 * 这里刻意不走 view.domAtPos：viewdesc.ts:319 的 domFromPos 是线性扫描子节点的，
 * 而语法高亮会让一个较长代码块的内容产生成百上千个子节点。若每个匹配查一次，
 * 代价就是 O(匹配数 × 子节点数)——刚选中一两个字符时匹配数最多，会明显卡顿。
 * 匹配偏移是递增产生的，因此游标只前进，整体代价与"文本节点数 + 匹配数"成正比。
 */
const createPointLocator = (segments: TextSegment[]) => {
  let index = 0;
  return (charOffset: number): { node: Text; offset: number } => {
    while (index < segments.length - 1 && charOffset >= segments[index].end) index += 1;
    const segment = segments[index];
    return {
      node: segment.node,
      // 偏移落在正文末尾时钳到最后一个文本节点的长度。
      offset: Math.min(charOffset - segment.start, segment.node.length),
    };
  };
};

// 按当前选区重建高亮；没有可高亮的匹配时清空登记，避免旧高亮残留。
const applyHighlights = (view: EditorView): void => {
  /* 【临时诊断】确认卡顿是否出在这段 JS 上；只打印明显超时的情形，确认后删除。 */
  const probeStart = performance.now();
  const found = findOccurrences(view.state.doc, view.state.selection);
  if (!found) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }

  const doc = view.dom.ownerDocument;
  const locate = createPointLocator(
    collectTextSegments(resolveContentRoot(view, found.contentFrom, found.contentTo)),
  );

  CSS.highlights.set(
    HIGHLIGHT_NAME,
    new Highlight(...found.offsets.map(({ start, end }) => {
      const head = locate(start);
      const tail = locate(end);
      const range = doc.createRange();
      range.setStart(head.node, head.offset);
      range.setEnd(tail.node, tail.offset);
      return range;
    })),
  );

  /* 【临时诊断】同上。 */
  const elapsed = performance.now() - probeStart;
  if (elapsed > 4) {
    console.log(`[perf-probe] 匹配=${found.offsets.length} 耗时=${elapsed.toFixed(1)}ms`);
  }
};

export const CodeOccurrenceHighlight = Extension.create({
  name: "codeOccurrenceHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(editorView) {
          applyHighlights(editorView);

          return {
            update(currentView, prevState) {
              // 滚动、纯元数据之类的事务不会改变匹配结果，跳过重建以免无谓重绘。
              if (
                currentView.state.doc.eq(prevState.doc)
                && currentView.state.selection.eq(prevState.selection)
              ) return;
              applyHighlights(currentView);
            },
            destroy() {
              CSS.highlights.delete(HIGHLIGHT_NAME);
            },
          };
        },
      }),
    ];
  },
});
