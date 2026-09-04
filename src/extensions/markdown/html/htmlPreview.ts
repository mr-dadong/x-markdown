const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * 为单个 HTML 块生成独立预览文档。
 * iframe 负责隔离 CSS，sandbox 与 CSP 共同阻止脚本和外部资源进入编辑器环境。
 */
export const createHtmlPreviewDocument = (source: string): string => {
  const userStyleBlocks: string[] = []
  // 只抽取完整的 style 块，避免 DOMParser 重构用户 HTML；剩余正文仍由 DOMPurify 负责清洗。
  const htmlWithoutStyles = source.replace(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi, (_block, css: string) => {
    userStyleBlocks.push(css)
    return ''
  })
  const userCss = userStyleBlocks.join('\n')

  // 只移除明确危险的结构和事件属性，保留 class、data 属性等 CSS 选择器需要的信息。
  // 即使遇到不完整标签，iframe 仍未开放脚本权限，CSP 也会阻止外部资源和表单提交。
  const safeContent = htmlWithoutStyles
    .replace(/<(script|iframe|object|embed|form|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:input|link|meta|base)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s(?:on[a-z]+|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
  <style>
    html { color-scheme: light dark; background: transparent; }
    body { width: 100%; min-height: 1px; margin: 0; overflow-x: auto; overflow-y: hidden; color: light-dark(#252525, #e4e6eb); background: transparent; }
    /* 内容保留固有宽度：显式声明了宽度/min-width 的元素水平溢出并触发横向滚动，不再被视口压缩压扁。 */
    body :where(pre, table, video, canvas, svg) { max-width: none; }
  </style>
  <style data-xmd-user-css>${userCss}</style>
</head>
<body>${safeContent}</body>
</html>`
}
