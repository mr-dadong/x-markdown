import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  HTML_BLOCK_CHUNK_ATTRIBUTE,
  HTML_BLOCK_OPEN_ATTRIBUTE,
} from "../../../editor/htmlBlockSourceForm";
import { jsonTextContent } from "../shared/officialMarkdown";

/**
 * 手写块级 HTML 的认领（「写完就渲染」）。
 *
 * 打开文件时，块级 HTML 由解析器认领成真正的编辑器节点（见 HtmlBlock.parseMarkdown），
 * 而所见即所得视图里手写或整段粘贴进来的 HTML 起初只是普通段落文本，长得和正文一样，
 * 用户会以为「编辑器不渲染 HTML」。这里把同一条解析路径搬到编辑期：只要刚输入的内容
 * 构成一段「写完了的」块级 HTML，就立刻按 Markdown 的规则把它认领成节点。
 *
 * 「写完了」由两层判据决定：
 * - 结构平衡：标签成对闭合（注释、自闭合标签、void 元素、引号里的尖括号都不改变深度），
 *   并且候选起点不在某个未闭合标签的内部 —— 否则会把「还在写」的半截 HTML 提前认领掉，
 *   用户后面补的收尾标签会变成孤立文本；
 * - 解析结果不是字面文本：用与打开文件完全相同的解析路径试一遍，只有真的被认领成节点
 *   才替换（注释、认不出的标签、普通段落都会被这一条挡掉）。
 */

/** 认领事务的标记：插件不处理自己产生的事务。 */
export const HTML_BLOCK_CLAIM_META = "xmdHtmlBlockClaim";

export const htmlBlockClaimKey = new PluginKey("xmdHtmlBlockClaim");

/** HTML 的空元素：没有闭标签，也不改变嵌套深度。 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** 原始文本元素：内容不是标签，扫描时整段跳过。 */
const RAW_TEXT_TAGS = new Set(["script", "style"]);

/** 向前收拢候选区间的上限：块级 HTML 通常只有几行，避免在大文档里做无意义的长距离扫描。 */
const MAX_RUN_PARAGRAPHS = 128;
const MAX_RUN_LENGTH = 64 * 1024;

/** 标签名允许的字符（首字符必须是字母）。 */
const TAG_NAME_CHARACTER = /[A-Za-z0-9:-]/u;

/** 一个标签的最小描述。 */
interface HtmlTag {
  /** 小写标签名。 */
  name: string;
  /** 是否是闭标签（`</div>`）。 */
  closing: boolean;
  /** 是否自闭合（`<img />`）。 */
  selfClosing: boolean;
  /** 标签在源码中的结束位置（`>` 之后）。 */
  end: number;
}

/**
 * 从源码的 `<` 处读出一个标签；不是标签（`<` 后不是标签名）时返回 null。
 *
 * 属性里的 `>` 不能当成标签结束，因此引号内的内容整段跳过。
 * 标签没有闭合的 `>` 时按源码末尾处理：这个标签算没写完，深度会一直挂着。
 */
const readTag = (source: string, start: number): HtmlTag | null => {
  let index = start + 1;
  const closing = source.charAt(index) === "/";
  if (closing) index += 1;

  let name = "";
  while (index < source.length && TAG_NAME_CHARACTER.test(source.charAt(index))) {
    name += source.charAt(index);
    index += 1;
  }
  if (!/^[A-Za-z]/u.test(name)) return null;

  let quote = "";
  while (index < source.length) {
    const character = source.charAt(index);
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      break;
    }
    index += 1;
  }

  return {
    name: name.toLowerCase(),
    closing,
    selfClosing: source.charAt(index - 1) === "/",
    end: Math.min(index + 1, source.length),
  };
};

/**
 * 跳过一个不参与标签计数的区间（注释、声明、原始文本元素的内容）。
 *
 * 区间里的尖括号不算标签，但换行必须照常记录深度：扫描结果要和段落一一对应，
 * 少记一个换行就会让后面的段落整体错位。
 */
