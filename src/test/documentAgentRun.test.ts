import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyDocumentPatches } from "../utils/documentAgent";
import { describe, test } from "node:test";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import {
  createAgentDeadline,
  extractDraftAfter,
  getDocumentAgentExecutionProfile,
  getDocumentAgentProviderOptions,
  runDocumentAgent,
} from "../../electron/ai/documentAgentRun";
import type { DocumentAgentEvent } from "../types/documentAgent";
import {
  fingerprintDocument,
  indexDocumentBlocks,
} from "../utils/documentAgentBlocks";

// 模型替身运行真正的 Mastra 循环，验证修改、收尾和最终事件。
const request = {
  requestId: "run",
  instruction: "统一名称",
  document: "旧名",
  documentVersion: fingerprintDocument("旧名"),
  selection: "",
};
const textBlockId = indexDocumentBlocks(request.document)[0].id;
const resultStream = (
  toolName?: string,
  input?: unknown,
  finishReason = toolName ? "tool-calls" : "stop",
) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if (toolName)
        controller.enqueue({
          type: "tool-call",
          toolCallId: crypto.randomUUID(),
          toolName,
          input: JSON.stringify(input),
        });
      else {
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({
          type: "text-delta",
          id: "text",
          delta: "请审阅修改",
        });
        controller.enqueue({ type: "text-end", id: "text" });
      }
      controller.enqueue({
        type: "finish",
        finishReason,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      });
      controller.close();
    },
  });
// 模拟厂商逐段返回工具参数，验证正文预览不是等工具完成后才出现。
const streamedToolCall = (toolName: string, input: string) =>
  new ReadableStream({
    start(controller) {
      const id = crypto.randomUUID();
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "tool-input-start", id, toolName });
      const middle = Math.floor(input.length / 2);
      controller.enqueue({
        type: "tool-input-delta",
        id,
        delta: input.slice(0, middle),
      });
      controller.enqueue({
        type: "tool-input-delta",
        id,
        delta: input.slice(middle),
      });
      controller.enqueue({ type: "tool-input-end", id });
      controller.enqueue({
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      });
      controller.close();
    },
  });
// 输出被截断时不附带工具调用，用于验证宿主程序的有限恢复策略。
const lengthLimitedStream = () =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "reasoning-start", id: "reasoning" });
      controller.enqueue({
        type: "reasoning-delta",
        id: "reasoning",
        delta: "尚未完成的分析",
      });
      controller.enqueue({ type: "reasoning-end", id: "reasoning" });
      controller.enqueue({
        type: "finish",
        finishReason: "length",
        usage: { inputTokens: 10, outputTokens: 1000, totalTokens: 1010 },
      });
      controller.close();
    },
  });
const otherFinishStream = () =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({
        type: "finish",
        finishReason: "other",
        usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      });
      controller.close();
    },
  });
const outcomes = {
  outcomes: [
    { id: "goal-1", state: "done", detail: "名称已统一为 XMD，等待审阅" },
  ],
};

