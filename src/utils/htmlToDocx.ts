// 把导出渲染器生成的 HTML 内容转换为 .docx（OOXML）文档。
// 不引入额外的打包依赖：使用项目已有的 JSZip 在渲染进程内组装 docx 包，
// 生成的二进制交给主进程落盘，与 ZIP 导出的数据流保持一致。
//
// 支持的结构：
// - 标题、段落与行内格式（加粗/斜体/下划线/删除线/行内代码/链接/颜色）
// - 有序/无序/任务列表（含嵌套）
// - 代码块（等宽字体 + 浅灰底纹，按行拆分）
// - 引用块、表格、分隔线
// - 图片（data URL 直接解码，http(s)/blob 尝试拉取，失败时保留替代文本）
// - Mermaid 图表（SVG 栅格化为 PNG 后嵌入）
// - 公式（KaTeX 渲染结果按可读文本降级保留）
// - Callout 提示块、脚注、目录

import JSZip from "jszip";

// —— 基础工具 ——

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const escapeXmlText = (text: string): string =>
  text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeXmlAttr = (text: string): string =>
  escapeXmlText(text).replace(/"/g, "&quot;");

const cleanText = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

// 代码中的换行统一压成空格，避免行内代码在 Word 中断行。
const cleanCodeText = (value: string): string =>
  value.replace(INVALID_XML_CHARS, "").replace(/\s*\n\s*/g, " ");

const parseColorFromStyle = (style: string | null): string | null => {
  if (!style) return null;
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  if (!match) return null;
  const color = match[1].trim();
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(color);
  if (hexMatch) return hexMatch[1].toUpperCase();
  const rgbMatch = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
  if (rgbMatch) {
    return [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return null;
};

// —— 图片资源 ——

const EMU_PER_PIXEL = 9525;
// 内容区约为 6.2 英寸（96dpi），超出则等比缩小，避免图片溢出页面。
const MAX_IMAGE_WIDTH_PX = 560;
// A4 页面宽度 11906 twips 减去左右各 1 英寸边距。
const CONTENT_WIDTH_TWIPS = 9026;

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

const MEDIA_EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

const decodeDataUrl = (
  dataUrl: string,
): { mime: string; bytes: Uint8Array } | null => {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { mime, bytes };
  }
  const decoded = decodeURIComponent(payload);
  return { mime, bytes: new TextEncoder().encode(decoded) };
};

// 外部图片（http(s) / blob）尝试用 fetch 拉取，CORS 或网络失败时返回 null。
const fetchImageBytes = async (
  src: string,
): Promise<{ mime: string; bytes: Uint8Array } | null> => {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    return contentType.startsWith("image/") && bytes.length > 0
      ? { mime: contentType, bytes }
      : null;
  } catch {
    return null;
  }
};

const resolveImage = async (
  src: string,
): Promise<{ mime: string; bytes: Uint8Array } | null> => {
  if (/^data:/i.test(src)) return decodeDataUrl(src);
  if (/^(?:https?:|blob:)/i.test(src)) return fetchImageBytes(src);
  return null;
};

interface DocxMedia {
  relId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

interface DocxLink {
  relId: string;
  target: string;
}

interface DocxContext {
  media: DocxMedia[];
  links: DocxLink[];
  // rId1 = styles、rId2 = numbering，之后的图片/链接从 3 开始分配。
  nextRelId: number;
  drawingId: number;
}

const addMedia = (
  ctx: DocxContext,
  bytes: Uint8Array,
  mimeType: string,
): DocxMedia | null => {
  const normalizedMime = mimeType.toLowerCase();
  const extension = IMAGE_EXTENSION_BY_MIME[normalizedMime];
  if (!extension) return null;
  ctx.nextRelId += 1;
  const media: DocxMedia = {
    relId: `rId${ctx.nextRelId}`,
    fileName: `image${ctx.media.length + 1}.${extension}`,
    bytes,
    mimeType: normalizedMime,
    extension,
  };
  ctx.media.push(media);
  return media;
};

// 优先使用用户调整过的 width 属性，否则用图片自然尺寸；统一限制在页面宽度内。
const getImageDimensions = async (
  img: HTMLImageElement,
): Promise<{ width: number; height: number }> => {
  let naturalWidth = img.naturalWidth;
  let naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) {
    try {
      await img.decode();
    } catch {
      // 图片未加载完成时使用占位尺寸继续导出。
    }
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  const attrWidth = Number(img.getAttribute("width"));
  let width: number;
  let height: number;
  if (attrWidth > 0) {
    width = attrWidth;
    height =
      naturalWidth > 0 && naturalHeight > 0
        ? Math.round((naturalHeight * width) / naturalWidth)
        : Math.round(width * 0.75);
  } else if (naturalWidth > 0 && naturalHeight > 0) {
    width = naturalWidth;
    height = naturalHeight;
  } else {
    width = 400;
    height = 300;
  }

  if (width > MAX_IMAGE_WIDTH_PX) {
    height = Math.round((height * MAX_IMAGE_WIDTH_PX) / width);
    width = MAX_IMAGE_WIDTH_PX;
  }
  return { width, height };
};

const buildImageDrawing = (
  ctx: DocxContext,
  media: DocxMedia,
  widthPx: number,
  heightPx: number,
): string => {
  ctx.drawingId += 1;
  const id = ctx.drawingId;
  const cx = Math.round(widthPx * EMU_PER_PIXEL);
  const cy = Math.round(heightPx * EMU_PER_PIXEL);
  return [
    "<w:drawing>",
    '<wp:inline distT="0" distB="0" distL="0" distR="0">',
    `<wp:extent cx="${cx}" cy="${cy}"/>`,
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
    `<wp:docPr id="${id}" name="图片 ${id}"/>`,
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>',
    "<a:graphic>",
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    "<pic:pic>",
    "<pic:nvPicPr>",
    `<pic:cNvPr id="${id}" name="${escapeXmlAttr(media.fileName)}"/>`,
    "<pic:cNvPicPr/>",
    "</pic:nvPicPr>",
    "<pic:blipFill>",
    `<a:blip r:embed="${media.relId}"/>`,
    "<a:stretch><a:fillRect/></a:stretch>",
    "</pic:blipFill>",
    "<pic:spPr>",
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    "</pic:spPr>",
    "</pic:pic>",
    "</a:graphicData>",
    "</a:graphic>",
    "</wp:inline>",
    "</w:drawing>",
  ].join("");
};

const buildImageParagraph = async (
  img: HTMLImageElement,
  ctx: DocxContext,
): Promise<string> => {
  const src = img.getAttribute("src") ?? "";
  const resolved = src ? await resolveImage(src) : null;
  if (!resolved) {
    // 图片缺失时保留替代文本，避免导出结果静默丢失内容。
    const alt = cleanText(img.getAttribute("alt"));
    return alt
      ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${makeRun(alt, { italic: true, color: "9CA3AF" })}</w:p>`
      : "";
  }
  const media = addMedia(ctx, resolved.bytes, resolved.mime);
  if (!media) return "";
  const { width, height } = await getImageDimensions(img);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${buildImageDrawing(ctx, media, width, height)}</w:r></w:p>`;
};

// —— 行内内容 ——

interface InlineFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: boolean;
  color?: string | null;
  small?: boolean;
  linkStyle?: boolean;
  vertAlign?: "superscript" | "subscript" | null;
}

// rPr 子元素必须遵循 OOXML 定义的顺序：rStyle → rFonts → b → i → strike →
// color → sz → highlight → u → vertAlign。
const buildRPr = (fmt: InlineFormat): string => {
  const parts: string[] = [];
  if (fmt.linkStyle) parts.push('<w:rStyle w:val="Hyperlink"/>');
  if (fmt.code) {
    parts.push(
      '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>',
    );
  }
  if (fmt.bold) parts.push("<w:b/>");
  if (fmt.italic) parts.push("<w:i/>");
  if (fmt.strike) parts.push("<w:strike/>");
  if (fmt.color) parts.push(`<w:color w:val="${fmt.color}"/>`);
  if (fmt.small || fmt.code) {
    parts.push('<w:sz w:val="18"/><w:szCs w:val="18"/>');
  }
  if (fmt.highlight) parts.push('<w:highlight w:val="yellow"/>');
  if (fmt.underline) parts.push('<w:u w:val="single"/>');
  if (fmt.vertAlign) parts.push(`<w:vertAlign w:val="${fmt.vertAlign}"/>`);
  return parts.length > 0 ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
};

const makeRun = (text: string, fmt: InlineFormat = {}): string =>
  `<w:r>${buildRPr(fmt)}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;

// KaTeX 的视觉层由大量定位 span 组成，无法直接转成 Word 文本；
// 取 MathML 部分的文字作为可读降级（视觉层与 MathML 内容相同，只取一份）。
const getMathText = (element: Element): string => {
  const mathml = element.querySelector(".katex-mathml");
  return cleanText(mathml?.textContent ?? element.textContent);
};

const convertInlineChildren = async (
  parent: Node,
  ctx: DocxContext,
  fmt: InlineFormat = {},
): Promise<string> => {
  let xml = "";
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      xml += makeRun(child.textContent ?? "", fmt);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      xml += await convertInlineElement(child as Element, ctx, fmt);
    }
  }
  return xml;
};

const convertLink = async (
  el: Element,
  ctx: DocxContext,
  fmt: InlineFormat,
): Promise<string> => {
  const href = el.getAttribute("href") ?? "";
  const text = await convertInlineChildren(el, ctx, { ...fmt, linkStyle: true });
  // 文档内锚点（目录跳转等）按普通文本处理，不生成外部链接关系。
  if (!href || href.startsWith("#")) return text;
  ctx.nextRelId += 1;
  const relId = `rId${ctx.nextRelId}`;
  ctx.links.push({ relId, target: href });
  return `<w:hyperlink r:id="${relId}" w:history="1">${text}</w:hyperlink>`;
};

const convertInlineElement = async (
  el: Element,
  ctx: DocxContext,
  fmt: InlineFormat = {},
): Promise<string> => {
  const tag = el.tagName.toLowerCase();
  const classes = el.classList;

  if (classes.contains("katex")) {
    return makeRun(getMathText(el), { ...fmt, italic: true });
  }
  // MathML / 视觉层由外层 .katex 统一处理，避免重复输出。
  if (classes.contains("katex-html") || classes.contains("katex-mathml")) {
    return "";
  }

  switch (tag) {
    case "strong":
    case "b":
      return convertInlineChildren(el, ctx, { ...fmt, bold: true });
    case "em":
    case "i":
      return convertInlineChildren(el, ctx, { ...fmt, italic: true });
    case "u":
      return convertInlineChildren(el, ctx, { ...fmt, underline: true });
    case "s":
    case "strike":
    case "del":
      return convertInlineChildren(el, ctx, { ...fmt, strike: true });
    case "code":
      return makeRun(cleanCodeText(el.textContent ?? ""), { ...fmt, code: true });
    case "mark":
      return convertInlineChildren(el, ctx, { ...fmt, highlight: true });
    case "sub":
      return convertInlineChildren(el, ctx, {
        ...fmt,
        vertAlign: "subscript",
      });
    case "sup": {
      // 脚注引用显示为上标序号，去掉渲染时添加的方括号。
      if (el.hasAttribute("data-xmd-footnote-reference")) {
        const identifier = cleanText(el.textContent).replace(/[[\]]/g, "");
        return makeRun(identifier, { ...fmt, vertAlign: "superscript" });
      }
      return convertInlineChildren(el, ctx, {
        ...fmt,
        vertAlign: "superscript",
      });
    }
    case "br":
      return "<w:r><w:br/></w:r>";
    case "a":
      return convertLink(el, ctx, fmt);
    case "img":
      return (await buildInlineImageRun(el as HTMLImageElement, ctx)) ?? "";
    case "input": {
      const checked = (el as HTMLInputElement).checked;
      return makeRun(checked ? "☑" : "☐", fmt);
    }
    case "small":
      return convertInlineChildren(el, ctx, { ...fmt, small: true });
    case "span": {
      const color = parseColorFromStyle(el.getAttribute("style"));
      return convertInlineChildren(
        el,
        ctx,
        color ? { ...fmt, color } : fmt,
      );
    }
    case "font": {
      const color = el.getAttribute("color");
      return convertInlineChildren(
        el,
        ctx,
        color ? { ...fmt, color: parseColorFromStyle(`color:${color}`) ?? undefined } : fmt,
      );
    }
    case "svg":
    case "video":
    case "audio":
    case "iframe":
      // 矢量与媒体内容不进入 Word。
      return "";
    default:
      // 未知元素（含 button/select 等交互标签）解包为文本，避免内容丢失。
      return convertInlineChildren(el, ctx, fmt);
  }
};

const buildInlineImageRun = async (
  img: HTMLImageElement,
  ctx: DocxContext,
): Promise<string | null> => {
  const src = img.getAttribute("src") ?? "";
  const resolved = src ? await resolveImage(src) : null;
  if (!resolved) return null;
  const media = addMedia(ctx, resolved.bytes, resolved.mime);
  if (!media) return null;
  const { width, height } = await getImageDimensions(img);
  return `<w:r>${buildImageDrawing(ctx, media, width, height)}</w:r>`;
};

// —— 块级内容 ——

interface ParagraphOptions {
  list?: { numId: number; ilvl: number } | null;
  styleId?: string | null;
  jc?: string | null;
  quote?: boolean;
  box?: { color: string } | null;
}

// pPr 子元素必须遵循 OOXML 定义的顺序：
// pStyle → numPr → pBdr → shd → ind → jc。
const buildPPr = (opts: ParagraphOptions = {}): string => {
  const parts: string[] = [];
  if (opts.styleId) parts.push(`<w:pStyle w:val="${opts.styleId}"/>`);
  if (opts.list) {
    parts.push(
      `<w:numPr><w:ilvl w:val="${opts.list.ilvl}"/><w:numId w:val="${opts.list.numId}"/></w:numPr>`,
    );
  }
  if (opts.quote) {
    parts.push(
      '<w:pBdr><w:left w:val="single" w:sz="12" w:space="4" w:color="C9CDD3"/></w:pBdr>',
    );
    parts.push('<w:shd w:val="clear" w:color="auto" w:fill="F7F7F9"/>');
    parts.push('<w:ind w:left="567"/>');
  }
  if (opts.box) {
    parts.push(
      `<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="${opts.box.color}"/></w:pBdr>`,
    );
    parts.push('<w:shd w:val="clear" w:color="auto" w:fill="F7F7F9"/>');
    parts.push('<w:ind w:left="340" w:right="340"/>');
  }
  if (opts.jc) parts.push(`<w:jc w:val="${opts.jc}"/>`);
  return parts.length > 0 ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
};

const buildParagraph = (
  runsXml: string,
  opts: ParagraphOptions = {},
): string => `<w:p>${buildPPr(opts)}${runsXml}</w:p>`;

const BLOCK_CONTAINER_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "pre",
  "table",
  "blockquote",
  "hr",
  "div",
  "section",
  "article",
  "figure",
  "aside",
]);

// 判断元素内部是否含有块级结构；只有行内内容时按段落输出，
// 避免块级转换直接丢弃游离文本。
const hasBlockContent = (el: Element): boolean =>
  Array.from(el.children).some((child) => {
    const tag = child.tagName.toLowerCase();
    return (
      BLOCK_CONTAINER_TAGS.has(tag) ||
      Array.from(child.attributes).some((attribute) =>
        attribute.name.startsWith("data-xmd-"),
      )
    );
  });

const convertUnwrapped = async (
  el: Element,
  ctx: DocxContext,
  opts: ParagraphOptions,
): Promise<string> => {
  if (hasBlockContent(el)) return convertBlockChildren(el, ctx, opts);
  const runsXml = await convertInlineChildren(el, ctx, {});
  if (runsXml === "") return "";
  return buildParagraph(runsXml, opts);
};

const convertBlockChildren = async (
  parent: Element,
  ctx: DocxContext,
  opts: ParagraphOptions = {},
): Promise<string> => {
  let xml = "";
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      xml += await convertBlockElement(child as Element, ctx, opts);
    }
  }
  return xml;
};

const convertParagraphElement = async (
  el: Element,
  ctx: DocxContext,
  opts: ParagraphOptions,
): Promise<string> => {
  const runsXml = await convertInlineChildren(
    el,
    ctx,
    opts.quote ? { italic: true, color: "595959" } : {},
  );
  return buildParagraph(runsXml, opts);
};

const convertList = async (
  el: Element,
  ctx: DocxContext,
  depth: number,
): Promise<string> => {
  const isTaskList = el.getAttribute("data-type") === "taskList";
  const ordered = el.tagName.toLowerCase() === "ol";
  let xml = "";
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    xml += isTaskList
      ? await convertTaskItem(li, ctx)
      : await convertListItem(li, ctx, ordered, depth);
  }
  return xml;
};

const convertListItem = async (
  li: Element,
  ctx: DocxContext,
  ordered: boolean,
  depth: number,
): Promise<string> => {
  const list = { numId: ordered ? 2 : 1, ilvl: Math.min(depth, 8) };
  let pending = "";
  let xml = "";
  const flush = (): void => {
    if (pending.trim() === "") {
      pending = "";
      return;
    }
    xml += buildParagraph(pending, { list });
    pending = "";
  };

  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      pending += makeRun(child.textContent ?? "", {});
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        flush();
        xml += await convertList(element, ctx, depth + 1);
      } else if (BLOCK_CONTAINER_TAGS.has(tag)) {
        flush();
        xml += await convertBlockElement(element, ctx, { list });
      } else {
        pending += await convertInlineElement(element, ctx, {});
      }
    }
  }
  flush();
  return xml;
};

const convertTaskItem = async (li: Element, ctx: DocxContext): Promise<string> => {
  const checked = li.getAttribute("data-checked") === "true";
  const clone = li.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, label").forEach((node) => node.remove());
  const runsXml = await convertInlineChildren(clone, ctx, {});
  return buildParagraph(
    `${makeRun(checked ? "☑ " : "☐ ", { bold: true })}${runsXml}`,
  );
};

const convertCodeBlock = async (
  el: Element,
  ctx: DocxContext,
  opts: ParagraphOptions,
): Promise<string> => {
  const code = el.querySelector("code") ?? el;
  const source = code.textContent ?? "";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  const bodyLines = lines.slice(start, end);
  if (bodyLines.length === 0) bodyLines.push(" ");

  const pPr = buildPPr({ styleId: "CodeBlock", list: opts.list ?? null });
  return bodyLines
    .map(
      (line) =>
        `<w:p>${pPr}${makeRun(line.length > 0 ? line : " ")}</w:p>`,
    )
    .join("");
};

const convertBlockquote = async (
  el: Element,
  ctx: DocxContext,
  opts: ParagraphOptions,
): Promise<string> => {
  return convertBlockChildren(el, ctx, { ...opts, quote: true });
};

const convertTable = async (
  el: Element,
  ctx: DocxContext,
): Promise<string> => {
  const rows = Array.from(el.children).flatMap((child) => {
    const tag = child.tagName.toLowerCase();
    if (tag === "tbody") return Array.from(child.children);
    if (tag === "tr") return [child];
    return [];
  });
  const columns = Math.max(1, ...rows.map((row) => row.children.length));
  const columnWidth = Math.max(500, Math.floor(CONTENT_WIDTH_TWIPS / columns));
  const grid = `<w:tblGrid>${Array.from(
    { length: columns },
    () => `<w:gridCol w:w="${columnWidth}"/>`,
  ).join("")}</w:tblGrid>`;

  const rowsXml: string[] = [];
  for (const row of rows) {
    const isHeader = Array.from(row.children).some(
      (cell) => cell.tagName.toLowerCase() === "th",
    );
    const cellsXml: string[] = [];
    for (const cell of Array.from(row.children)) {
      const contentXml = await convertUnwrapped(cell, ctx, {});
      const innerXml = contentXml === "" ? "<w:p/>" : contentXml;
      const tcPr = [
        '<w:tcPr>',
        `<w:tcW w:w="${columnWidth}" w:type="dxa"/>`,
        '<w:vAlign w:val="center"/>',
        isHeader
          ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>'
          : "",
        "</w:tcPr>",
      ].join("");
      cellsXml.push(`<w:tc>${tcPr}${innerXml}</w:tc>`);
    }
    rowsXml.push(`<w:tr>${cellsXml.join("")}</w:tr>`);
  }

  return [
    "<w:tbl>",
    "<w:tblPr>",
    '<w:tblW w:w="0" w:type="auto"/>',
    "<w:tblBorders>",
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',
    "</w:tblBorders>",
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>',
    "</w:tblPr>",
    grid,
    rowsXml.join(""),
    "</w:tbl>",
  ].join("");
};

// Mermaid 渲染结果是内联 SVG，Word 无法直接使用；先栅格化成 PNG 再嵌入。
const getSvgSize = (svg: SVGSVGElement): { width: number; height: number } => {
  const rect = svg.getBoundingClientRect();
  let width = rect.width > 0 ? rect.width : 640;
  let height = rect.height > 0 ? rect.height : 480;
  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    if (rect.width <= 0 || rect.height <= 0) {
      width = Math.min(viewBox.width, MAX_IMAGE_WIDTH_PX);
      height = Math.round((viewBox.height * width) / viewBox.width);
    }
  }
  if (width > MAX_IMAGE_WIDTH_PX) {
    height = Math.round((height * MAX_IMAGE_WIDTH_PX) / width);
    width = MAX_IMAGE_WIDTH_PX;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
};

const rasterizeSvgToPng = async (svg: SVGSVGElement): Promise<string | null> => {
  try {
    const { width, height } = getSvgSize(svg);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      // 2 倍分辨率输出，保证图表文字在 Word 中清晰可读。
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
};

const convertMermaidBlock = async (
  el: Element,
  ctx: DocxContext,
): Promise<string> => {
  const svg = el.querySelector("svg");
  if (svg instanceof SVGSVGElement) {
    const dataUrl = await rasterizeSvgToPng(svg);
    if (dataUrl) {
      const resolved = decodeDataUrl(dataUrl);
      if (resolved) {
        const media = addMedia(ctx, resolved.bytes, resolved.mime);
        if (media) {
          const { width, height } = getSvgSize(svg);
          return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${buildImageDrawing(ctx, media, width, height)}</w:r></w:p>`;
        }
      }
    }
  }
  // 渲染失败时保留错误信息，避免图表内容整体消失。
  const text = cleanText(el.textContent);
  return text
    ? buildParagraph(makeRun(text, { italic: true, color: "9CA3AF" }), {
        jc: "center",
      })
    : "";
};

