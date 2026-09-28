import type { JSONContent } from "@tiptap/core";
import {
  HTML_BLOCK_CHUNK_ATTRIBUTE,
  HTML_BLOCK_OPEN_ATTRIBUTE,
} from "../../../editor/htmlBlockSourceForm";
import { readImageSizeAttribute } from "../../../editor/imageStyle";

/**
 * 块级 HTML 子集 → 编辑器节点。
 *
 * 背景：README 里最常见的写法是用 HTML 排版 —— 居中的 `<div>` 包一张 logo、`<hr>` 分隔、
 * 一排徽章 `<a href><img></a>`。这些标签在 schema 里没有对应节点，早先的实现一律当成
 * 「可编辑的字面文本」显示，于是预览视图里看到的是一堆源码，和网页渲染完全不同。
 *
 * 这里只认领**能被 schema 表达**的那部分：
 * - 带对齐信息的容器（`<div align="center">`、`<p align="center">`、`<center>`）里的行内容
 *   → 一个带 textAlign 的段落，空格处理与浏览器一致（换行只是空白）；
 * - `<hr>` → 分隔线节点；
 * - `<img>` → 图片节点（沿用既有的「段落 + 图片」结构）。
 *
 * 认领不了的内容（HTML 注释、表格、`<style>`、`<script>`、认不出的标签、容器里混着块级标签…）
 * 一律整体交回调用方，继续按可编辑的字面文本处理 —— 宁可少渲染，也不能让用户的内容消失。
 */

/** 容器里允许出现的行内标签：schema 认领得了，或者本来就是行内语义元素。 */
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "big",
  "br",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
]);

/** 只在这几种容器带对齐信息时才转成对齐段落，其余容器保持字面文本。 */
const ALIGNED_WRAPPER_TAGS = new Set(["div", "p", "center"]);

/** TextAlign 扩展认识的对齐值；`align="middle"` 这类历史写法不认领。 */
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

export interface BlockHtmlRenderContext {
  /** 把一个行内 HTML 片段转成编辑器的行内节点（复用官方行内 HTML 解析）。 */
  parseInline: (html: string) => JSONContent[];
}

/** 每个源码块分配一个编号，保证增量保存能把同一块产出的多个节点认成一组。 */
let chunkSequence = 0;

/** 读取容器上的对齐方式：align 属性优先，其次 style 里的 text-align 声明。 */
const readAlignment = (element: Element): string | null => {
  const attribute = (element.getAttribute("align") ?? "").trim().toLowerCase();
  if (ALIGNMENTS.has(attribute)) return attribute;

  const style = element.getAttribute("style") ?? "";
  const match = /(?:^|;)\s*text-align\s*:\s*([a-z]+)/iu.exec(style);
  const fromStyle = (match?.[1] ?? "").toLowerCase();
  return ALIGNMENTS.has(fromStyle) ? fromStyle : null;
};

/** 把 DOM 元素还原成开标签文本（属性按 DOM 顺序输出，引号统一成双引号）。 */
const openTagOfElement = (element: Element): string => {
  const name = element.nodeName.toLowerCase();
  const attributes = Array.from(element.attributes)
    .map((attribute) => ` ${attribute.name}="${attribute.value.replaceAll('"', "&quot;")}"`)
    .join("");
  return `<${name}${attributes}>`;
};

/**
 * 容器里是不是只有行内容：文字、行内标签、空白。
 * HTML 注释、认不出的标签、块级标签都会让整块交回字面文本，避免内容被吃掉。
 */
const hasOnlyInlineContent = (element: Element): boolean => {
  for (const child of Array.from(element.childNodes)) {
    // 文本节点（含缩进空白）都属于行内内容。
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) return false;
    if (!INLINE_TAGS.has(child.nodeName.toLowerCase())) return false;
  }
  return true;
};

/**
 * 容器内容 → 行内节点。
 *
 * HTML 里的换行与缩进只是空白，浏览器渲染时会折叠成一个空格；这里先折叠再解析，
 * 否则用户在源码里为了排版敲的每个换行都会变成 `<br>`。
 */