// 在实际 Mastra 循环中运行，验证无批次表单、完整历史与自然结束。
describe("文档 Agent 草稿执行循环", () => {
  test("截图中的标题整理可一轮提交四处编辑，读一次成稿后正常结束", async () => {
    const document = readFileSync(
      new URL("./fixtures/document-agent-plain-text.txt", import.meta.url),
      "utf8",
    );
    const events: DocumentAgentEvent[] = [];
    let step = 0;
    const model = new MastraLanguageModelV2Mock({
      doStream: async (options) => {
        const current = step++;
        assert.deepEqual(options.toolChoice, { type: "auto" });
        assert.deepEqual(
          options.tools?.map((tool) => tool.name),
          ["read", "edit", "write"],
        );
        if (current === 0) {
          // 从模型实际收到的上下文取原文，不能暗中提供块 ID 或任务 ID。
          const prompt = options.prompt
            .map((message) =>
              typeof message.content === "string"
                ? message.content
                : message.content
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : [],
                    )
                    .join(""),
            )
            .join("\n");
          const line = prompt
            .split("\n")
            .find((line) => line.startsWith("当前文档（资料）："))!;
          const snapshot = JSON.parse(line.slice(line.indexOf("：") + 1));
          assert.equal(snapshot.content, document);
          const matches = [
            ...document.matchAll(/^(?:v\.[^\r\n]*版本：|讨论内容：)\r?\n/gm),
          ];
          assert.equal(matches.length, 4);
          return {
            stream: resultStream("edit", {
              edits: matches.map((match) => ({
                old_string: match[0],
                new_string: `## ${match[0].trimEnd()}\n\n`,
              })),
            }),
          };
        }
        if (current === 1) {
          assert.match(JSON.stringify(options.prompt), /草稿已更新/);
          return { stream: resultStream("read", {}) };
        }
        if (current === 2) {
          assert.match(JSON.stringify(options.prompt), /## v/);
          return { stream: resultStream() };
        }
        throw new Error("最终回复后不能再请求模型");
      },
    });
    await runDocumentAgent(
      {
        ...request,
        document,
        documentVersion: fingerprintDocument(document),
        instruction: "检查标题层级和文档结构，只修改必要位置，保留代码块。",
      },
      {
        model,
        timeoutMs: 10000,
        maxTokens: 4000,
        temperature: 0,
        controller: new AbortController(),
        report: (event) => events.push(event),
      },
    );
    const patches = events.flatMap((event) =>
      event.type === "patch" ? [event.patch] : [],
    );
    assert.equal(patches.length, 4);
    assert.equal(step, 3);
    assert.equal(
      applyDocumentPatches(document, patches),
      document.replace(/^(v\.[^\r\n]*版本：|讨论内容：)\r?\n/gm, "## $1\n\n"),
    );
    assert.ok(
      events.some(
        (event) => event.type === "done" && event.outcome === "complete",
      ),
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === "operation" && event.operation.state === "error",
      ),
      false,
    );
  });
  test("连续修订同一位置只发布最终版本，不叠加旧建议", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async (options) => {
        const current = step++;
        if (current === 2) assert.match(JSON.stringify(options.prompt), /XMD/);
        return {
          stream:
            current === 0
              ? resultStream("edit", { old_string: "旧名", new_string: "XMD" })
              : current === 1
                ? resultStream("edit", {
                    old_string: "XMD",
                    new_string: "XMD 编辑器",
                  })
                : resultStream(),
        };
      },
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    const patches = events.flatMap((event) =>
      event.type === "patch" ? [event.patch] : [],
    );
    assert.equal(patches.length, 1);
    assert.equal(applyDocumentPatches(request.document, patches), "XMD 编辑器");
  });
  test("同一轮的多个工具按调用顺序执行，后续编辑可以使用前一个的新正文", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({
        stream:
          step++ === 0
            ? new ReadableStream({
                start(controller) {
                  controller.enqueue({ type: "stream-start", warnings: [] });
                  for (const [id, old_string, new_string] of [
                    ["first", "旧名", "中间版本"],
                    ["second", "中间版本", "最终版本"],
                  ])
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: id,
                      toolName: "edit",
                      input: JSON.stringify({ old_string, new_string }),
                    });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "tool-calls",
                    usage: {
                      inputTokens: 10,
                      outputTokens: 10,
                      totalTokens: 20,
                    },
                  });
                  controller.close();
                },
              })
            : resultStream(),
      }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    const patches = events.flatMap((event) =>
      event.type === "patch" ? [event.patch] : [],
    );
    assert.equal(applyDocumentPatches(request.document, patches), "最终版本");
  });
  test("参数错误返回模型后可重新读取并修正，不重建历史", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async (options) => {
        const current = step++;
        if (current === 1)
          assert.match(JSON.stringify(options.prompt), /当前草稿中不存在/);
        if (current === 2)
          assert.match(JSON.stringify(options.prompt), /不存在的名称/);
        return {
          stream:
            current === 0
              ? resultStream("edit", {
                  old_string: "不存在的名称",
                  new_string: "XMD",
                })
              : current === 1
                ? resultStream("read", {})
                : current === 2
                  ? resultStream("edit", {
                      old_string: "旧名",
                      new_string: "XMD",
                    })
                  : resultStream(),
        };
      },
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) => event.type === "done" && event.outcome === "complete",
      ),
    );
  });
  test("未解决的工具错误不能声明成功", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({
        stream:
          step++ === 0
            ? resultStream("edit", {
                old_string: "不存在",
                new_string: "新内容",
              })
            : resultStream(),
      }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "done" &&
          event.outcome === "incomplete" &&
          event.message?.includes("不存在"),
      ),
    );
  });
  test("空文档直接写入完整草稿，输出预算原样传给模型", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async (options) => {
        assert.equal(options.maxOutputTokens, 16000);
        return {
          stream:
            step++ === 0
              ? resultStream("write", { content: "# 新文档\n\n正文" })
              : resultStream(),
        };
      },
    });
    await runDocumentAgent(
      { ...request, document: "", documentVersion: fingerprintDocument("") },
      {
        model,
        timeoutMs: 10000,
        maxTokens: 16000,
        temperature: 0,
        controller: new AbortController(),
        report: (event) => events.push(event),
      },
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "patch" && event.patch.after === "# 新文档\n\n正文",
      ),
    );
  });
  test("无需修改可以直接正常回复，不强迫调用工具", async () => {
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({ stream: resultStream() }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "done" &&
          event.outcome === "complete" &&
          event.steps === 1,
      ),
    );
    assert.equal(
      events.some((event) => event.type === "patch"),
      false,
    );
  });
  test("达到轮数预算保留有效草稿并明确标记未完成", async () => {
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({
        stream: resultStream("edit", { old_string: "旧名", new_string: "XMD" }),
      }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      agentMaxSteps: 1,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "done" &&
          event.outcome === "incomplete" &&
          event.message?.includes("最大模型请求轮数"),
      ),
    );
    assert.ok(events.some((event) => event.type === "patch"));
  });
  test("后续请求失败时保留已完成修改", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => {
        if (step++ > 0) throw new Error("网络中断");
        return {
          stream: resultStream("edit", {
            old_string: "旧名",
            new_string: "XMD",
          }),
        };
      },
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "done" &&
          event.outcome === "incomplete" &&
          event.message?.includes("网络中断"),
      ),
    );
  });
  test("截断的工具参数不落地，不丢弃历史重试", async () => {
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => {
        calls++;
        return { stream: lengthLimitedStream() };
      },
    });
    await assert.rejects(
      runDocumentAgent(request, {
        model,
        timeoutMs: 10000,
        maxTokens: 1000,
        temperature: 0,
        controller: new AbortController(),
        report: () => {},
      }),
      /单次输出限制/,
    );
    assert.equal(calls, 1);
  });
  test("未知结束原因不能冒充完成", async () => {
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({ stream: otherFinishStream() }),
    });
    await assert.rejects(
      runDocumentAgent(request, {
        model,
        timeoutMs: 10000,
        maxTokens: 1000,
        temperature: 0,
        controller: new AbortController(),
        report: () => {},
      }),
      /other/,
    );
  });
  test("新协议的修改参数流仍然提供实时正文预览", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({
        stream:
          step++ === 0
            ? streamedToolCall(
                "edit",
                JSON.stringify({
                  old_string: "旧名",
                  new_string: "新的 Markdown 内容",
                }),
              )
            : resultStream(),
      }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) => event.type === "draft" && event.text.includes("Markdown"),
      ),
    );
    assert.equal(extractDraftAfter('{"after":"正文\\n'), "正文\n");
  });
  test("厂商不响应 AbortSignal 时取消仍然结束等待", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => {
        started();
        return { stream: new ReadableStream() };
      },
    });
    const task = runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller,
      report: () => {},
    });
    await ready;
    controller.abort(new Error("用户停止"));
    await assert.rejects(task, /用户停止/);
  });
  test("结构错误影响最终结果，不能只凭模型回复宣称通过", async () => {
    let step = 0;
    const events: DocumentAgentEvent[] = [];
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => ({
        stream:
          step++ === 0
            ? resultStream("write", { content: "# 标题\n\n### 跳级" })
            : resultStream(),
      }),
    });
    await runDocumentAgent(request, {
      model,
      timeoutMs: 10000,
      maxTokens: 1000,
      temperature: 0,
      controller: new AbortController(),
      report: (event) => events.push(event),
    });
    assert.ok(
      events.some(
        (event) =>
          event.type === "done" &&
          event.outcome === "incomplete" &&
          event.issues.length === 1,
      ),
    );
  });
  test("MiMo 短格式配置和模型参数保持兼容", () => {
    assert.deepEqual(
      getDocumentAgentProviderOptions(
        { ...request, instruction: "检查标题层级和文档结构" },
        { id: "custom/mimo-v2.5-pro" },
      ),
      { custom: { thinking: { type: "disabled" } } },
    );
    assert.equal(
      getDocumentAgentProviderOptions(
        { ...request, instruction: "深度分析文章结构" },
        { id: "custom/mimo-v2.5-pro" },
      ),
      undefined,
    );
    assert.equal(
      getDocumentAgentProviderOptions(request, { id: "custom/other-model" }),
      undefined,
    );
    assert.equal(
      getDocumentAgentExecutionProfile({
        ...request,
        instruction: "把旧名替换为 XMD",
      }),
      "fast",
    );
  });
});