const convertMathBlock = async (
  el: Element,
  ctx: DocxContext,
): Promise<string> => {
  const text = getMathText(el) || cleanText(el.textContent);
  return buildParagraph(makeRun(text, { italic: true }), { jc: "center" });
};

const CALLOUT_COLORS: Record<string, string> = {
  NOTE: "6B7280",
  TIP: "16A34A",
  IMPORTANT: "B7791F",
  WARNING: "D97706",
  CAUTION: "DC2626",
};

const convertCalloutBlock = async (
  el: Element,
  ctx: DocxContext,
): Promise<string> => {
  // 结构：外层视图 > 锚点容器 > [图标, 内容列(标题行, 正文)]。
  const anchor = el.firstElementChild;
  const contentEl = anchor?.children[1] as Element | undefined;
  const headerEl = contentEl?.children[0] as Element | undefined;
  const titleEl = headerEl?.children[0] as Element | undefined;
  const bodyEl = contentEl?.children[1] as Element | undefined;
  const calloutType = (el.getAttribute("data-callout-type") ?? "").toUpperCase();
  const color = CALLOUT_COLORS[calloutType] ?? "6B7280";

  let xml = "";
  const title = cleanText(titleEl?.textContent);
  if (title) {
    xml += buildParagraph(makeRun(title, { bold: true, color }), {
      box: { color },
    });
  }
  if (bodyEl) {
    xml += await convertBlockChildren(bodyEl, ctx, { box: { color } });
  }
  return xml;
};

