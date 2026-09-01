import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";
import type { AiDeltaEvent, AiDoneEvent, AiErrorEvent, AiReasoningDeltaEvent } from "../types/ai";

let browserWindow: Window;
let createEditorExtensions: typeof import("../editor/editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/vue-3").Editor;
let useInlineWriter: typeof import("./useInlineWriter").useInlineWriter;

type DeltaListener = (event: AiDeltaEvent) => void;
type ReasoningDeltaListener = (event: AiReasoningDeltaEvent) => void;
type DoneListener = (event: AiDoneEvent) => void;
type ErrorListener = (event: AiErrorEvent) => void;

// 模拟渲染进程的 electronAPI：捕获流式回调，测试里手动按 requestId 触发
const deltaListeners: DeltaListener[] = [];
const reasoningDeltaListeners: ReasoningDeltaListener[] = [];
const doneListeners: DoneListener[] = [];
const errorListeners: ErrorListener[] = [];
const startedRequests: string[] = [];

const emitDelta = (requestId: string, delta: string): void => {
    for (const listener of deltaListeners) listener({ requestId, delta });
};

const emitReasoningDelta = (requestId: string, delta: string): void => {
    for (const listener of reasoningDeltaListeners) listener({ requestId, delta });
};

const emitDone = (requestId: string, finishReason?: AiDoneEvent["finishReason"], completionTokens?: number): void => {
    for (const listener of doneListeners) listener({ requestId, finishReason, completionTokens });
};

const emitError = (requestId: string, error: string): void => {
    for (const listener of errorListeners) listener({ requestId, error });
};

