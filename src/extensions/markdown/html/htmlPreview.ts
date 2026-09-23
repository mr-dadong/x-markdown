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
    body :where(*) { box-sizing: border-box; }
    /* 内容保留固有宽度：显式声明了宽度/min-width 的元素水平溢出并触发横向滚动，不再被视口压缩压扁。 */
    body :where(pre, table, video, canvas, svg) { max-width: none; }
  </style>
  <style data-xmd-user-css>${userCss}</style>
</head>
<body>${safeContent}</body>
</html>`
}

/** 预览 body 中必须整体移除的元素：能执行脚本，或能加载外部资源、提交表单。 */
const FORBIDDEN_ELEMENTS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'button',
  'textarea',
  'select',
  'input',
  'link',
  'meta',
  'base',
].join(',')

/** 能执行脚本的 URL 协议，预览里一律清空对应属性。 */
const DANGEROUS_URL_SCHEME = /^\s*(?:javascript|vbscript|data:text\/html)/i

/**
 * 以解析后的 DOM 为准做最终清洗，只处理 body —— head 里是我们自己写的 CSP 与样式。
 *
 * 上面的字符串正则是第一道过滤，只能覆盖常见写法：`on*` 属性前面不是空白时会被漏掉，
 * 例如粘贴来的紧凑 HTML `<div title="a"onclick="…">`、`<div/onclick="…">`。
 * 这类属性照样会进到预览 iframe 里被执行，控制台报
 * 「Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed…」。
 * 这里按 DOM 逐元素清理，任何书写形式都逃不掉。
 */
const sanitizePreviewBody = (body: HTMLElement | null): void => {
  if (!body) return

  for (const element of Array.from(body.querySelectorAll(FORBIDDEN_ELEMENTS))) {
    element.remove()
  }

  for (const element of Array.from(body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      // 事件处理属性（onclick、onload…）与嵌套 srcdoc 一律删除。
      if (/^on[a-z]+$/u.test(name) || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
        continue
      }
      if (DANGEROUS_URL_SCHEME.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
}

/**
 * HTML 预览 iframe 只允许 data/blob 图片。本地相对路径必须先由主进程读取，
 * 否则浏览器会把它解析成渲染页的 http 地址并被 CSP 拦截。
 */
export const createResolvedHtmlPreviewDocument = async (
  source: string,
  resolveLocalImage: (url: string) => Promise<string>,
): Promise<string> => {
  const previewDocument = new DOMParser().parseFromString(
    createHtmlPreviewDocument(source),
    'text/html',
  )
  sanitizePreviewBody(previewDocument.body)
  const images = Array.from(previewDocument.querySelectorAll<HTMLImageElement>('img[src]'))

  await Promise.all(images.map(async image => {
    const url = image.getAttribute('src') ?? ''
    // 网络图片继续由预览 CSP 明确拦截；这里只转换文档附近的本地资源。
    if (!url || /^(?:data:|blob:|https?:|\/\/)/i.test(url)) return
    image.setAttribute('src', await resolveLocalImage(url))
  }))

  return `<!doctype html>\n${previewDocument.documentElement.outerHTML}`
}
