/**
 * AI 模型输出的 Markdown 归一化。
 *
 * 部分模型（尤其带推理能力的模型）会过度转义 Markdown 标记符，
 * 例如把加粗输出为 `\*\*加粗\*\*`，把波浪线输出为 `\~`。
 * 标准 CommonMark 会把 `\*` 解析为字面星号，导致加粗等语法失效，
 * 用户看到的就是原始星号而非排版效果。
 *
 * 该工具在渲染 / 写入编辑器之前移除这类不必要的反斜杠转义；
 * 代码围栏与行内代码内容保持原样，避免破坏代码本身。
 */

// 代码段（围栏代码块与行内代码）保持原样，不参与转义还原。
const CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

// 常见被过度转义的 Markdown 标记符。刻意排除 \(\)\[\] 等字符，
// 避免破坏模型输出的 LaTeX 数学定界符。
const OVER_ESCAPE_PATTERN = /\\([*_~`#+-])/g;

export const normalizeAiMarkdown = (text: string): string => {
  if (!text.includes("\\")) return text;
  return text
    .split(CODE_SEGMENT_PATTERN)
    .map((segment, index) =>
      index % 2 === 1 ? segment : segment.replace(OVER_ESCAPE_PATTERN, "$1"),
    )
    .join("");
};

/**
 * 从流式尾段（模型尚在写入的最后一段）中识别未闭合的代码围栏。
 * 整段仍停留在未闭合的 ``` 围栏内时，直接交给 markdown-it 会把起始的 ``` 之后的
 * 代码行当成普通段落，破坏换行与高亮；调用方据此降级为不带语法高亮的等宽代码块。
 * 整段已闭合（或根本不含围栏）时返回 null，可当作普通 markdown 正常渲染。
 */
export const extractUnclosedFence = (
  text: string,
): { lang: string; body: string } | null => {
  const lines = text.split("\n");
  let fenceStart = -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      if (!inFence) {
        inFence = true;
        fenceStart = i;
      } else {
        inFence = false;
      }
    }
  }
  if (!inFence || fenceStart < 0) return null;
  return {
    lang: lines[fenceStart].replace(/^\s*```/, "").trim(),
    body: lines.slice(fenceStart + 1).join("\n"),
  };
};