const lastRequestId = (): string => {
    const id = startedRequests.at(-1);
    assert.ok(id, "startWriting 未产生请求");
    return id;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const tableChunks = [
    "| 名称 | 数量 |\n",
    "| --- | --- |\n",
    "| 苹果 | 3 |\n",
    "| 香蕉 | 5 |",
];

before(async () => {
    browserWindow = installDomEnvironment();
    ({ Editor: EditorConstructor } = await import("@tiptap/vue-3"));
    ({ createEditorExtensions } = await import("../editor/editorExtensions"));

    // aiService 读取 window.electronAPI，mock 必须挂到 happy-dom 的 window 上
    (browserWindow as unknown as Record<string, unknown>).electronAPI = {
        aiService: {
            invoke: async (request: { requestId: string }) => {
                startedRequests.push(request.requestId);
            },
            cancel: () => undefined,
            onDelta: (callback: DeltaListener) => {
                deltaListeners.push(callback);
                return () => { };
            },
            onReasoningDelta: (callback: ReasoningDeltaListener) => {
                reasoningDeltaListeners.push(callback);
                return () => { };
            },
            onDone: (callback: DoneListener) => {
                doneListeners.push(callback);
                return () => { };
            },
            onError: (callback: ErrorListener) => {
                errorListeners.push(callback);
                return () => { };
            },
        },
    };

    ({ useInlineWriter } = await import("./useInlineWriter"));
});

after(async () => {
    await browserWindow.happyDOM.abort();
});

describe("内联 AI 实时编写流式渲染", () => {
    test("模型推理增量只临时展示，不写入 Markdown 正文", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "正文起点",
        });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "正文起点",
        });

        try {
            await writer.startWriting("ai-write", "继续写作");
            const requestId = lastRequestId();
            emitReasoningDelta(requestId, "先理解上下文，再组织正文结构。");
            await sleep(160);

            const placeholder = editor.view.dom.querySelector(".ai-writing-placeholder");
            assert.match(placeholder?.textContent ?? "", /思考.*先理解上下文/u);
            assert.doesNotMatch(editor.state.doc.textContent, /先理解上下文/u);

            emitDelta(requestId, "这是最终正文");
            emitDone(requestId, "length", 9168);
            await sleep(60);
            assert.equal(writer.finishReason.value, "length");
            assert.equal(writer.completionTokens.value, 9168);
            assert.match(editor.state.doc.textContent, /这是最终正文/u);
            assert.doesNotMatch(editor.state.doc.textContent, /先理解上下文/u);
        } finally {
            writer.clearGhost();
            editor.destroy();
        }
    });

    test("等待首个增量时保留原文、显示就地反馈并锁定冲突编辑", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "不能提前消失的原文",
        });
        editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "不能提前消失的原文",
            getDocumentContext: () => "",
        });

        try {
            await writer.startWriting("ai-write", "改写这段内容");

            assert.match(editor.state.doc.textContent, /不能提前消失的原文/u);
            assert.equal(editor.isEditable, false, "等待和生成期间正文应只读，避免坐标错位");
            assert.ok(
                editor.view.dom.querySelector(".ai-writing-placeholder"),
                "写入点应展示正在准备内容的反馈",
            );

            const requestId = lastRequestId();
            emitDelta(requestId, "新的内容");
            emitDone(requestId);
            await sleep(50);
            writer.rejectResult();

            assert.match(editor.state.doc.textContent, /不能提前消失的原文/u);
            assert.equal(editor.isEditable, true, "放弃变更后应恢复正文编辑");
        } finally {
            editor.destroy();
        }
    });

    test("流式输出表格时编辑器实时渲染为表格节点", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "",
        });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "",
        });

        try {
            await writer.startWriting("ai-write", "生成一个表格");
            const requestId = lastRequestId();

            // 先来一个增量并等节流渲染完成，模拟流式过程
            emitDelta(requestId, tableChunks[0]);
            await sleep(180);
            assert.match(editor.state.doc.textContent, /名称/, "首个增量渲染后应出现表头");

            // 剩余增量一次性推完，随后结束流
            for (const chunk of tableChunks.slice(1)) emitDelta(requestId, chunk);
            emitDone(requestId);
            await sleep(50);

            // 全量结束后表格语法应被解析成表格节点，而不是纯文本段落
            let tableCount = 0;
            editor.state.doc.descendants((node) => {
                if (node.type.name === "table") tableCount += 1;
            });
            assert.equal(tableCount, 1, `应渲染出表格节点，实际文档：${editor.storage.markdown.getMarkdown()}`);
            assert.match(editor.storage.markdown.getMarkdown(), /苹果/u);
        } finally {
            editor.destroy();
        }
    });

    test("流式输出列数不足的表格行时不再抛出 tableCell 错误", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "",
        });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "",
        });

        try {
            await writer.startWriting("ai-write", "生成表格");
            const requestId = lastRequestId();

            // 表头两列、数据行只写出一列：markdown-it 会为缺少的列补出空单元格，
            // 空单元格必须带上空段落才能满足 tableCell 的结构要求
            emitDelta(requestId, "| 名称 | 数量 |\n| --- | --- |\n| 苹果 |");
            emitDone(requestId);
            await sleep(50);

            let tableCount = 0;
            let tableCellCount = 0;
            editor.state.doc.descendants((node) => {
                if (node.type.name === "table") tableCount += 1;
                if (node.type.name === "tableCell") tableCellCount += 1;
            });
            assert.equal(
                tableCount,
                1,
                `应渲染出表格节点，实际文档：${editor.storage.markdown.getMarkdown()}`,
            );
            assert.ok(
                tableCellCount >= 2,
                "空单元格也应作为 tableCell 渲染，而不是让插入崩溃",
            );
        } finally {
            editor.destroy();
        }
    });

    test("流式渲染过程中拒绝时删除已写入内容", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "",
        });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "",
        });

        try {
            await writer.startWriting("ai-write", "写点什么");
            const requestId = lastRequestId();

            emitDelta(requestId, "# 标题\n\n段落文字");
            emitDone(requestId);
            await sleep(50);
            assert.match(editor.state.doc.textContent, /标题/, "完成后文档应包含生成内容");

            writer.rejectResult();
            assert.equal(editor.state.doc.textContent.trim(), "", "拒绝后应清空生成内容");
        } finally {
            editor.destroy();
        }
    });

    test("流式中途报错时保留已生成部分", async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "",
        });

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "",
        });

        try {
            await writer.startWriting("ai-write", "写点什么");
            const requestId = lastRequestId();

            emitDelta(requestId, "# 出错前的内容");
            emitError(requestId, "网络中断");
            await sleep(50);

            assert.equal(writer.status.value, "error");
            assert.match(editor.state.doc.textContent, /出错前的内容/, "出错时应保留已生成的部分");
        } finally {
            editor.destroy();
        }
    });
});

