import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { noopObserve } from "@mastra/core/tools";
import { RequestContext } from "@mastra/core/request-context";
import { createDocumentAgentTools } from "../../electron/ai/documentAgentTools";
import { applyDocumentPatches } from "../utils/documentAgent";

const context = { observe: noopObserve, requestContext: new RequestContext() };
const workspace = (document: string) =>
  createDocumentAgentTools(
    document,
    new AbortController().signal,
    () => {},
    "test",
  );
// 这些测试覆盖最新草稿语义；旧的批次/收尾表单已经不再是生产协议。
describe("文档工作区工具", () => {
  test("只提供 read/edit/write，短文档已读后直接修改", async () => {
    const runtime = workspace("旧名");
    assert.deepEqual(Object.keys(runtime.tools), ["read", "edit", "write"]);
    assert.equal(runtime.initialContext().complete, true);
    const result = (await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD" },
      context,
    )) as any;
    assert.equal(result.ok, true);
    assert.equal(result.revision, 1);
    assert.match(result.message, /草稿已更新/);
    assert.equal(applyDocumentPatches("旧名", runtime.draft.patches()), "XMD");
  });
  test("先读后改，read 返回修改后的内容，二次修改不产生重叠卡片", async () => {
    const runtime = workspace("旧名");
    const rejected = (await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    await runtime.tools.read.execute!({}, context);
    await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD" },
      context,
    );
    const read = (await runtime.tools.read.execute!({}, context)) as any;
    assert.equal(read.content, "1: XMD");
    await runtime.tools.edit.execute!(
      { old_string: "XMD", new_string: "XMD 编辑器" },
      context,
    );
    assert.equal(runtime.draft.patches().length, 1);
    assert.equal(runtime.getUnresolvedError(), "");
  });
  test("整批工具中的后续修改使用新正文，错误操作不会写入", async () => {
    const runtime = workspace("旧名");
    runtime.initialContext();
    await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD" },
      context,
    );
    const rejected = (await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "错误内容" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /当前草稿中不存在/);
    assert.equal(runtime.draft.text(), "XMD");
    assert.equal(runtime.draft.revision(), 1);
  });
  test("一组替换可以引用前面的新正文，任一失败时整组不写入", async () => {
    const runtime = workspace("甲段，乙段");
    runtime.initialContext();
    const rejected = (await runtime.tools.edit.execute!(
      {
        edits: [
          { old_string: "甲段", new_string: "第一段" },
          { old_string: "不存在", new_string: "新文字" },
        ],
      },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.equal(runtime.draft.text(), "甲段，乙段");
    assert.equal(runtime.draft.revision(), 0);
    const result = (await runtime.tools.edit.execute!(
      {
        edits: [
          { old_string: "甲段", new_string: "第一段" },
          { old_string: "第一段", new_string: "首段" },
          { old_string: "乙段", new_string: "第二段" },
        ],
      },
      context,
    )) as any;
    assert.equal(result.ok, true);
    assert.equal(result.replacements, 3);
    assert.equal(result.revision, 1);
    assert.equal(runtime.draft.text(), "首段，第二段");
  });
  test("重复原文必须明确指定全部替换", async () => {
    const runtime = workspace("旧名，旧名");
    runtime.initialContext();
    const rejected = (await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.equal(runtime.draft.revision(), 0);
    const result = (await runtime.tools.edit.execute!(
      { old_string: "旧名", new_string: "XMD", replace_all: true },
      context,
    )) as any;
    assert.equal(result.replacements, 2);
    assert.equal(runtime.draft.text(), "XMD，XMD");
  });
  test("新建、全文重组和跨段落修改不需要 blockId", async () => {
    const runtime = workspace("");
    await runtime.tools.write.execute!(
      { content: "# 文档\n\n第一段\n\n第二段" },
      context,
    );
    await runtime.tools.edit.execute!(
      { old_string: "第一段\n\n第二段", new_string: "合并后的段落" },
      context,
    );
    assert.equal(runtime.draft.text(), "# 文档\n\n合并后的段落");
    assert.equal(runtime.draft.patches().length, 1);
  });
  test("每次修改自动检查结构，修正后错误消失", async () => {
    const runtime = workspace("# 文档\n\n正文");
    runtime.initialContext();
    const result = (await runtime.tools.edit.execute!(
      { old_string: "正文", new_string: "### 小节" },
      context,
    )) as any;
    assert.equal(result.issues.length, 1);
    const fixed = (await runtime.tools.edit.execute!(
      { old_string: "### 小节", new_string: "## 小节" },
      context,
    )) as any;
    assert.deepEqual(fixed.issues, []);
  });
  test("长文档必须 read，超长行按 next 能读取全部内容", async () => {
    const document = "长".repeat(27000) + "\n结尾";
    const runtime = workspace(document);
    assert.equal(runtime.initialContext().complete, false);
    const first = (await runtime.tools.read.execute!({}, context)) as any;
    assert.deepEqual(first.next, { offset: 1, column: 12001 });
    const second = (await runtime.tools.read.execute!(
      first.next,
      context,
    )) as any;
    const third = (await runtime.tools.read.execute!(
      second.next,
      context,
    )) as any;
    assert.equal(third.next, null);
    const body = [first, second, third]
      .map((page) => page.content.replace(/^\d+: /gm, ""))
      .join("");
    assert.equal(body, document);
  });
  test("无效分页和无变化写入明确报错", async () => {
    const runtime = workspace("正文");
    runtime.initialContext();
    const read = (await runtime.tools.read.execute!(
      { offset: 2 },
      context,
    )) as any;
    assert.equal(read.ok, false);
    const write = (await runtime.tools.write.execute!(
      { content: "正文" },
      context,
    )) as any;
    assert.equal(write.ok, false);
    assert.equal(runtime.draft.revision(), 0);
  });
  // 真实模型曾把不完整的 v.2. 猜成 v.2.1，必须在写入前明确拒绝。
  test("拒绝模型猜补版本号，但允许用户明确要求的版本更新", async () => {
    const runtime = createDocumentAgentTools(
      "v.2. 版本：\n正文",
      new AbortController().signal,
      () => {},
      "version",
      "检查标题结构",
    );
    runtime.initialContext();
    const rejected = (await runtime.tools.edit.execute!(
      { old_string: "v.2.", new_string: "v.2.1" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /未提供的版本号/);
    assert.equal(runtime.draft.revision(), 0);
    const allowed = createDocumentAgentTools(
      "v.2. 版本：",
      new AbortController().signal,
      () => {},
      "version",
      "将版本改为 v.2.1",
    );
    allowed.initialContext();
    const result = (await allowed.tools.edit.execute!(
      { old_string: "v.2.", new_string: "v.2.1" },
      context,
    )) as any;
    assert.equal(result.ok, true);
  });
  test("显式保留代码块时，全文写入也不能删除或改变原代码", async () => {
    const document = "# 标题\n\n```js\nconst n = 1;\n```\n";
    const runtime = createDocumentAgentTools(
      document,
      new AbortController().signal,
      () => {},
      "code",
      "优化结构，保留代码块",
    );
    runtime.initialContext();
    const rejected = (await runtime.tools.write.execute!(
      { content: "# 标题\n\n```js\nconst n = 2;\n```\n" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.equal(runtime.draft.text(), document);
    const result = (await runtime.tools.edit.execute!(
      { old_string: "# 标题", new_string: "# 示例" },
      context,
    )) as any;
    assert.equal(result.ok, true);
  });
  test("取消后工具不可再修改草稿", async () => {
    const controller = new AbortController();
    const runtime = createDocumentAgentTools(
      "正文",
      controller.signal,
      () => {},
      "cancel",
    );
    runtime.initialContext();
    controller.abort(new Error("用户停止"));
    await assert.rejects(
      runtime.tools.write.execute!({ content: "新正文" }, context),
      /用户停止/,
    );
    assert.equal(runtime.draft.text(), "正文");
  });
  // 模型带把 Markdown 标记过度转义成 \*\*、\#，写入草稿前必须统一还原。
  test("edit 和 write 还原过度转义，公式内的转义保持原样", async () => {
    const document = "普通段落\n\n公式 $a\\_b$";
    const runtime = workspace(document);
    runtime.initialContext();
    const result = (await runtime.tools.edit.execute!(
      {
        edits: [
          { old_string: "普通段落", new_string: "\\*\\*加粗\\*\\*段落" },
          {
            old_string: "公式 $a\\_b$",
            new_string: "公式 $a\\_b$（不变）\\~补充\\~",
          },
        ],
      },
      context,
    )) as any;
    assert.equal(result.ok, true);
    // 公式内 \_ 保留，公式外的 \~ 还原，patch 输出同样干净。
    const expected = "**加粗**段落\n\n公式 $a\\_b$（不变）~补充~";
    assert.equal(runtime.draft.text(), expected);
    assert.equal(
      applyDocumentPatches(document, runtime.draft.patches()),
      expected,
    );
    const write = (await runtime.tools.write.execute!(
      { content: "\\# 新标题\n\n$$\nx \\* y\n$$" },
      context,
    )) as any;
    assert.equal(write.ok, true);
    assert.equal(runtime.draft.text(), "# 新标题\n\n$$\nx \\* y\n$$");
  });
  // 归一化后与原文相同的修改没有实际意义，应报错让模型重新提交。
  test("修改仅添加转义时被拒绝", async () => {
    const runtime = workspace("# 标题");
    runtime.initialContext();
    const rejected = (await runtime.tools.edit.execute!(
      { old_string: "# 标题", new_string: "\\# 标题" },
      context,
    )) as any;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /必须不同/);
    assert.equal(runtime.draft.revision(), 0);
  });
});

// 分页阅读必须覆盖整篇文档，不能通过只读取最后一页或重复第一页绕过覆盖检查。
test("长文档未读完时拒绝整体覆盖，完整分页后允许写入", async () => {
  const document = "长".repeat(27000) + "\n结尾";
  const runtime = workspace(document);
  runtime.initialContext();
  const first = (await runtime.tools.read.execute!({}, context)) as any;
  await runtime.tools.read.execute!({}, context);
  const last = (await runtime.tools.read.execute!(
    { offset: 2 },
    context,
  )) as any;
  assert.equal(last.next, null);
  assert.equal(last.fullyRead, false);
  const rejected = (await runtime.tools.write.execute!(
    { content: "只剩第一页", summary: "完成" },
    context,
  )) as any;
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /完整 read/);
  assert.equal(runtime.draft.text(), document);
  assert.equal(runtime.getCompletionSummary(), "");
  const second = (await runtime.tools.read.execute!(
    first.next,
    context,
  )) as any;
  const third = (await runtime.tools.read.execute!(
    second.next,
    context,
  )) as any;
  assert.equal(third.fullyRead, true);
  const result = (await runtime.tools.write.execute!(
    { content: document + "\n补充" },
    context,
  )) as any;
  assert.equal(result.ok, true);
});

// 已读全文上的连续修订不应强迫再读全文；部分阅读后仍可做精确的局部修改。
test("阅读覆盖与草稿修订保持一致", async () => {
  const runtime = workspace("长".repeat(13000) + "\n结尾");
  runtime.initialContext();
  await runtime.tools.read.execute!({ offset: 2 }, context);
  const edit = (await runtime.tools.edit.execute!(
    { old_string: "结尾", new_string: "末尾" },
    context,
  )) as any;
  assert.equal(edit.ok, true);
  const blocked = (await runtime.tools.write.execute!(
    { content: "末尾" },
    context,
  )) as any;
  assert.equal(blocked.ok, false);
  const first = (await runtime.tools.read.execute!({}, context)) as any;
  await runtime.tools.read.execute!(first.next, context);
  await runtime.tools.edit.execute!(
    { old_string: "末尾", new_string: "新末尾" },
    context,
  );
  const written = (await runtime.tools.write.execute!(
    { content: runtime.draft.text() + "\n补充" },
    context,
  )) as any;
  assert.equal(written.ok, true);
});