const inlineContentOf = (element: Element, context: BlockHtmlRenderContext): JSONContent[] => {
  const collapsed = element.innerHTML.replace(/\s*\n\s*/gu, " ").trim();
  return collapsed === "" ? [] : context.parseInline(collapsed);
};

/** `<img>` 元素 → 图片节点；缺少 src 时返回 null，交给字面文本处理。 */
const imageNodeOfElement = (element: Element): JSONContent | null => {
  const src = (element.getAttribute("src") ?? "").trim();
  if (src === "") return null;

  const style = (element.getAttribute("style") ?? "").trim();
  return {
    type: "image",
    attrs: {
      src,
      alt: element.getAttribute("alt"),
      title: element.getAttribute("title"),
      width: readImageSizeAttribute(element.getAttribute("width")),
      height: readImageSizeAttribute(element.getAttribute("height")),
      // style 原文照样收下：编辑器让尺寸与 zoom 生效，其余声明存盘时逐字写回。
      styleSource: style === "" ? null : style,
    },
  };
};

/** 段落里只放一张图片：与既有「独占一行的 `<img>`」结构保持一致。 */
const imageParagraph = (image: JSONContent, chunkId: string): JSONContent => ({
  type: "paragraph",
  attrs: { [HTML_BLOCK_CHUNK_ATTRIBUTE]: chunkId },
  content: [image],
});

/**
 * 把一段块级 HTML 转成编辑器节点；有一处认领不了就返回 null。
 *
 * 返回 null 表示「这个块整体仍按可编辑的字面文本处理」，不是出错：
 * 调用方（HtmlBlock）据此保留用户原文。
 */
export const renderBlockHtmlSubset = (
  source: string,
  context: BlockHtmlRenderContext,
): JSONContent[] | null => {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  chunkSequence += 1;
  const chunkId = String(chunkSequence);
  const nodes: JSONContent[] = [];

  for (const child of Array.from(parsed.body.childNodes)) {
    // 块内换行与缩进属于空白，不产出节点。
    if (child.nodeType === 3) {
      if ((child.textContent ?? "").trim() !== "") return null;
      continue;
    }
    // 注释、CDATA 等既渲染不出来也带不进节点，整块交回字面文本，内容一字不丢。
    if (child.nodeType !== 1) return null;

    const element = child as Element;
    const tag = element.nodeName.toLowerCase();

    if (tag === "hr") {
      nodes.push({
        type: "horizontalRule",
        attrs: {
          [HTML_BLOCK_OPEN_ATTRIBUTE]: openTagOfElement(element),
          [HTML_BLOCK_CHUNK_ATTRIBUTE]: chunkId,
        },
      });
      continue;
    }

    if (tag === "img") {
      const image = imageNodeOfElement(element);
      if (!image) return null;
      nodes.push(imageParagraph(image, chunkId));
      continue;
    }

    if (ALIGNED_WRAPPER_TAGS.has(tag)) {
      // `<center>` 本身就是居中容器，没有 align 属性也按居中处理。
      const alignment = readAlignment(element) ?? (tag === "center" ? "center" : null);
      if (!alignment) return null;
      if (!hasOnlyInlineContent(element)) return null;

      const content = inlineContentOf(element, context);
      /*
       * 空容器一律不认领。README 里常见「开标签、空行、Markdown 表格、空行、闭标签」的写法，
       * 这种标签在源码里被空行切成不同的块：开标签单独一块、表格一块、闭标签一块。
       * 认领成一个空段落既没有意义，又会和「解析器补出的空段落」撞车，让增量保存的块
       * 对账整体错位。整段交回字面文本，用户看到的内容与改动前一致。
       */
      if (content.length === 0) return null;

      nodes.push({
        type: "paragraph",
        attrs: {
          textAlign: alignment,
          [HTML_BLOCK_OPEN_ATTRIBUTE]: openTagOfElement(element),
          [HTML_BLOCK_CHUNK_ATTRIBUTE]: chunkId,
        },
        content,
      });
      continue;
    }

    // 表格、列表、`<style>`、`<script>` 等不在认领范围：整块保持可编辑的字面文本。
    return null;
  }

  return nodes.length > 0 ? nodes : null;
};
