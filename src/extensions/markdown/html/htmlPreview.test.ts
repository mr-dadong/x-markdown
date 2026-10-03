import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { Window } from 'happy-dom'
import { installDomEnvironment } from '../../../test/domEnvironment'

let browserWindow: Window
let createHtmlPreviewDocument: typeof import('./htmlPreview').createHtmlPreviewDocument
let createResolvedHtmlPreviewDocument: typeof import('./htmlPreview').createResolvedHtmlPreviewDocument

before(async () => {
  browserWindow = installDomEnvironment()
  ;({ createHtmlPreviewDocument, createResolvedHtmlPreviewDocument } = await import('./htmlPreview'))
})

after(async () => {
  await browserWindow.happyDOM.abort()
})

/** 走完整的解析 + DOM 清洗链路，返回最终预览文档。 */
const resolvePreview = (source: string): Promise<string> =>
  createResolvedHtmlPreviewDocument(source, async url => url)

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

  test('本地相对图片转换为 CSP 允许的 data URL', async () => {
    const resolvedUrls: string[] = []
    const document = await createResolvedHtmlPreviewDocument(
      '<img src="./images/demo.png" alt="示例">',
      async url => {
        resolvedUrls.push(url)
        return 'data:image/png;base64,AQID'
      },
    )

    assert.deepEqual(resolvedUrls, ['./images/demo.png'])
    assert.match(document, /src="data:image\/png;base64,AQID"/)
    assert.doesNotMatch(document, /src="\.\/images\/demo\.png"/)
  })

  test('网络截图和徽章也通过图片读取接口转成 data URL', async () => {
    const urls: string[] = []
    // 包含协议相对地址和查询参数，验证图片地址没有在 HTML 解析时丢失。
    const document = await createResolvedHtmlPreviewDocument(
      '<div align="center"><p><img src="https://example.com/hero.png"></p><p><img src="//example.com/badge.svg?a=1&amp;b=2"></p></div>',
      async url => { urls.push(url); return 'data:image/png;base64,AQID' },
    )
    assert.deepEqual(urls, ['https://example.com/hero.png', 'https://example.com/badge.svg?a=1&b=2'])
    assert.equal((document.match(/src="data:image\/png;base64,AQID"/g) ?? []).length, 2)
    assert.match(document, /img-src data: blob:/)
  })

  test('图片读取失败时明确报告错误，不生成残缺预览', async () => {
    await assert.rejects(createResolvedHtmlPreviewDocument('<img src="https://example.com/a.png">', async () => {
      throw new Error('下载图片超时')
    }), /下载图片超时/)
  })

  test('不再以 flex 强制压缩内容宽度，保留横向滚动而非裁掉内容', () => {
    const document = createHtmlPreviewDocument('<div style="width: 900px">宽内容</div>')

    // 去掉旧的 display:flex / flex-direction:column 压缩，避免固定宽度内容被压扁。
    assert.doesNotMatch(document, /body\s*\{[^}]*display:\s*flex/)
    assert.doesNotMatch(document, /body\s*>\s*\*\s*\{[^}]*min-width:\s*0/)
    // 宽度溢出时允许横向滚动，而不是 overflow hidden 裁掉。
    assert.match(document, /body\s*\{[^}]*overflow-x:\s*auto/)
    assert.doesNotMatch(document, /body\s*\{[^}]*overflow:\s*hidden/)
    // 预览遵循标准 CSS 盒模型，避免用户 HTML 的 border/padding 意外撑破块宽。
    assert.match(document, /body :where\(\*\) \{ box-sizing: border-box; \}/)
    // 常见定宽元素保留固有宽度，不被压缩。
    assert.match(document, /pre, table, video, canvas, svg/)
  })
})

describe('预览的 DOM 级清洗', () => {
  /*
   * 字符串正则要求 `on*` 属性前面是空白，遇到粘贴来的紧凑 HTML 就会漏掉，
   * 属性照样进到预览 iframe 里被执行，控制台报
   * 「Blocked script execution in 'about:srcdoc' …」。
   * 这里覆盖那些正则覆盖不到的写法，确保任何形式都到不了 iframe。
   */
  const cases: Array<[string, string, string]> = [
    ['属性紧跟在引号后', '<div title="a"onclick="alert(1)">x</div>', '<div title="a">x</div>'],
    ['属性紧跟在斜杠后', '<div/onclick="alert(1)">x</div>', '<div>x</div>'],
    ['属性名大小写混合', '<div OnClick="alert(1)">x</div>', '<div>x</div>'],
    ['图片 onerror', '<img src="x" onerror="alert(1)">', '<img src="x">'],
    ['javascript: 链接', '<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['未闭合的 script', '<script>alert(1)', ''],
    ['嵌套 srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', ''],
    ['表单元素', '<form action="/x"><input><button>提交</button></form>', ''],
  ]

  for (const [name, source, expectedBody] of cases) {
    test(`${name}：${JSON.stringify(source)}`, async () => {
      const document = await resolvePreview(source)
      const body = (/<body>([\s\S]*)<\/body>/u.exec(document)?.[1] ?? '').trim()

      assert.equal(body, expectedBody, '危险内容不应进入预览 body')
      assert.doesNotMatch(document, /<script/i)
      assert.doesNotMatch(document, /\son[a-z]+\s*=/iu)
      assert.doesNotMatch(document, /javascript:/iu)
    })
  }

  test('合法内容不被误删', async () => {
    const document = await resolvePreview(
      '<style>.card { color: red; }</style><div class="card" style="color:red" data-id="1">正常内容</div><table><tr><td>单元格</td></tr></table>',
    )

    // class / style / data 属性都是 CSS 选择器需要的信息，必须保留。
    assert.match(document, /class="card"/)
    assert.match(document, /style="color:red"/)
    assert.match(document, /data-id="1"/)
    assert.match(document, /<td>单元格<\/td>/)
    // 经 DOMParser 序列化后空值属性写成 `=""`，这里按最终形态断言。
    assert.match(document, /<style data-xmd-user-css="">\.card \{ color: red; \}<\/style>/)
  })

  test('head 里自己的 CSP 与样式不会被清洗掉', async () => {
    const document = await resolvePreview('<p>ddd</p>')

    assert.match(document, /Content-Security-Policy/)
    assert.match(document, /default-src 'none'/)
    assert.match(document, /data-xmd-user-css/)
  })
})