const skipRecordingNewlines = (
  source: string,
  from: number,
  to: number,
  depth: number,
  depths: number[],
): number => {
  for (let index = from; index < to && index < source.length; index += 1) {
    if (source.charAt(index) === "\n") depths.push(depth);
  }
  return to;
};

/**
 * 扫描 HTML 源码，返回每一行结束后的标签嵌套深度（长度 = 行数）。
 *
 * 「写完了」的判据就是最后一行结束后深度回到 0：还停在某个标签里面说明用户没收尾。
 */
export const scanLineDepths = (source: string): number[] => {
  const depths: number[] = [];
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    const character = source.charAt(index);

    if (character === "\n") {
      depths.push(depth);
      index += 1;
      continue;
    }
    if (character !== "<") {
      index += 1;
      continue;
    }
    // 注释里的尖括号不是标签。
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      index = skipRecordingNewlines(
        source,
        index,
        end < 0 ? source.length : end + 3,
        depth,
        depths,
      );
      continue;
    }
    // 声明（`<!DOCTYPE html>`）与处理指令（`<?xml …?>`）。
    if (source.startsWith("<!", index) || source.startsWith("<?", index)) {
      const end = source.indexOf(">", index);
      index = skipRecordingNewlines(
        source,
        index,
        end < 0 ? source.length : end + 1,
        depth,
        depths,
      );
      continue;
    }

    const tag = readTag(source, index);
    if (!tag) {
      index += 1;
      continue;
    }
    index = tag.end;

    if (tag.closing) {
      // 多出来的闭标签不让深度变成负数，否则后面的候选会整体错位。
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (tag.selfClosing || VOID_TAGS.has(tag.name)) continue;
    if (RAW_TEXT_TAGS.has(tag.name)) {
      // script / style 的内容是纯文本：跳到闭标签，内容里的尖括号一概不算。
      const close = source.toLowerCase().indexOf(`</${tag.name}`, index);
      depth += 1;
      // 找到闭标签就跳过去（循环会读到它并减回来）；没找到说明这个块没写完。
      if (close >= 0) {
        // 闭标签之前的换行都算在 script / style 元素内部，深度取 +1 之后的值。
        index = skipRecordingNewlines(source, index, close, depth, depths);
      }
      continue;
    }
    depth += 1;
  }

  depths.push(depth);
  return depths;
};

/** 解析结果是否只是把原文原样当成文字（没有被认领成任何节点）。 */
export const isPlainTextNodes = (nodes: readonly JSONContent[], source: string): boolean => {
  if (nodes.length === 0) return true;
  if (!nodes.every((node) => node.type === "paragraph")) return false;
  return nodes.map((node) => jsonTextContent(node)).join("\n") === source;
};

export interface HtmlBlockClaim {
  /** 候选区间在 texts 里的起始下标。 */
  start: number;
  /** 拼成 Markdown 源码的原文。 */
  source: string;
  /** 解析出来的顶层节点。 */
  nodes: JSONContent[];
}

/**
 * 从「一段刚写完的 HTML 文本」里找出可以认领的块。
 *
 * texts 是候选区间内每个段落的文本（段落之间就是 Markdown 的换行）。从最长的一段
 * 往回逐段尝试：只有整段已经平衡、候选起点不在未闭合标签内部、且解析结果不是字面
 * 文本，才认领它。
 */
export const findClaimableHtmlBlock = (
  texts: readonly string[],
  parse: (source: string) => JSONContent[] | null,
): HtmlBlockClaim | null => {
  const depths = scanLineDepths(texts.join("\n"));
  // 末尾还停在标签里：用户还没收尾，这一整段都不认领。
  if (depths[depths.length - 1] !== 0) return null;

  for (let start = 0; start < texts.length; start += 1) {
    // 起点必须在元素之外，否则会把「某个未闭合标签内部的一段」当成独立块认领。
    if (start > 0 && depths[start - 1] !== 0) continue;
    // 块级 HTML 必须从块首的标签开始，前面不能还有普通文字。
    if (!texts[start].trimStart().startsWith("<")) continue;

    const source = texts.slice(start).join("\n");
    const nodes = parse(source);
    if (!nodes || nodes.length === 0 || isPlainTextNodes(nodes, source)) continue;
    return { start, source, nodes };
  }

  return null;
};

