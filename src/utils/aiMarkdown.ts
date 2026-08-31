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
