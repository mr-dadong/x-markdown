import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractUnclosedFence, normalizeAiMarkdown } from "./aiMarkdown";

describe("normalizeAiMarkdown", () => {
  test("还原加粗标记的过度转义", () => {
    assert.equal(normalizeAiMarkdown("\\*\\*2\\*\\*"), "**2**");
    assert.equal(
      normalizeAiMarkdown("这是\\*\\*重点\\*\\*内容"),
      "这是**重点**内容",
    );
  });

  test("还原斜体 / 删除线 / 行内代码 / 标题 / 列表的过度转义", () => {
    assert.equal(normalizeAiMarkdown("*\\~150M*"), "*~150M*");
    assert.equal(normalizeAiMarkdown("\\_斜体\\_"), "_斜体_");
    assert.equal(normalizeAiMarkdown("\\~\\~删除\\~\\~"), "~~删除~~");
    assert.equal(normalizeAiMarkdown("\\# 标题"), "# 标题");
    assert.equal(normalizeAiMarkdown("\\- 列表项"), "- 列表项");
  });

  test("行内代码中的内容保持原样", () => {
    assert.equal(
      normalizeAiMarkdown("使用 `\\*\\*bold\\*\\*` 语法"),
      "使用 `\\*\\*bold\\*\\*` 语法",
    );
  });

  test("围栏代码块中的内容保持原样", () => {
    const source = "示例：\n```md\n\\*\\*2\\*\\*\n```\n结束 \\- 说明";
    assert.equal(
      normalizeAiMarkdown(source),
      "示例：\n```md\n\\*\\*2\\*\\*\n```\n结束 - 说明",
    );
  });

  test("行内公式中的转义保持原样，公式外照常还原", () => {
    assert.equal(normalizeAiMarkdown("公式 $a\\_b$ 结束"), "公式 $a\\_b$ 结束");
    assert.equal(
      normalizeAiMarkdown("$x \\* y$ 外部 \\* 还原"),
      "$x \\* y$ 外部 * 还原",
    );
  });

  test("块级公式跨行时其中的转义保持原样", () => {
    const source =
      "说明：\n$$\na \\_ b\n\\begin{cases} 1 \\end{cases}\n$$\n结束 \\- 列表";
    assert.equal(
      normalizeAiMarkdown(source),
      "说明：\n$$\na \\_ b\n\\begin{cases} 1 \\end{cases}\n$$\n结束 - 列表",
    );
  });

  test("不成对的 $ 不阻碰外部转义还原", () => {
    assert.equal(normalizeAiMarkdown("花费 $100 \\* 以上"), "花费 $100 * 以上");
    // 两个 $ 夹住的内容按公式保护，宁可少还原也不误伤 LaTeX。
    assert.equal(normalizeAiMarkdown("价格 $5 \\* $10"), "价格 $5 \\* $10");
  });

  test("普通文本与合法转义不受影响", () => {
    assert.equal(normalizeAiMarkdown("C:\\code\\nb"), "C:\\code\\nb");
    assert.equal(
      normalizeAiMarkdown("LaTeX \\(x\\) 与 \\[y\\] 不变"),
      "LaTeX \\(x\\) 与 \\[y\\] 不变",
    );
    assert.equal(
      normalizeAiMarkdown("无转义文本 **加粗** 正常"),
      "无转义文本 **加粗** 正常",
    );
    assert.equal(normalizeAiMarkdown(""), "");
  });
});

describe("extractUnclosedFence", () => {
  test("无代码围栏时返回 null，按普通 markdown 渲染", () => {
    assert.equal(extractUnclosedFence("普通段落文字"), null);
    assert.equal(extractUnclosedFence("## 标题\n\n- 列表项"), null);
  });

  test("未闭合围栏返回语言与正文（围栏之后内容）", () => {
    assert.deepEqual(extractUnclosedFence("```ts\nconst a = 1"), {
      lang: "ts",
      body: "const a = 1",
    });
    assert.deepEqual(extractUnclosedFence("```js"), { lang: "js", body: "" });
    assert.deepEqual(extractUnclosedFence("```   \n几行代码\n没写完"), {
      lang: "",
      body: "几行代码\n没写完",
    });
  });

  test("围栏已闭合时返回 null", () => {
    assert.equal(extractUnclosedFence("```py\nprint(1)\n```"), null);
    assert.equal(extractUnclosedFence("上文\n```go\nb()\n```\n后续"), null);
  });

  test("多个围栏、仅最后一个未闭合时提取该围栏", () => {
    const fence = extractUnclosedFence("```a\n1\n```\n```b\n2");
    assert.deepEqual(fence, { lang: "b", body: "2" });
  });
});