// 用很短的真实计时验证三种预算相互独立，不连接外部服务。
describe("Agent 独立超时", () => {
  test("没有输出触发无响应超时", async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(
      controller,
      { idleMs: 20, stepMs: 500, taskMs: 1000 },
      () => "定位内容",
    );
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
    assert.match(controller.signal.reason.message, /定位内容.*未返回数据/);
    deadline.dispose();
  });
  test("持续输出不会重置单轮期限", async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(
      controller,
      { idleMs: 1000, stepMs: 40, taskMs: 2000 },
      () => "生成修改",
    );
    const timer = setInterval(deadline.activity, 5);
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
    clearInterval(timer);
    assert.match(controller.signal.reason.message, /本轮请求/);
    deadline.dispose();
  });
  test("不断进入下一轮也不能重置总预算", async () => {
    const controller = new AbortController();
    const deadline = createAgentDeadline(
      controller,
      { idleMs: 1000, stepMs: 1000, taskMs: 40 },
      () => "检查结果",
    );
    const timer = setInterval(deadline.startStep, 5);
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
    clearInterval(timer);
    assert.match(controller.signal.reason.message, /总时间预算/);
    deadline.dispose();
  });
});

// 完成摘要随原子编辑一起提交，验证实际 SDK 不再发起总结网络请求。
test("明确完成且校验通过时一轮结束，并在完成前发布差异", async () => {
  const events: DocumentAgentEvent[] = [];
  let calls = 0;
  const model = new MastraLanguageModelV2Mock({
    doStream: async () => {
      assert.equal(++calls, 1);
      return {
        stream: resultStream("edit", {
          old_string: "旧名",
          new_string: "新名",
          summary: "已统一名称，请审阅。",
        }),
      };
    },
  });
  await runDocumentAgent(request, {
    model,
    timeoutMs: 10000,
    maxTokens: 1000,
    temperature: 0,
    controller: new AbortController(),
    report: (event) => events.push(event),
  });
  assert.equal(calls, 1);
  assert.ok(
    events.some(
      (event) => event.type === "done" && event.outcome === "complete",
    ),
  );
  assert.ok(
    events.findIndex((event) => event.type === "patches") <
      events.findIndex((event) => event.type === "done"),
  );
});

