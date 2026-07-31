import MarkdownIt from "markdown-it";

// Callout 与脚注正文只启用安全的基础 Markdown，不解析原始 HTML。
const safeMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export const renderSafeMarkdown = (source: string): string => safeMarkdown.render(source);
