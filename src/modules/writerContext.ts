import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// 编写上下文的字符预算：光标前取多少字、光标后取多少字。
// 过大浪费 token 并稀释模型注意力，过小则丢失衔接所需的上下文。
const BEFORE_CHARS = 1500;
const AFTER_CHARS = 300;

// ▍ 在提示词中标记写入点，模型据此衔接前后内容。
const CURSOR_MARK = "▍";

export interface HeadingItem {
  pos: number;
  level: number;
  text: string;
}

// 收集文档顶层标题：位置、级别、标题文本。
// 用于 AI 写作上下文——面包屑与章节范围都只以顶层标题划分章节。
export const collectHeadings = (doc: ProseMirrorNode): HeadingItem[] => {
  const headings: HeadingItem[] = [];
  let pos = 0;
  doc.forEach((child) => {
    if (child.type.name === "heading") {
      headings.push({
        pos,
        level: child.attrs.level as number,
        text: child.textContent,
      });
    }
    pos += child.nodeSize;
  });
  return headings;
};

/**
 * 收集文档里出现的全部标题（含嵌套在列表项等容器内的），按文档顺序。
 *
 * 左侧大纲是按 Markdown 源码逐行扫描出来的，列表项里缩进的 `# 标题` 同样会被它
 * 算作一条大纲。若这里只数顶层标题，大纲下标与光标下标就会错位，表现为「高亮的
 * 不是当前所在的那条大纲」。所以大纲相关的位置换算统一走这个函数。
 */
export const collectAllHeadings = (doc: ProseMirrorNode): HeadingItem[] => {
  const headings: HeadingItem[] = [];
  // descendants 给出的 pos 就是节点的起始位置，与 collectHeadings 的累加口径一致。
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        pos,
        level: node.attrs.level as number,
        text: node.textContent,
      });
    }
    return true;
  });
  return headings;
};

// 光标所在的标题下标：取光标处（含光标所在标题）之前的最后一个标题。
// 光标位于第一个标题之前时返回 -1，表示没有“当前标题”可高亮。
export const findActiveHeadingIndex = (
  headings: readonly HeadingItem[],
  pos: number,
): number => {
  let active = -1;
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index].pos > pos) break;
    active = index;
  }
  return active;
};

// 面包屑由光标之前的标题构成：遇到更浅级别时替换掉更深的层级，
// 例如 h1 > h3 > h2 的文档里光标在 h2 之后，面包屑为 [h1, h2]。
export const buildBreadcrumb = (headings: HeadingItem[], pos: number): string[] => {
  const chain: HeadingItem[] = [];
  for (const heading of headings) {
    if (heading.pos >= pos) break;
    while (chain.length > 0 && chain[chain.length - 1].level >= heading.level) {
      chain.pop();
    }
    chain.push(heading);
  }
  return chain.map((heading) => heading.text);
};

// 定位光标所在章节：从光标前最近标题开始，到下一个同级或更高级标题结束。
// 光标前没有标题时，取文档开头到第一个标题之间的内容。
export const findSectionRange = (
  headings: HeadingItem[],
  pos: number,
  docSize: number,
): { from: number; to: number } => {
  let start: HeadingItem | null = null;
  for (const heading of headings) {
    if (heading.pos >= pos) break;
    start = heading;
  }

  const from = start ? start.pos : 0;
  let to = docSize;
  for (const heading of headings) {
    if (heading.pos <= from) continue;
    if (!start || heading.level <= start.level) {
      to = heading.pos;
      break;
    }
  }
  return { from, to };
};

// 章节内容以光标为界拆成前后两段分别截断：
// 超长章节只保留光标前 BEFORE_CHARS 字与光标后 AFTER_CHARS 字。
const buildSectionText = (
  doc: ProseMirrorNode,
  pos: number,
  from: number,
  to: number,
): string => {
  const before = doc.textBetween(from, pos, "\n\n");
  const after = doc.textBetween(pos, to, "\n\n");
  const beforeClipped =
    before.length > BEFORE_CHARS
      ? `…${before.slice(before.length - BEFORE_CHARS)}`
      : before;
  const afterClipped =
    after.length > AFTER_CHARS ? `${after.slice(0, AFTER_CHARS)}…` : after;
  return `${beforeClipped}${CURSOR_MARK}${afterClipped}`.trim();
};

/**
 * 组装 AI 实时编写的上下文：标题面包屑说明"在哪写"，
 * 截断后的当前章节说明"接着什么写"；文档无标题时降级为光标周围窗口。
 */
export const buildWriterContext = (doc: ProseMirrorNode, pos: number): string => {
  const headings = collectHeadings(doc);

  if (headings.length === 0) {
    const text = buildSectionText(doc, pos, 0, doc.content.size);
    return `正文片段（${CURSOR_MARK} 为写入位置）：\n${text}`;
  }

  const breadcrumb = buildBreadcrumb(headings, pos);
  const { from, to } = findSectionRange(headings, pos, doc.content.size);
  const sectionText = buildSectionText(doc, pos, from, to);
  const locationLine =
    breadcrumb.length > 0
      ? `所在章节（标题路径）：${breadcrumb.join(" > ")}`
      : "所在章节：第一个标题之前";
  return `${locationLine}\n章节内容（${CURSOR_MARK} 为写入位置）：\n${sectionText}`;
};
