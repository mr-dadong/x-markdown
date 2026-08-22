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
});
