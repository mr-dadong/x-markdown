import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import JSZip from "jszip";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let buildExportDocx: typeof import("./useExport").buildExportDocx;
let buildExportHtml: typeof import("./useExport").buildExportHtml;
let buildExportText: typeof import("./useExport").buildExportText;
let buildExportZip: typeof import("./useExport").buildExportZip;
let mountCodeBlockSnapshot: typeof import("../utils/codeBlockImage").mountCodeBlockSnapshot;

const localResources = new Map<string, Uint8Array>([
  ["./images/same.png", new Uint8Array([1, 2, 3])],
  ["./other/same.png", new Uint8Array([4, 5, 6])],
  ["./files/manual.pdf", new Uint8Array([7, 8, 9])],
]);

before(async () => {
  browserWindow = installDomEnvironment();
  Object.defineProperty(browserWindow, "electronAPI", {
    configurable: true,
    value: {
      readEditorFileBytes: async (url: string) => {
        const bytes = localResources.get(url);
        if (!bytes) throw new Error(`测试资源不存在：${url}`);
        return bytes;
      },
      readEditorImage: async () => "data:image/png;base64,AQID",
    },
  });
  ({ buildExportDocx, buildExportHtml, buildExportText, buildExportZip } = await import("./useExport"));
  // 代码块截图模块与导出同主题，但依赖 html-to-image，这里只加载克隆准备函数。
  ({ mountCodeBlockSnapshot } = await import("../utils/codeBlockImage"));
});

after(async () => {
  await browserWindow.happyDOM.abort();
});

describe("纯文本与 ZIP 导出", () => {
  test("纯文本导出逐字符保留 Markdown", () => {
    const markdown = "# 中文\r\n\r\n保留  \r\n换行与 $公式$";
    assert.equal(buildExportText(markdown), markdown);
  });

  test("ZIP 收集本地资源、处理重名并改写为可移植路径", async () => {
    const markdown = [
      "![第一张](./images/same.png)",
      "![第二张](./other/same.png)",
      '[说明书](./files/manual.pdf "xmd-attachment:12")',
      "![远程图片](https://example.com/remote.png)",
    ].join("\n");
    const data = await buildExportZip(markdown, "C:\\docs\\article.md", "article.md");
    const zip = await JSZip.loadAsync(data);

    assert.deepEqual(
      Object.keys(zip.files).sort(),
      ["article.md", "assets/", "assets/manual.pdf", "assets/same-2.png", "assets/same.png"],
    );
    assert.deepEqual(await zip.file("assets/same.png")?.async("uint8array"), new Uint8Array([1, 2, 3]));
    assert.deepEqual(await zip.file("assets/same-2.png")?.async("uint8array"), new Uint8Array([4, 5, 6]));

    const portableMarkdown = await zip.file("article.md")?.async("string");
    assert.ok(portableMarkdown?.includes("assets/same.png"));
    assert.ok(portableMarkdown?.includes("assets/same-2.png"));
    assert.ok(portableMarkdown?.includes("assets/manual.pdf"));
    assert.ok(portableMarkdown?.includes("https://example.com/remote.png"));
  });

  test("ZIP 中缺失的资源保留原引用且不阻断其他资源", async () => {
    const markdown = "![存在](./images/same.png)\n![缺失](./images/missing.png)";
    const data = await buildExportZip(markdown, null, "article.md");
    const zip = await JSZip.loadAsync(data);
    const portableMarkdown = await zip.file("article.md")?.async("string");

    assert.ok(portableMarkdown?.includes("assets/same.png"));
    assert.ok(portableMarkdown?.includes("./images/missing.png"));
  });

  test("ZIP 按资源处理和压缩阶段报告递增进度", async () => {
    const progress: number[] = [];
    await buildExportZip(
      "![第一张](./images/same.png)\n![第二张](./other/same.png)",
      null,
      "article.md",
      (item) => progress.push(item.percent),
    );

    assert.equal(progress[0], 5);
    assert.ok(progress.includes(70));
    assert.equal(progress.at(-1), 100);
    assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  });
});

