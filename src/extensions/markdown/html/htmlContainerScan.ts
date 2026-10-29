import { normalizeHtmlAlignment } from "./htmlContainerSource";

/**
 * 块级 HTML 容器的形态扫描。
 *
 * 只认领一种写法：开标签独占一行、紧跟一个空行、正文按 Markdown 解析、闭标签独占一行。
 * 这与 GitHub/CommonMark 的语义一致 —— 空行之后的正文才会被当成 Markdown；空行之前的
 * 内容属于原始 HTML 块，不能当成 Markdown 吞掉。
 *
 * 扫描同时负责结构校验：标签必须配平，同名标签允许嵌套；任何不配平、闭标签不在行首、
 * 内层为空的情况都返回 null，调用方据此继续走原来的字面文本兜底，绝不吞掉用户内容。
 */

/** 对齐容器支持的标签。 */
const ALIGNED_WRAPPER_TAGS = new Set(["div", "p", "center"]);

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

/** 标签名允许的字符（首字符必须是字母）。 */
const TAG_NAME_CHARACTER = /[A-Za-z0-9:-]/u;

/** 单行 summary：整行就是一个 `<summary>…</summary>`。 */
const SUMMARY_LINE_PATTERN = /^<summary\b[^>]*>[\s\S]*<\/summary\s*>$/iu;

interface HtmlTag {
  /** 小写标签名。 */
  name: string;
  /** 是否是闭标签（`</div>`）。 */
  closing: boolean;
  /** 是否自闭合（`<img />`）。 */
  selfClosing: boolean;
  /** 标签在源码中的起始位置（`<` 处）。 */
  start: number;
  /** 标签在源码中的结束位置（`>` 之后）。 */
  end: number;
}

/**
 * 从源码的 `<` 处读出一个标签；不是标签时返回 null。
 *
 * 属性值里的 `>` 不能当成标签结束，因此引号内的内容整段跳过。
 */
export const readHtmlTag = (source: string, start: number): HtmlTag | null => {
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
    start,
    end: Math.min(index + 1, source.length),
  };
};

/** 从开标签原文里读对齐方式：`align` 属性优先，其次 style 里的 text-align 声明。 */
const readAlignmentOfOpenTag = (openTag: string): string | null => {
  const attribute = /\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(openTag);
  const fromAttribute = normalizeHtmlAlignment(attribute?.[1] ?? attribute?.[2] ?? attribute?.[3]);
  if (fromAttribute) return fromAttribute;

  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(openTag);
  const styleValue = style?.[1] ?? style?.[2] ?? "";
  const match = /(?:^|;)\s*text-align\s*:\s*([a-z]+)/iu.exec(styleValue);
  return normalizeHtmlAlignment(match?.[1]);
};

/** 找出从 start 开始的那一行结束的位置（换行符之前）。 */
const lineEndOf = (source: string, start: number): number => {
  const newline = source.indexOf("\n", start);
  return newline < 0 ? source.length : newline;
};

/**
 * 把围栏代码块的内容替换成等长空白（保留换行与偏移）。
 *
 * 说明文档的代码示例里常出现 `XMD-<version>-x86_64.AppImage` 这类尖括号，
 * 它们不是标签：不屏蔽的话会被当成未闭合标签，让整个容器判定失败。
 * 等长替换保证后续按字符偏移切出来的原文仍指向用户写的源码。
 */
const maskFencedCode = (source: string): string => {
  const lines = source.split("\n");
  let fenceMarker: string | null = null;

  return lines
    .map((line) => {
      const trimmed = line.trimStart();
      const opening = /^(`{3,}|~{3,})/u.exec(trimmed);
      if (fenceMarker === null) {
        if (!opening) return line;
        fenceMarker = opening[1][0];
        return " ".repeat(line.length);
      }

      const closing = /^(`{3,}|~{3,})\s*$/u.exec(trimmed);
      if (closing && closing[1][0] === fenceMarker) fenceMarker = null;
      return " ".repeat(line.length);
    })
    .join("\n");
};

export type HtmlContainerKind = "aligned" | "details";

export interface HtmlContainerScan {
  kind: HtmlContainerKind;
  /** 开标签原文（去掉行首缩进）。 */
  openSource: string;
  /** 闭标签原文。 */
  closeSource: string;
  /** 对齐方式；details 为 null。 */
  align: string | null;
  /** summary 行原文；没有 summary 行或不是 details 时为 null。 */
  summarySource: string | null;
  /** 内层 Markdown 源码（已去掉首尾空行）。 */
  innerSource: string;
  /** 整段容器占用的行数（从开标签行到闭标签行）。 */
  lineCount: number;
}

/**
 * 扫描块首的 HTML 容器；不满足形态判据时返回 null。
 *
 * 调用方必须把整篇 Markdown 从块首开始传入，函数只关心开头这一段。
 */