// 模型的完成声明不能跳过结构错误，失败后必须继续修正。
test("完成摘要不能绕过结构校验", async () => {
  let calls = 0;
  const events: DocumentAgentEvent[] = [];
  const model = new MastraLanguageModelV2Mock({
    doStream: async () => {
      calls++;
      return {
        stream:
          calls === 1
            ? resultStream("edit", {
                old_string: "旧名",
                new_string: "# 标题\n### 小节",
                summary: "完成",
              })
            : resultStream(),
      };
    },
  });
  await runDocumentAgent(request, {
    model,
    timeoutMs: 10000,
    maxTokens: 1000,
    temperature: 0,
    controller: new AbortController(),
    report: (event) => events.push(event),
  });
  assert.equal(calls, 2);
  assert.ok(
    events.some(
      (event) => event.type === "done" && event.outcome === "incomplete",
    ),
  );
});

// 已执行的修改可保留，但工具附带的摘要不能把厂商异常终止变成成功。
test("完成摘要不能掩盖未知结束状态", async () => {
  const events: DocumentAgentEvent[] = [];
  const model = new MastraLanguageModelV2Mock({
    doStream: async () => ({
      stream: resultStream(
        "edit",
        { old_string: "旧名", new_string: "新名", summary: "完成" },
        "other",
      ),
    }),
  });
  await runDocumentAgent(request, {
    model,
    timeoutMs: 10000,
    maxTokens: 1000,
    temperature: 0,
    controller: new AbortController(),
    report: (event) => events.push(event),
  });
  assert.ok(
    events.some(
      (event) => event.type === "done" && event.outcome === "incomplete",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.type === "patch" && event.patch.after === "新名",
    ),
  );
});

// 大量微小参数分片只需少量 UI 预览，最终正文和工具输入仍保持完整。
test("长工具参数的预览合并发送，末尾内容不丢失", async () => {
  let calls = 0;
  const events: DocumentAgentEvent[] = [];
  const content = "正文".repeat(10000);
  const model = new MastraLanguageModelV2Mock({
    doStream: async () => {
      if (calls++ > 0) return { stream: resultStream() };
      return {
        stream: new ReadableStream({
          start(controller) {
            const id = crypto.randomUUID();
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "tool-input-start",
              id,
              toolName: "write",
            });
            const input = JSON.stringify({ content });
            for (let index = 0; index < input.length; index += 20) {
              controller.enqueue({
                type: "tool-input-delta",
                id,
                delta: input.slice(index, index + 20),
              });
            }
            controller.enqueue({ type: "tool-input-end", id });
            controller.enqueue({
              type: "finish",
              finishReason: "tool-calls",
              usage: {
                inputTokens: 10,
                outputTokens: 10000,
                totalTokens: 10010,
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
  await runDocumentAgent(request, {
    model,
    timeoutMs: 10000,
    maxTokens: 12000,
    temperature: 0,
    controller: new AbortController(),
    report: (event) => events.push(event),
  });
  const previews = events.flatMap((event) =>
    event.type === "draft" ? [event.text] : [],
  );
  assert.ok(previews.length < 100);
  assert.equal(previews.at(-1), content);
  const patches = events.flatMap((event) =>
    event.type === "patch" ? [event.patch] : [],
  );
  assert.equal(applyDocumentPatches(request.document, patches), content);
});
