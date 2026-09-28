import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { HTML_BLOCK_CHUNK_ATTRIBUTE } from "./htmlBlockSourceForm";

/**
 * 顶层节点与源码块的对应关系。
 *
 * 绝大多数源码块在文档里就是一个顶层节点，但块级 HTML 例外：README 里常见的
 * `<div align="center">…</div>` + `<hr>` + 第二个 `<div>` 在源码里是**一个**块，
 * 被认领成真节点后却是三个。凡是拿「顶层节点序号」当「源码块序号」用的地方
 * （增量保存、源码/预览视图定位）都必须走这里的分组换算，否则序号会整体错位。
 */

/** 一个源码块在文档里对应的节点区间（start 闭、end 开）。 */
export interface DocNodeRun {
  /** 起始子节点下标。 */
  start: number;
  /** 结束子节点下标（不含）。 */
  end: number;
  /** 同一个源码块产出的节点共用的分组编号；普通块为 null。 */
  chunkId: string | null;
}

/** 读取节点上的源码块分组编号；没有编号（普通块）时返回 null。 */
export const chunkIdOfNode = (node: ProseMirrorNode): string | null => {
  const value = node.attrs?.[HTML_BLOCK_CHUNK_ATTRIBUTE];
  return typeof value === "string" && value !== "" ? value : null;
};

/**
 * 把前 `count` 个顶层节点按源码块分组：分组编号相同的连续节点属于同一个块，
 * 没有编号的节点各自成组。编号由块级 HTML 解析时写入，同一次解析内唯一。
 */
export const groupDocChildren = (doc: ProseMirrorNode, count: number): DocNodeRun[] => {
  const runs: DocNodeRun[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunkId = chunkIdOfNode(doc.child(index));
    const previous = runs[runs.length - 1];
    if (chunkId !== null && previous !== undefined && previous.chunkId === chunkId) {
      previous.end = index + 1;
      continue;
    }
    runs.push({ start: index, end: index + 1, chunkId });
  }
  return runs;
};

/** 某个顶层节点下标所属的分组序号；越界或没有分组时返回 0。 */
export const runIndexOfChild = (runs: readonly DocNodeRun[], childIndex: number): number => {
  for (let index = 0; index < runs.length; index += 1) {
    if (childIndex < runs[index].end) return index;
  }
  return Math.max(0, runs.length - 1);
};
