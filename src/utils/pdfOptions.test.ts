import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PDF_PLACEHOLDERS,
  buildHeaderFooterTemplate,
  resolvePdfPrintOptions,
  type PdfSettings,
} from "./pdfOptions";

const baseSettings: PdfSettings = {
  pdfPageSize: "A4",
  pdfPageWidth: 8.27,
  pdfPageHeight: 11.69,
  pdfMargin: 0.5,
  pdfHeaderText: "",
  pdfFooterText: "",
};

describe("PDF 打印参数", () => {
  test("内置纸张直接使用名称，页边距四边一致", () => {
    const options = resolvePdfPrintOptions({ ...baseSettings, pdfMargin: 0.75 });

    assert.equal(options.pageSize, "A4");
    assert.deepEqual(options.margins, { top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 });
  });

  test("自定义纸张换算成英寸尺寸", () => {
    const options = resolvePdfPrintOptions({
      ...baseSettings,
      pdfPageSize: "custom",
      pdfPageWidth: 5.5,
      pdfPageHeight: 8.5,
    });

    assert.deepEqual(options.pageSize, { width: 5.5, height: 8.5 });
  });

  test("页眉页脚全为空时关闭打印器的默认页眉页脚", () => {
    const options = resolvePdfPrintOptions(baseSettings);

    assert.equal(options.displayHeaderFooter, false);
    assert.equal(options.headerTemplate, "");
    assert.equal(options.footerTemplate, "");
  });

  test("填写页眉页脚后打开开关，并生成对应模板", () => {
    const options = resolvePdfPrintOptions({
      ...baseSettings,
      pdfHeaderText: "项目文档",
      pdfFooterText: "第 ${pageNo} / ${pageCount} 页",
    });

    assert.equal(options.displayHeaderFooter, true);
    assert.ok(options.headerTemplate.includes("项目文档"));
    assert.ok(options.footerTemplate.includes('class="pageNumber"'));
    assert.ok(options.footerTemplate.includes('class="totalPages"'));
    // Chromium 的页眉页脚默认字号为 0，模板里必须显式写字号，否则打印出来是空白。
    assert.match(options.footerTemplate, /font-size:\s*9px/u);
  });
});

describe("页眉页脚模板", () => {
  test("占位符换成 Chromium 的对应元素，其余文字原样保留", () => {
    const template = buildHeaderFooterTemplate("${title} - ${date}");

    assert.ok(template.includes('<span class="title"></span>'));
    assert.ok(template.includes('<span class="date"></span>'));
  });

  test("全部占位符都被支持", () => {
    for (const placeholder of PDF_PLACEHOLDERS) {
      const template = buildHeaderFooterTemplate(`\${${placeholder}}`);
      assert.ok(
        !template.includes("${"),
        `占位符 \${${placeholder}} 未被替换：${template}`,
      );
    }
  });

  test("用户文字里的 HTML 被转义，未知占位符保持原文", () => {
    const template = buildHeaderFooterTemplate("<b>粗体</b> & ${unknown}");

    assert.ok(template.includes("&lt;b&gt;"));
    assert.ok(template.includes("&amp;"));
    assert.ok(template.includes("${unknown}"));
  });
});
