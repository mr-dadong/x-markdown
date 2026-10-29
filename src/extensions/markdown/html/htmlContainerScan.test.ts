import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scanHtmlContainer } from "./htmlContainerScan";

/*
 * 容器形态判据：开标签独占一行 + 空行 + Markdown + 空行 + 配平闭标签。
 * 任何不满足的写法都必须返回 null，让调用方继续走字面文本兜底。
 */

describe("scanHtmlContainer 对齐容器", () => {
  test("配平的对齐容器返回开闭标签与内层源码", () => {
    const scan = scanHtmlContainer(
      ['<div align="center">', "", "# 标题", "", "正文", "", "</div>", ""].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.kind, "aligned");
    assert.equal(scan.align, "center");
    assert.equal(scan.openSource, '<div align="center">');
    assert.equal(scan.closeSource, "</div>");
    assert.equal(scan.innerSource, "# 标题\n\n正文");
    assert.equal(scan.lineCount, 7);
    assert.equal(scan.summarySource, null);
  });

  test("没有配平闭标签时返回 null", () => {
    const scan = scanHtmlContainer(['<div align="center">', "", "正文", ""].join("\n"));
    assert.equal(scan, null);
  });

  test("开标签后没有空行时返回 null", () => {
    const scan = scanHtmlContainer(['<div align="center">', "正文", "", "</div>"].join("\n"));
    assert.equal(scan, null);
  });

  test("同名标签嵌套时以最外层闭标签结束", () => {
    const scan = scanHtmlContainer(
      [
        '<div align="center">',
        "",
        "<div>",
        "内层",
        "</div>",
        "",
        "</div>",
        "",
        "容器之后的正文",
      ].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.innerSource, "<div>\n内层\n</div>");
    assert.equal(scan.lineCount, 7);
  });

  test("属性值里的尖括号不影响开标签识别", () => {
    const scan = scanHtmlContainer(
      ['<div style="font-family: a>b" align="center">', "", "正文", "", "</div>"].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.align, "center");
  });

  test("style 里的 text-align 也认", () => {
    const scan = scanHtmlContainer(
      ['<p style="text-align: right">', "", "正文", "", "</p>"].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.align, "right");
  });

  test("<center> 默认居中", () => {
    const scan = scanHtmlContainer(["<center>", "", "正文", "", "</center>"].join("\n"));

    assert.ok(scan);
    assert.equal(scan.align, "center");
  });

  test("没有对齐信息的 div 不认领", () => {
    const scan = scanHtmlContainer(["<div>", "", "正文", "", "</div>"].join("\n"));
    assert.equal(scan, null);
  });

  test("内层为空时不认领", () => {
    const scan = scanHtmlContainer(['<div align="center">', "", "", "</div>"].join("\n"));
    assert.equal(scan, null);
  });

  test("闭标签不在行首时不认领", () => {
    const scan = scanHtmlContainer(
      ['<div align="center">', "", "正文", "结尾</div>"].join("\n"),
    );
    assert.equal(scan, null);
  });
});

describe("scanHtmlContainer 折叠容器", () => {
  test("details + summary 行 + 空行 + 正文", () => {
    const scan = scanHtmlContainer(
      [
        "<details>",
        "<summary><b>完整特性</b></summary>",
        "",
        "- 第一条",
        "- 第二条",
        "",
        "</details>",
        "",
      ].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.kind, "details");
    assert.equal(scan.summarySource, "<summary><b>完整特性</b></summary>");
    assert.equal(scan.innerSource, "- 第一条\n- 第二条");
    assert.equal(scan.lineCount, 7);
  });

  test("没有 summary 行时仍可作为折叠容器", () => {
    const scan = scanHtmlContainer(["<details open>", "", "正文", "", "</details>"].join("\n"));

    assert.ok(scan);
    assert.equal(scan.summarySource, null);
    assert.equal(scan.innerSource, "正文");
  });

  test("summary 行之后没有空行时返回 null", () => {
    const scan = scanHtmlContainer(
      ["<details>", "<summary>标题</summary>", "正文", "", "</details>"].join("\n"),
    );
    assert.equal(scan, null);
  });

  test("围栏代码里的尖括号不参与标签计数", () => {
    const scan = scanHtmlContainer(
      [
        "<details>",
        "<summary>安装说明</summary>",
        "",
        "### Linux",
        "",
        "```bash",
        "chmod +x XMD-<version>-Linux-x86_64.AppImage",
        "./XMD-<version>-Linux-x86_64.AppImage",
        "```",
        "",
        "</details>",
      ].join("\n"),
    );

    assert.ok(scan);
    assert.equal(scan.kind, "details");
    assert.match(scan.innerSource, /XMD-<version>-Linux-x86_64\.AppImage/u);
  });
});