export const scanHtmlContainer = (source: string): HtmlContainerScan | null => {
  const openLineEnd = lineEndOf(source, 0);
  const openLine = source.slice(0, openLineEnd);
  const tagStart = openLine.indexOf("<");
  // 开标签最多缩进 3 个空格，且前面不能有别的文字。
  if (tagStart < 0 || tagStart > 3 || openLine.slice(0, tagStart).trim() !== "") return null;

  const openTag = readHtmlTag(openLine, tagStart);
  if (!openTag || openTag.closing) return null;
  // 开标签必须独占一行：后面只剩空白。
  if (openLine.slice(openTag.end).trim() !== "") return null;

  const rootTag = openTag.name;
  const isDetails = rootTag === "details";
  if (!isDetails && !ALIGNED_WRAPPER_TAGS.has(rootTag)) return null;

  const openSource = openLine.trim();
  const align = isDetails
    ? null
    : rootTag === "center"
      ? "center"
      : readAlignmentOfOpenTag(openSource);
  // 没有对齐信息的容器在视觉上没有意义，继续交给原来的路径处理。
  if (!isDetails && !align) return null;

  const lines = source.split("\n");
  let summarySource: string | null = null;
  let contentStartLine = 2;

  if (isDetails) {
    const secondLine = (lines[1] ?? "").trim();
    if (SUMMARY_LINE_PATTERN.test(secondLine)) {
      summarySource = secondLine;
      contentStartLine = 3;
    }
    // summary 行之后必须是空行，正文才算 Markdown。
    if ((lines[contentStartLine - 1] ?? "").trim() !== "") return null;
  } else if ((lines[1] ?? "").trim() !== "") {
    return null;
  }

  // 内层扫描从正文第一行开始；行偏移用字符偏移换算，避免逐行累加换行时算错。
  const lineStarts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  const offsetOfLine = (line: number): number => lineStarts[line] ?? source.length;

  const stack: string[] = [rootTag];
  let closeStart = -1;
  let closeEnd = -1;
  let index = offsetOfLine(contentStartLine);
  // 标签扫描只看屏蔽掉围栏代码的副本；原文切片仍取自 source。
  const masked = maskFencedCode(source);

  while (index < source.length) {
    if (masked.charAt(index) !== "<") {
      index += 1;
      continue;
    }
    // 注释与声明里的尖括号不是标签。
    if (masked.startsWith("<!--", index)) {
      const end = masked.indexOf("-->", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (masked.startsWith("<!", index) || masked.startsWith("<?", index)) {
      const end = masked.indexOf(">", index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    const tag = readHtmlTag(masked, index);
    if (!tag) {
      index += 1;
      continue;
    }

    if (tag.closing) {
      // 游离闭标签（正文里手写的 `</div>`）当普通文本，不改变结构。
      if (stack.length === 0) {
        index = tag.end;
        continue;
      }
      if (stack[stack.length - 1] !== tag.name) return null;
      stack.pop();
      index = tag.end;
      if (stack.length === 0) {
        closeStart = tag.start;
        closeEnd = tag.end;
        break;
      }
      continue;
    }

    index = tag.end;
    if (tag.selfClosing || VOID_TAGS.has(tag.name)) continue;
    if (RAW_TEXT_TAGS.has(tag.name)) {
      // script / style 的内容是纯文本：整段跳到闭标签之后，不参与嵌套计数。
      const close = masked.toLowerCase().indexOf(`</${tag.name}`, index);
      if (close < 0) return null;
      const closeEndIndex = masked.indexOf(">", close);
      index = closeEndIndex < 0 ? source.length : closeEndIndex + 1;
      continue;
    }
    stack.push(tag.name);
  }

  if (closeStart < 0) return null;

  // 闭标签必须独占一行，否则它属于正文里的行内 HTML，不能作为容器边界。
  const closeLineStart = source.lastIndexOf("\n", closeStart - 1) + 1;
  const closeLineEnd = lineEndOf(source, closeEnd);
  const closeSource = source.slice(closeStart, closeEnd);
  if (source.slice(closeLineStart, closeLineEnd).trim() !== closeSource) return null;

  const innerLines = source.slice(offsetOfLine(contentStartLine), closeLineStart).split("\n");
  while (innerLines.length > 0 && (innerLines[0] ?? "").trim() === "") innerLines.shift();
  while (innerLines.length > 0 && (innerLines[innerLines.length - 1] ?? "").trim() === "") {
    innerLines.pop();
  }
  const innerSource = innerLines.join("\n");
  if (innerSource.trim() === "") return null;

  const lineCount = source.slice(0, closeLineEnd).split("\n").length;

  return {
    kind: isDetails ? "details" : "aligned",
    openSource,
    closeSource,
    align,
    summarySource,
    innerSource,
    lineCount,
  };
};
