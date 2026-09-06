import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { installDomEnvironment } from "../test/domEnvironment";
import { formatChatContext } from "../utils/aiChatContext";
import type { AiChatDeltaEvent, AiChatDoneEvent, AiChatErrorEvent, AiChatRequest } from "../types/ai";

// 模拟 Electron 的流事件，验证真实发送流程、持久化与重试行为。
let browserWindow: ReturnType<typeof installDomEnvironment>;
let useAiChat: typeof import("./useAiChat").useAiChat;
let createApp: typeof import("vue").createApp;
let toRaw: typeof import("vue").toRaw;
let delta: (event: AiChatDeltaEvent) => void;
let done: (event: AiChatDoneEvent) => void;
let error: (event: AiChatErrorEvent) => void;
let failure: "none" | "stream" | "invoke" = "none";
const requests: AiChatRequest[] = [];

before(async () => {
  browserWindow = installDomEnvironment();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browserWindow.localStorage });
  (browserWindow as unknown as Record<string, unknown>).electronAPI = {
    aiService: {
      chatInvoke: async (request: AiChatRequest) => {
        requests.push(request);
        if (failure === "invoke") throw new Error("连接失败");
        if (failure === "stream") {
          error({ requestId: request.requestId, error: "请求超时" });
        } else {
          delta({ requestId: request.requestId, delta: "回答正文" });
          done({ requestId: request.requestId });
        }
        return { requestId: request.requestId };
      },
      chatCancel: () => {},
      onChatDelta: (callback: typeof delta) => { delta = callback; return () => {}; },
      onChatDone: (callback: typeof done) => { done = callback; return () => {}; },
      onChatError: (callback: typeof error) => { error = callback; return () => {}; },
      onChatReasoningDelta: () => () => {},
    },
  };
  ({ useAiChat } = await import("./useAiChat"));
  ({ createApp, toRaw } = await import("vue"));
});

beforeEach(() => {
  browserWindow.localStorage.clear();
  requests.length = 0;
  failure = "none";
});

after(async () => { await browserWindow.happyDOM.abort(); });

// 挂载最小组件，让组合函数的监听器按正常组件生命周期释放。
function mountChat() {
  let chat!: ReturnType<typeof useAiChat>;
  const app = createApp({
    setup() {
      chat = useAiChat({
        getDocumentContext: () => "当前文档",
        getSelection: () => "后来选中的另一段内容",
        getCursorOffset: () => null,
        insertAtCursor: () => {},
        replaceSelection: () => {},
        filePath: () => "reference-test.md",
      });
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return { chat, unmount: () => app.unmount() };
}

test("提问与多段引用独立存储，清空选区不改变历史，追问继续携带原引用", async () => {
  const { chat, unmount } = mountChat();
  try {
    const references = ["第一段\n```js\nconst a = 1\n```", "第二段 <div>原文</div>"];
    const snapshot = [...references];
    assert.equal(await chat.sendMessage("比较这两段", undefined, references), true);
    references.length = 0;
    assert.equal(chat.messages.value[0].content, "比较这两段");
    assert.deepEqual(toRaw(chat.messages.value[0].references), snapshot);
    assert.deepEqual(requests[0].messages[0].references, snapshot);
    assert.equal(requests[0].selection, "");
    chat.loadHistory();
    assert.deepEqual(toRaw(chat.messages.value[0].references), snapshot);
    await chat.sendMessage("继续解释");
    assert.deepEqual(requests[1].messages[0].references, snapshot);
    assert.equal(requests[1].messages.at(-1)?.content, "继续解释");
    const modelText = formatChatContext(requests[0].messages[0]);
    assert.ok(modelText.startsWith("比较这两段\n"));
    assert.deepEqual(JSON.parse(modelText.slice(modelText.indexOf("[{"))).map((item: { content: string }) => item.content), snapshot);
  } finally { unmount(); }
});

test("重新生成保留原引用且不重复添加用户消息", async () => {
  const { chat, unmount } = mountChat();
  try {
    await chat.sendMessage("总结", undefined, ["原选区"]);
    const userId = chat.messages.value[0].id;
    assert.equal(await chat.retry(), true);
    assert.equal(chat.messages.value.filter((message) => message.role === "user").length, 1);
    assert.equal(chat.messages.value[0].id, userId);
    assert.deepEqual(requests[1].messages[0].references, ["原选区"]);
    assert.equal(requests[1].selection, "");
  } finally { unmount(); }
});

for (const mode of ["stream", "invoke"] as const) {
  test(`${mode} 失败返回未成功，重发保留引用且不重复提问`, async () => {
    const { chat, unmount } = mountChat();
    try {
      failure = mode;
      assert.equal(await chat.sendMessage("分析", undefined, ["需要分析的正文"]), false);
      assert.deepEqual(toRaw(chat.messages.value[0].references), ["需要分析的正文"]);
      failure = "none";
      assert.equal(await chat.sendMessage("分析", undefined, ["需要分析的正文"]), true);
      assert.equal(chat.messages.value.filter((message) => message.role === "user").length, 1);
      assert.deepEqual(requests[1].messages[0].references, ["需要分析的正文"]);
    } finally { unmount(); }
  });
}

test("旧历史和无引用消息保持原来的正文", async () => {
  const oldMessage = { id: "old", role: "user", content: "原来的问题", timestamp: 1 };
  browserWindow.localStorage.setItem("ai-chat-reference-test.md", JSON.stringify([oldMessage]));
  const { chat, unmount } = mountChat();
  try {
    assert.deepEqual(toRaw(chat.messages.value[0]), oldMessage);
    await chat.sendMessage("新的问题");
    assert.equal(formatChatContext(requests[0].messages[0]), "原来的问题");
    assert.equal(formatChatContext(requests[0].messages[1]), "新的问题");
  } finally { unmount(); }
});