describe("AI 幽灵标记显示与撤销行为", () => {
    // 创建带正文的编辑器并把光标移到文末，模拟续写场景
    const createWriterAtDocEnd = async () => {
        const editor = new EditorConstructor({
            extensions: createEditorExtensions(),
            content: "原始内容",
        });
        editor.chain().setTextSelection(editor.state.doc.content.size - 1).run();

        const writer = useInlineWriter({
            editor: () => editor,
            getSelection: () => "",
            getDocumentContext: () => "",
        });
        return { editor, writer };
    };

    test("流式中显示书写位置指示条，完成并接受后移除所有幽灵标记", async () => {
        const { editor, writer } = await createWriterAtDocEnd();

        try {
            await writer.startWriting("ai-write", "续写一段");
            const requestId = lastRequestId();

            emitDelta(requestId, "AI 续写的内容");
            await sleep(180);
            assert.ok(
                editor.view.dom.querySelector(".ai-ghost-content"),
                "流式中已写入内容应带幽灵背景标记",
            );
            assert.ok(
                editor.view.dom.querySelector(".ai-ghost-caret"),
                "流式中应显示书写位置指示条",
            );
            assert.ok(
                editor.state.selection.empty,
                "流式写入后选区应保持收起，避免误触发选区气泡菜单遮挡生成内容",
            );

            emitDone(requestId);
            await sleep(50);
            assert.ok(
                editor.view.dom.querySelector(".ai-ghost-content"),
                "完成后幽灵背景标记应保留到接受前",
            );
            assert.equal(
                editor.view.dom.querySelector(".ai-ghost-caret"),
                null,
                "完成后书写位置指示条应消失",
            );

            writer.acceptResult();
            assert.equal(
                editor.view.dom.querySelector(".ai-ghost-content"),
                null,
                "接受后幽灵标记应全部清除",
            );
        } finally {
            editor.destroy();
        }
    });

    test("多次流式渲染不会累积重叠的幽灵装饰", async () => {
        const { editor, writer } = await createWriterAtDocEnd();

        try {
            await writer.startWriting("ai-write", "续写一段");
            const requestId = lastRequestId();

            emitDelta(requestId, "第一段内容。");
            await sleep(180);
            const countAfterFirstRender = editor.view.dom.querySelectorAll(".ai-ghost-content").length;
            assert.ok(countAfterFirstRender >= 1, "首次渲染后应出现幽灵标记");

            emitDelta(requestId, "第二段内容。");
            await sleep(180);
            const countAfterSecondRender = editor.view.dom.querySelectorAll(".ai-ghost-content").length;
            assert.equal(
                countAfterSecondRender,
                countAfterFirstRender,
                "重复标记完整范围时应覆盖旧范围，而不是叠加装饰",
            );
        } finally {
            editor.destroy();
        }
    });

    test("接受后撤销不会逐条回退流式写入记录", async () => {
        const { editor, writer } = await createWriterAtDocEnd();

        try {
            await writer.startWriting("ai-write", "续写一段");
            const requestId = lastRequestId();

            emitDelta(requestId, "AI 续写的内容");
            await sleep(180);
            emitDelta(requestId, "，还在继续写。");
            emitDone(requestId);
            await sleep(50);

            writer.acceptResult();
            assert.match(editor.state.doc.textContent, /还在继续写/, "接受后应保留完整内容");

            editor.commands.undo();
            assert.match(
                editor.state.doc.textContent,
                /还在继续写/,
                "流式写入不进撤销栈，撤销不应删除已接受的AI内容",
            );
        } finally {
            editor.destroy();
        }
    });

    test("拒绝后移除AI内容并恢复正文编辑", async () => {
        const { editor, writer } = await createWriterAtDocEnd();

        try {
            await writer.startWriting("ai-write", "续写一段");
            const requestId = lastRequestId();

            emitDelta(requestId, "AI 续写的内容");
            emitDone(requestId);
            await sleep(50);

            writer.rejectResult();
            assert.doesNotMatch(editor.state.doc.textContent, /续写/, "拒绝后应删除AI内容");
            assert.equal(editor.isEditable, true, "拒绝后应立即恢复正文编辑");
        } finally {
            editor.destroy();
        }
    });
});