export interface HtmlBlockRange {
  /** 候选区间第一个顶层段落的序号。 */
  blockStart: number;
  /** 候选区间最后一个顶层段落的序号（刚输入完的那一个）。 */
  blockEnd: number;
  /** 各段文本，与区块里的段落一一对应。 */
  texts: string[];
}

/** 段落最后一段文字是否以 `>` 收尾 —— 刚敲下或刚写完的标签一定这样收尾。 */
const lastTextEndsWithBracket = (node: ProseMirrorNode): boolean => {
  if (node.type.name !== "paragraph") return false;
  const last = node.lastChild;
  return last?.isText === true && (last.text ?? "").endsWith(">");
};

/**
 * 找出光标旁边「刚输入完」的块级 HTML 候选区间；不构成候选时返回 null。
 *
 * 候选区间只收拢连续的非空段落：空段落就是 Markdown 里的空行，也就是块与块的分界，
 * 因此一个 Markdown 源码块对应的正是这样一段连续段落。
 */
export const htmlBlockRangeAtCursor = (state: EditorState): HtmlBlockRange | null => {
  const { selection } = state;
  if (!selection.empty) return null;

  const $from = selection.$from;
  // 只在顶层段落上处理：列表、引用里的结构由各自的容器负责，不在本次范围内。
  if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;

  const doc = state.doc;
  let end = $from.index(0);
  const atParagraphEnd = $from.parentOffset === $from.parent.content.size;
  if (!atParagraphEnd || !lastTextEndsWithBracket(doc.child(end))) {
    /*
     * 刚按回车时（光标停在新空段落的开头），刚写完的是前一个段落；
     * 粘贴内容以空行结尾时同样落在这种状态上。
     */
    const previous = end > 0 ? doc.child(end - 1) : null;
    const cursorInEmptyParagraph = $from.parentOffset === 0 && $from.parent.content.size === 0;
    if (!cursorInEmptyParagraph || !previous || !lastTextEndsWithBracket(previous)) return null;
    end -= 1;
  }

  let start = end;
  let length = doc.child(end).textContent.length;
  while (start > 0 && end - start < MAX_RUN_PARAGRAPHS && length < MAX_RUN_LENGTH) {
    const previous = doc.child(start - 1);
    if (previous.type.name !== "paragraph" || previous.content.size === 0) break;
    length += previous.textContent.length;
    start -= 1;
  }

  const texts: string[] = [];
  for (let index = start; index <= end; index += 1) texts.push(doc.child(index).textContent);
  return { blockStart: start, blockEnd: end, texts };
};

/** 顶层节点的起始位置：文档第一个子节点从 0 开始。 */
const topLevelPosition = (doc: ProseMirrorNode, index: number): number => {
  let position = 0;
  for (let child = 0; child < index; child += 1) position += doc.child(child).nodeSize;
  return position;
};

/**
 * 认领结果里有没有块级 HTML 的源码标记。
 *
 * 块级认领（`<div align="center">`、`<hr>`、独占一行的 `<img>`）由
 * htmlBlockRender 产出，节点上带着源码形态属性；行内 HTML（如带 style 的 `<span>`）
 * 走的是行内解析，没有这些属性。两者的光标落点不同，靠这个信号区分。
 */
const containsBlockLevelHtml = (nodes: readonly JSONContent[]): boolean =>
  nodes.some(
    (node) =>
      node.attrs?.[HTML_BLOCK_CHUNK_ATTRIBUTE] != null
      || node.attrs?.[HTML_BLOCK_OPEN_ATTRIBUTE] != null,
  );