const convertFootnoteBlock = async (
  el: Element,
  ctx: DocxContext,
): Promise<string> => {
  const anchor = el.firstElementChild;
  const idEl = anchor?.children[0] as Element | undefined;
  const bodyEl = anchor?.children[1] as Element | undefined;
  const identifier = cleanText(idEl?.textContent);
  const prefix = identifier ? makeRun(`${identifier} `, { bold: true }) : "";
  const bodyRuns = bodyEl ? await convertInlineChildren(bodyEl, ctx, {}) : "";
  const pPr =
    '<w:pPr><w:pStyle w:val="FootnoteText"/><w:ind w:left="340"/></w:pPr>';
  return `<w:p>${pPr}${prefix}${bodyRuns}</w:p>`;
};

const convertBlockElement = async (
  el: Element,
  ctx: DocxContext,
  opts: ParagraphOptions = {},
): Promise<string> => {
  const tag = el.tagName.toLowerCase();
  const classes = el.classList;

  if (el.hasAttribute("data-xmd-mermaid-view")) {
    return convertMermaidBlock(el, ctx);
  }
  if (el.hasAttribute("data-xmd-math-view")) {
    return convertMathBlock(el, ctx);
  }
  if (el.hasAttribute("data-xmd-callout-view")) {
    return convertCalloutBlock(el, ctx);
  }
  if (el.hasAttribute("data-xmd-footnote-view")) {
    return convertFootnoteBlock(el, ctx);
  }
  // RawMarkdown 块以 pre 形式保存原文，按代码块输出。
  if (el.hasAttribute("data-xmd-raw-markdown")) {
    return convertCodeBlock(el, ctx, opts);
  }
  // 目录、HtmlBlock 兜底 DOM 等没有专属样式的块，直接解包其内容。
  if (
    el.hasAttribute("data-xmd-table-of-contents-view") ||
    el.hasAttribute("data-xmd-html-view")
  ) {
    return convertUnwrapped(el, ctx, opts);
  }
  if (classes.contains("katex-display")) {
    return convertMathBlock(el, ctx);
  }

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      const runsXml = await convertInlineChildren(el, ctx, {});
      return buildParagraph(runsXml, { ...opts, styleId: `Heading${level}` });
    }
    case "p":
      return convertParagraphElement(el, ctx, opts);
    case "ul":
    case "ol":
      return convertList(el, ctx, opts.list?.ilvl ?? 0);
    case "pre":
      return convertCodeBlock(el, ctx, opts);
    case "blockquote":
      return convertBlockquote(el, ctx, opts);
    case "table":
      return convertTable(el, ctx);
    case "hr":
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9CDD3"/></w:pBdr></w:pPr></w:p>';
    case "img":
      return buildImageParagraph(el as HTMLImageElement, ctx);
    case "div":
    case "section":
    case "article":
    case "figure":
    case "aside":
    case "main":
    case "nav":
      return convertUnwrapped(el, ctx, opts);
    case "script":
    case "style":
    case "head":
      return "";
    default:
      // 未知标签按内容解包：含块级结构时逐块转换，只有行内内容时收拢成段落。
      return convertUnwrapped(el, ctx, opts);
  }
};