describe("HTML 与 DOCX 导出", () => {
  const markdown = [
    "# 导出标题",
    "",
    "正文包含 **粗体**、[链接](https://example.com) 与控制字符：\u0001结束。",
    "",
    "| 名称 | 数量 |",
    "| --- | ---: |",
    "| 示例 | 2 |",
  ].join("\n");

  test("HTML 导出生成完整文档并转义标题", async () => {
    const html = await buildExportHtml(markdown, null, '标题 <测试> & "引用"');

    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>标题 &lt;测试&gt; &amp; &quot;引用&quot;</title>"));
    assert.ok(html.includes("<h1>导出标题</h1>"));
    assert.ok(html.includes("<strong>粗体</strong>"));
    assert.ok(html.includes("https://example.com"));
    assert.ok(html.includes("<table"));
    assert.ok(!html.includes("data-xmd-image"));
  });

  test("HTML、PDF 与图片共用的导出页面会折行长代码且不保留横向滚动", async () => {
    const longCode = `const message = "${"很长的代码内容".repeat(40)}";`;
    const html = await buildExportHtml(`\`\`\`ts\n${longCode}\n\`\`\``, null, "长代码导出");

    // 代码正文必须完整保留，导出专用样式位于页面样式末尾并覆盖编辑器的滚动样式。
    const exportedDocument = new DOMParser().parseFromString(html, "text/html");
    const pre = exportedDocument.querySelector("pre");
    const code = pre?.querySelector("code");
    assert.equal(code?.textContent, longCode);
    assert.equal(pre?.classList.contains("overflow-x-auto"), false);
    assert.equal(pre?.classList.contains("whitespace-pre"), false);
    assert.equal(pre?.classList.contains("w-full"), true);
    assert.equal(pre?.classList.contains("min-w-0"), true);
    assert.equal(pre?.classList.contains("!overflow-x-visible"), true);
    assert.equal(pre?.classList.contains("!whitespace-pre-wrap"), true);
    assert.equal(pre?.classList.contains("whitespace-pre-wrap"), true);
    assert.equal(pre?.classList.contains("!break-all"), true);
    assert.equal(code?.classList.contains("!min-w-0"), true);
    assert.equal(code?.classList.contains("!break-all"), true);
  });

  test("DOCX 导出生成合法包结构、正文、链接和安全 XML", async () => {
    const data = await buildExportDocx(markdown, null, "导出测试");
    const zip = await JSZip.loadAsync(data);
    const requiredFiles = [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/document.xml",
      "word/styles.xml",
      "word/numbering.xml",
      "word/_rels/document.xml.rels",
    ];
    for (const fileName of requiredFiles) assert.ok(zip.file(fileName), `DOCX 缺少 ${fileName}`);

    const documentXml = await zip.file("word/document.xml")?.async("string");
    const relationships = await zip.file("word/_rels/document.xml.rels")?.async("string");
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    assert.ok(documentXml?.includes("导出标题"));
    assert.ok(documentXml?.includes("粗体"));
    assert.ok(documentXml?.includes("<w:tbl>"));
    assert.ok(!documentXml?.includes("\u0001"));
    assert.ok(relationships?.includes('Target="https://example.com"'));
    assert.ok(coreXml?.includes("<dc:title>导出测试</dc:title>"));
  });

  test("DOCX 完整保留长代码并允许 Word 按页面宽度换行", async () => {
    const longCode = `const token = "${"abcdef0123456789".repeat(40)}";`;
    const data = await buildExportDocx(`\`\`\`ts\n${longCode}\n\`\`\``, null, "长代码 Word 导出");
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    assert.ok(documentXml?.includes(longCode));
    assert.ok(!documentXml?.includes("<w:noWrap"));
  });
});

describe("代码块截图克隆准备", () => {
  // 模拟编辑器中已渲染的代码块 DOM：窗口式标题栏（含操作按钮区）+ 带语法高亮的 pre/code。
  const createCodeBlockDom = (): HTMLElement => {
    const root = document.createElement("div");
    root.className = "code-block-editor";
    root.innerHTML = [
      '<div data-xmd-code-header class="code-header"><div class="code-actions"><button type="button">复制</button></div></div>',
      '<pre class="whitespace-pre overflow-x-auto"><code class="language-ts"><span class="hljs-keyword">const</span> value = 1</code></pre>',
    ].join("");
    return root;
  };

  test("只保留纯代码内容：去标题栏与边框，回为圆角卡片", () => {
    const host = mountCodeBlockSnapshot(createCodeBlockDom(), false);
    try {
      // 屏幕外容器已挂到 body，宽度按最长代码行收缩，四周留白形成卡片效果。
      assert.ok(document.body.contains(host));
      assert.ok(host.style.width.includes("max-content"));
      assert.ok(host.style.padding.includes("16px"));
      // 窗口式标题栏（含红绿灯、语言选择器与操作按钮）不进入分享图。
      assert.ok(!host.querySelector("[data-xmd-code-header]"));
      assert.ok(!host.querySelector("button"));
      // 语法高亮标记保留，长行从横向滚动改为完整展开。
      assert.ok(host.querySelector(".hljs-keyword"));
      const preStyle = (host.querySelector("pre") as HTMLElement).style;
      assert.equal(preStyle.overflow, "visible");
      // 去掉窗口边框，统一为独立圆角卡片；
      // 用 borderStyle 断言，避免 happy-dom 与浏览器对 shorthand 序列化的差异。
      assert.equal(preStyle.borderStyle, "none");
      assert.equal(preStyle.borderRadius, "10px");
      // code 改为按内容取宽，避免 flex 布局把代码行压窄；
      // CSSOM 会把 shorthand 值 none 序列化为展开形式 0 0 auto。
      assert.ok(["none", "0 0 auto"].includes((host.querySelector("code") as HTMLElement).style.flex));
    } finally {
      host.remove();
    }
  });

  test("自动换行时固定宽度折行且保持 code 弹性", () => {
    const host = mountCodeBlockSnapshot(createCodeBlockDom(), true);
    try {
      assert.ok(host.style.width.includes("800px"));
      // 折行模式沿用 flex-1 填满固定宽度，不覆盖 code 的弹性。
      assert.equal((host.querySelector("code") as HTMLElement).style.flex, "");
    } finally {
      host.remove();
    }
  });
});