/**
 * 把「刚认领的块」后面的空段落还原成普通段落。
 *
 * 在居中 HTML 块内部粘贴时，段落会被粘贴内容切成两半，切出来的空尾巴继承原段落的
 * 属性：`textAlign: center` 与 HTML 源码标记。光标落进这个空段落后再按回车，新段落
 * 继续继承同样的属性 —— 用户看到的就是「回车后光标跑到中间」，而且一路留在那段 HTML 里。
 * 空段落没有内容，复原属性不会丢东西；已经有内容的段落不动，它的对齐属于用户内容自己的属性。
 */
const resetEmptyParagraphAttrs = (transaction: Transaction, position: number): void => {
  const node = transaction.doc.resolve(position).nodeAfter;
  if (!node || node.type.name !== "paragraph" || node.content.size > 0) return;

  // 属性默认值取自 schema 里的属性声明（`defaultAttrs` 没有公开类型，不直接读）。
  const defaults: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(node.type.spec.attrs ?? {})) {
    defaults[name] = spec.default ?? null;
  }

  // 属性本来就是默认值时不必产生一次无意义的节点改动。
  const reset = Object.entries(defaults).some(([name, value]) => node.attrs[name] !== value);
  if (!reset) return;
  transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...defaults });
};

/** 把候选区间换成解析出来的节点，并把光标放到结果之后。 */
const buildClaimTransaction = (
  state: EditorState,
  blockStart: number,
  blockEnd: number,
  nodes: readonly JSONContent[],
): Transaction => {
  const { doc, schema } = state;
  const from = topLevelPosition(doc, blockStart);
  const to = topLevelPosition(doc, blockEnd + 1);
  const inserted = nodes.map((node) => schema.nodeFromJSON(node));

  const transaction = state.tr;
  transaction.replaceWith(from, to, inserted);
  transaction.setMeta(HTML_BLOCK_CLAIM_META, true);

  const after = from + inserted.reduce((total, node) => total + node.nodeSize, 0);
  const $after = transaction.doc.resolve(after);
  const last = inserted[inserted.length - 1];

  /*
   * 光标放到认领结果「之后」，继续输入才不会写进刚渲染出来的内容里：
   * - 后面已经有可输入的文本块（末尾段落、刚按下的回车、粘贴内容末尾的空行）就用它，
   *   不要再补一个，否则会平白多出一个空段落；
   * - 行内 HTML（结果自己是可输入的段落，且没有块级源码标记）留在段末继续写；
   * - 块级 HTML 与原子节点（图片、分隔线、HTML 预览块）另起一段：停在原子节点后面
   *   会变成节点选区（一敲字就替换整个块），停在块级段落里则会把后续文字写进那段 HTML。
   */
  if ($after.nodeAfter?.isTextblock) {
    resetEmptyParagraphAttrs(transaction, after);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(after)));
    return transaction;
  }
  if (last.isTextblock && !containsBlockLevelHtml(nodes)) {
    transaction.setSelection(TextSelection.create(transaction.doc, after - 1));
    return transaction;
  }
  transaction.insert(after, schema.nodes.paragraph.create());
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(after)));
  return transaction;
};

/**
 * 创建「写完就认领」插件。
 *
 * parse 由调用方提供，必须是打开文件时用的那条解析路径（官方 Markdown 管理器的
 * block 解析），否则编辑期和打开时的渲染结果会出现两套口径。
 */
export const createHtmlBlockClaimPlugin = (
  parse: (source: string) => JSONContent[] | null,
): Plugin =>
  new Plugin({
    key: htmlBlockClaimKey,
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      /*
       * 撤销/重做与插件自己产生的事务一律跳过：否则用户按 Ctrl+Z 撤回渲染后，
       * 插件会立刻把它重新认领一遍，变得撤不掉。
       */
      if (
        transactions.some(
          (transaction) =>
            isHistoryTransaction(transaction) || transaction.getMeta(HTML_BLOCK_CLAIM_META),
        )
      ) {
        return null;
      }

      const range = htmlBlockRangeAtCursor(newState);
      if (!range) return null;

      const claim = findClaimableHtmlBlock(range.texts, parse);
      if (!claim) return null;

      return buildClaimTransaction(
        newState,
        range.blockStart + claim.start,
        range.blockEnd,
        claim.nodes,
      );
    },
  });