// —— 文档组装 ——

const DOCX_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="等线" w:cs="Calibri"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:lang w:val="zh-CN" w:eastAsia="zh-CN" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="340" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading5">
    <w:name w:val="heading 5"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="4"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading6">
    <w:name w:val="heading 6"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="5"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="CodeBlock"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:ind w:left="340" w:right="340"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="等线"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FootnoteText">
    <w:name w:val="FootnoteText"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="80"/></w:pPr>
    <w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="6B7280"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;

const DOCX_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="4"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="3600" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="5"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="4320" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="6"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="5040" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="7"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="5760" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="6480" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%4."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="4"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%5."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="3600" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="5"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%6."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="4320" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="6"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%7."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="5040" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="7"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%8."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="5760" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%9."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="6480" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const assembleDocx = async (
  ctx: DocxContext,
  title: string,
  bodyXml: string,
): Promise<ArrayBuffer> => {
  const usedExtensions = new Set(ctx.media.map((media) => media.extension));
  const mediaDefaults = ["png", "jpg", "gif", "webp", "bmp"]
    .filter((extension) => usedExtensions.has(extension))
    .map(
      (extension) =>
        `<Default Extension="${extension}" ContentType="${MEDIA_EXTENSION_CONTENT_TYPE[extension]}"/>`,
    )
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${mediaDefaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  ${ctx.media
    .map(
      (media) =>
        `<Relationship Id="${media.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${media.fileName}"/>`,
    )
    .join("\n  ")}
  ${ctx.links
    .map(
      (link) =>
        `<Relationship Id="${link.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(link.target)}" TargetMode="External"/>`,
    )
    .join("\n  ")}
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const now = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>XMD</dc:creator>
  <cp:lastModifiedBy>XMD</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>XMD Markdown Editor</Application>
</Properties>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels")?.file(".rels", rootRels);
  zip.folder("docProps")?.file("core.xml", coreXml);
  zip.folder("docProps")?.file("app.xml", appXml);
  zip.folder("word")?.file("document.xml", documentXml);
  zip.folder("word")?.file("styles.xml", DOCX_STYLES_XML);
  zip.folder("word")?.file("numbering.xml", DOCX_NUMBERING_XML);
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", documentRels);
  for (const media of ctx.media) {
    zip.folder("word")?.folder("media")?.file(media.fileName, media.bytes);
  }
  return zip.generateAsync({ type: "arraybuffer" });
};

// —— 对外入口 ——

// contentElement 来自导出编辑器渲染出的 .tiptap 内容节点。
export const buildDocx = async (
  contentElement: HTMLElement,
  title: string,
): Promise<ArrayBuffer> => {
  const ctx: DocxContext = { media: [], links: [], nextRelId: 2, drawingId: 0 };
  const bodyXml = await convertBlockChildren(contentElement, ctx, {});
  return assembleDocx(ctx, title, bodyXml);
};
