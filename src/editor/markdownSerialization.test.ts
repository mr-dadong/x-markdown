import assert from "node:assert/strict";
import { describe, test } from "node:test";
import MarkdownIt from "markdown-it";
import { Schema } from "@tiptap/pm/model";
import {
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from "prosemirror-markdown";
import {
  configureTyporaTableParsing,
  createCodeFence,
  createTableDelimiter,
  escapeTablePipes,
  hasEscapedCodePipes,
  getTableCodePipeStyles,
  parseTableAlignment,
  protectTableCodePipesForParsing,
  renderMarkdownTable,
  restoreTableBackticks,
  serializeFencedCodeBlock,
  serializeMarkdownTableNode,
} from "./markdownSerialization";

describe("Markdown 表格序列化边界", () => {
  test("保留左中右对齐标记", () => {
    assert.equal(createTableDelimiter(parseTableAlignment("left")), ":---");
    assert.equal(createTableDelimiter(parseTableAlignment("center")), ":---:");
    assert.equal(createTableDelimiter(parseTableAlignment("right")), "---:");
    assert.equal(createTableDelimiter(parseTableAlignment(null)), "---");
  });

  test("只转义普通文本中尚未转义的表格竖线", () => {
    assert.equal(escapeTablePipes("x|y"), "x\\|y");
    assert.equal(escapeTablePipes("x\\|y"), "x\\|y");
    assert.equal(escapeTablePipes("|x||y|"), "\\|x\\|\\|y\\|");
    assert.equal(escapeTablePipes("`a | b`"), "`a | b`");
    assert.equal(escapeTablePipes("`a | b`", true), "`a \\| b`");
    assert.equal(escapeTablePipes("`a \\ | b` | 文字"), "`a \\ | b` \\| 文字");
  });

  test("识别表格原本采用的代码竖线转义风格", () => {
    assert.equal(hasEscapedCodePipes("| `a \\| b` |"), true);
    assert.equal(hasEscapedCodePipes("| `a | b` |"), false);
    assert.equal(hasEscapedCodePipes("| a \\| b |"), false);
  });

  test("逐个单元格记录混合代码竖线风格", () => {
    assert.deepEqual(
      getTableCodePipeStyles([
        "| A | B |",
        "| --- | --- |",
        "| `a \\| b` | `c | d` |",
      ].join("\n")),
      [
        [false, false],
        [true, false],
      ],
    );
  });

  test("重新生成表格时仅移除孤立反引号的转义", () => {
    assert.equal(restoreTableBackticks("b\\`"), "b`");
    assert.equal(restoreTableBackticks("b\\``"), "b``");
    assert.equal(restoreTableBackticks("\\`字面量\\`"), "\\`字面量\\`");
    assert.equal(restoreTableBackticks("`code`"), "`code`");
  });

  test("整表计算列宽后稳定输出，不串入其他单元格内容", () => {
    assert.equal(
      renderMarkdownTable([
        [
          { content: "原文", alignment: null },
          { content: "此列应为空", alignment: null },
          { content: "", alignment: null },
        ],
        [
          { content: "`a \\ | b`", alignment: null },
          { content: "", alignment: null },
          { content: "", alignment: null },
        ],
        [
          { content: "b`", alignment: null },
          { content: "", alignment: null },
          { content: "", alignment: null },
        ],
      ]),
      [
        "| 原文      | 此列应为空 |     |",
        "| --------- | ---------- | --- |",
        "| `a \\ | b` |            |     |",
        "| b`        |            |     |",
      ].join("\n"),
    );
  });

  test("ProseMirror 真实序列化链路不会添加反引号转义或重复单元格", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        heading: {
          content: "inline*",
          group: "block",
          attrs: { level: { default: 1 } },
        },
        text: { group: "inline" },
        table: {
          content: "tableRow+",
          group: "block",
          attrs: { codePipeStyles: { default: [] } },
        },
        tableRow: { content: "(tableHeader|tableCell)+" },
        tableHeader: {
          content: "paragraph",
          attrs: { alignment: { default: null } },
        },
        tableCell: {
          content: "paragraph",
          attrs: { alignment: { default: null } },
        },
      },
      marks: {
        code: {},
      },
    });
    const document = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "表格前的文字" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "原文" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "此列应为空" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph" }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a \\ | b", marks: [{ type: "code" }] }] }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b`" }] }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    });
    const serializer = new MarkdownSerializer(
      {
        ...defaultMarkdownSerializer.nodes,
        table: serializeMarkdownTableNode,
      },
      defaultMarkdownSerializer.marks,
    );

    assert.equal(
      serializer.serialize(document),
      [
        "# 表格前的文字",
        "",
        "| 原文      | 此列应为空 |     |",
        "| --------- | ---------- | --- |",
        "| `a \\ | b` |            |     |",
        "| b`        |            |     |",
      ].join("\n"),
    );
  });

  test("ProseMirror 重新生成时保留原表格的代码竖线转义风格", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
        table: {
          content: "tableRow+",
          group: "block",
          attrs: { codePipeStyles: { default: [] } },
        },
        tableRow: { content: "(tableHeader|tableCell)+" },
        tableHeader: { content: "paragraph", attrs: { alignment: { default: null } } },
        tableCell: { content: "paragraph", attrs: { alignment: { default: null } } },
      },
      marks: { code: {} },
    });
    const document = schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "table",
        attrs: { codePipeStyles: [[false], [true]] },
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "原文" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a | b", marks: [{ type: "code" }] }] }] }] },
        ],
      }],
    });
    const serializer = new MarkdownSerializer(
      { ...defaultMarkdownSerializer.nodes, table: serializeMarkdownTableNode },
      defaultMarkdownSerializer.marks,
    );

    assert.equal(
      serializer.serialize(document),
      "| 原文     |\n| -------- |\n| `a \\| b` |",
    );
  });

  test("Typora 风格行内代码只在解析时保护竖线", () => {
    const markdown = [
      "| 原文 | 此列应为空 |",
      "| --- | --- |",
      "| `a | b` |  |",
    ].join("\n");

    assert.equal(
      protectTableCodePipesForParsing(markdown),
      [
        "| 原文 | 此列应为空 |",
        "| --- | --- |",
        "| `a \\| b` |  |",
      ].join("\n"),
    );
  });

  test("表格内不含竖线的行内代码仍正常渲染", () => {
    const parser = new MarkdownIt();
    configureTyporaTableParsing(parser);

    const rendered = parser.render([
      "| 公式 |",
      "| --- |",
      "| `/2*b2` |",
    ].join("\n"));

    assert.match(rendered, /<td><code>\/2\*b2<\/code><\/td>/u);
  });

  test("解析保护不修改围栏代码块和已经转义的竖线", () => {
    const markdown = [
      "| `a \\| b` |",
      "```text",
      "| `a | b` |",
      "```",
    ].join("\n");

    assert.equal(protectTableCodePipesForParsing(markdown), markdown);
  });

  test("未闭合反引号后的列分隔符保持原样", () => {
    const markdown = "| b` |  |  |";
    assert.equal(protectTableCodePipesForParsing(markdown), markdown);
  });

  test("重复处理不会继续增加反斜杠", () => {
    const markdown = "| `a \\ | b ` |  |";
    const once = protectTableCodePipesForParsing(markdown);
    assert.equal(protectTableCodePipesForParsing(once), once);
  });

  test("解析前保护 Typora 风格代码范围内的裸竖线", () => {
    const markdown = [
      "| 原文 | 此列应为空 |",
      "| --- | --- |",
      "| `a \\ | b ` |  |",
    ].join("\n");

    assert.equal(
      protectTableCodePipesForParsing(markdown),
      [
        "| 原文 | 此列应为空 |",
        "| --- | --- |",
        "| `a \\ \\| b ` |  |",
      ].join("\n"),
    );

    const rendered = new MarkdownIt().render(
      protectTableCodePipesForParsing(markdown),
    );
    assert.match(rendered, /<td><code>a \\ \| b <\/code><\/td>/u);
    assert.doesNotMatch(rendered, /<td>b <\/code><\/td>/u);
  });

  test("解析插件分别记录裸竖线和转义竖线风格", () => {
    const parser = new MarkdownIt();
    configureTyporaTableParsing(parser);
    const escaped = parser.render("| A | B |\n| --- | --- |\n| `a \\| b` | |");
    const raw = parser.render("| A | B |\n| --- | --- |\n| `a | b` | |");
    assert.match(escaped, /data-xmd-code-pipe-styles=/u);
    assert.match(raw, /data-xmd-code-pipe-styles=/u);
    assert.notEqual(escaped, raw);
  });
});

describe("Markdown 代码块序列化边界", () => {
  test("围栏长度始终可以包住代码内容", () => {
    assert.equal(createCodeFence("普通代码"), "```");
    assert.equal(createCodeFence("包含 ``` 围栏"), "````");
    assert.equal(createCodeFence("包含 ````` 围栏"), "``````");
  });

  test("准确保留代码内容的尾随换行数量", () => {
    assert.equal(serializeFencedCodeBlock("第一行\n第二行", "text"), "```text\n第一行\n第二行\n```");
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n", ""), "```\n第一行\n第二行\n\n```");
    assert.equal(serializeFencedCodeBlock("第一行\n第二行\n\n", ""), "```\n第一行\n第二行\n\n\n```");
  });
});
