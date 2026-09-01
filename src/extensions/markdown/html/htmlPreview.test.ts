import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { Window } from 'happy-dom'
import { installDomEnvironment } from '../../../test/domEnvironment'

let browserWindow: Window
let createHtmlPreviewDocument: typeof import('./htmlPreview').createHtmlPreviewDocument

before(async () => {
  browserWindow = installDomEnvironment()
  ;({ createHtmlPreviewDocument } = await import('./htmlPreview'))
})

after(async () => {
  await browserWindow.happyDOM.abort()
})

describe('HTML 隔离预览', () => {
  test('保留当前块的 style 标签和 class', () => {
    const document = createHtmlPreviewDocument('<style>.card { color: red; }</style><div class="card">内容</div>')

    assert.match(document, /<style data-xmd-user-css>\.card \{ color: red; \}<\/style>/)
    assert.match(document, /class="card"/)
    assert.ok(document.indexOf('.card { color: red; }') < document.indexOf('<body>'))
  })

  test('移除脚本、事件属性和嵌套 iframe', () => {
    const eventDocument = createHtmlPreviewDocument('<div onclick="alert(1)">安全内容</div>')
    const scriptDocument = createHtmlPreviewDocument('<script>alert(1)</script>')
    const iframeDocument = createHtmlPreviewDocument('<iframe src="https://example.com"></iframe>')

    assert.doesNotMatch(scriptDocument, /<script/i)
    assert.doesNotMatch(iframeDocument, /<iframe/i)
    assert.doesNotMatch(eventDocument, /onclick/i)
  })

  test('限制预览加载外部资源和提交表单', () => {
    const document = createHtmlPreviewDocument('<div>内容</div>')

    assert.match(document, /default-src 'none'/)
    assert.match(document, /style-src 'unsafe-inline'/)
    assert.match(document, /form-action 'none'/)
  })
})
