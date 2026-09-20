import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

// Phase 0 不变量验证：确认「带全部扩展规则的顶层块词法区间数」与
// 「editor.state.doc 顶层子节点数」之间的对应关系，以及每个顶层块是否都能
// 切出有效的源码行区间。这是块级源码映射增量保存方案能否成立的前提。
//
// 迁移说明：本测试原先统计 markdown-it 的 token（nesting / map），
// 迁移到官方 @tiptap/markdown 后解析器换成 marked，token 没有 nesting / map，
// 因此改为统计 sourcePreservingSerializer 提供的顶层块行区间。
// 不变量本身不变：区间与顶层节点一一对应，多出的只能是末尾空段落。

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let topLevelBlockRanges: typeof import("./sourcePreservingSerializer").topLevelBlockRanges;
let EditorConstructor: typeof import("@tiptap/core").Editor;

before(async () => {
    browserWindow = installDomEnvironment();
    // 图片节点视图会通过 electronAPI 读取本地资源，测试里给一个最小替身。
    (browserWindow as unknown as { electronAPI: unknown }).electronAPI = {
        readEditorImage: async () => "",
        readEditorFileBytes: async () => new Uint8Array(),
        onAttachmentCopyProgress: () => () => {},
        getPathForFile: () => "",
    };
    ({ Editor: EditorConstructor } = await import("@tiptap/core"));
    ({ createEditorExtensions } = await import("./editorExtensions"));
    ({ topLevelBlockRanges } = await import("./sourcePreservingSerializer"));
});

after(async () => {
    await browserWindow.happyDOM.abort();
});

interface InspectResult {
    tokens: number;
    docChildren: number;
    invalidRanges: string[];
    childTypes: string[];
}

const inspect = (markdown: string): InspectResult => {
    const editor: Editor = new EditorConstructor({
        extensions: createEditorExtensions(),
        content: markdown,
        contentType: "markdown",
    });
    try {
        const ranges = topLevelBlockRanges(editor, markdown);
        // 区间必须能切出非空源码：行号非负且结束行在起始行之后。
        const invalidRanges = ranges
            .filter((range) => range.startLine < 0 || range.endLine <= range.startLine)
            .map((range) => `${range.startLine}-${range.endLine}`);

        const doc = editor.state.doc;
        const childTypes: string[] = [];
        doc.forEach((node) => childTypes.push(node.type.name));
        return { tokens: ranges.length, docChildren: doc.childCount, invalidRanges, childTypes };
    } finally {
        editor.destroy();
    }
};

const fixtures: Array<{ name: string; markdown: string }> = [
    { name: "标题+段落", markdown: "# 标题\n\n第一段。\n\n第二段。" },
    { name: "无序列表", markdown: "开头。\n\n- 项目一\n- 项目二\n  - 嵌套项\n\n结尾。" },
    { name: "有序列表", markdown: "1. 一\n2. 二\n3. 三" },
    { name: "任务列表", markdown: "- [x] 已完成\n- [ ] 未完成" },
    { name: "引用块", markdown: "> 第一行\n> 第二行\n\n之后。" },
    { name: "围栏代码", markdown: "```js\nconst a = 1;\n```" },
    { name: "以代码块结尾", markdown: "# 标题\n\n```js\nconst a = 1;\n```" },
    { name: "表格", markdown: "| a | b |\n| - | - |\n| 1 | 2 |" },
    { name: "以表格结尾", markdown: "前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |" },
    { name: "分割线", markdown: "上。\n\n---\n\n下。" },
    { name: "行内公式", markdown: "质能方程 $E = mc^2$ 很有名。" },
    { name: "块级公式", markdown: "$$\n\\int_0^1 x^2 dx\n$$" },
    { name: "mermaid", markdown: "```mermaid\ngraph TD\n  A --> B\n```" },
    { name: "callout", markdown: "> [!NOTE]- 标题\n> 第一行\n> 第二行" },
    { name: "脚注", markdown: "带脚注的文字[^note]。\n\n[^note]: 脚注内容" },
    { name: "TOC", markdown: "[TOC]\n\n# 标题" },
    { name: "HTML块", markdown: '<section data-kind="demo"><strong>HTML 内容</strong></section>' },
    { name: "多元素HTML块", markdown: "<div>a</div>\n<p>b</p>" },
    { name: "raw扩展", markdown: ":::custom key=value\n扩展正文 **不得被改写**\n:::" },
    { name: "图片", markdown: '正文。\n\n<img src="./images/demo.png" alt="示例" width="320">' },
    { name: "硬换行", markdown: "第一行  \n第二行" },
    { name: "高亮", markdown: "这是 ==高亮== 文本。" },
    { name: "空文档", markdown: "" },
    { name: "仅空行", markdown: "\n\n   \n" },
    { name: "YAML前置", markdown: "---\ntitle: 测试\ntags:\n  - markdown\n---\n\n正文。" },
];

describe("Phase 0：顶层块 token 与 PM 节点对齐不变量", () => {
    for (const fixture of fixtures) {
        test(`${fixture.name}：区间有效且 doc 子节点数 >= 顶层块数`, () => {
            const result = inspect(fixture.markdown);
            assert.deepEqual(result.invalidRanges, [], `${fixture.name} 存在无法切出源码的顶层块区间`);
            assert.ok(
                result.docChildren >= result.tokens,
                `${fixture.name} doc 子节点(${result.docChildren}) < token(${result.tokens})`,
            );
            // 多出的必须都在末尾且为空段落（TrailingParagraph / 空文档补位）。
            const extra = result.docChildren - result.tokens;
            if (extra > 0) {
                const tail = result.childTypes.slice(result.tokens);
                assert.ok(
                    tail.every((type) => type === "paragraph"),
                    `${fixture.name} 末尾多出的节点不是段落：${JSON.stringify(tail)}`,
                );
            }
        });
    }
});
