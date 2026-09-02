import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../test/domEnvironment";

let browserWindow: Window;
let createEditorExtensions: typeof import("./editorExtensions").createEditorExtensions;
let EditorConstructor: typeof import("@tiptap/core").Editor;
let captureBaseline: typeof import("./sourcePreservingSerializer").captureBaseline;
let serializePreservingSource: typeof import("./sourcePreservingSerializer").serializePreservingSource;

before(async () => {
    browserWindow = installDomEnvironment();
    ({ Editor: EditorConstructor } = await import("@tiptap/core"));
    ({ createEditorExtensions } = await import("./editorExtensions"));
    ({ captureBaseline, serializePreservingSource } = await import("./sourcePreservingSerializer"));
});

after(async () => {
    await browserWindow.happyDOM.abort();
});

const withEditor = <T>(content: string, run: (editor: Editor) => T): T => {
    const editor: Editor = new EditorConstructor({
        extensions: createEditorExtensions(),
        content,
    });
    try {
        return run(editor);
    } finally {
        editor.destroy();
    }
};

/**
 * 载入原文建立 baseline，再把文档切换到“编辑后”的状态，返回合并序列化结果。
 * setContent 重建的文档中，未改动块与 baseline 指纹一致 -> 命中保留；
 * 改动块指纹不同 -> 单块重新序列化，正是真实编辑的对齐语义。
 */
const mergeAfterEdit = (baselineMarkdown: string, editedMarkdown: string): string =>
    withEditor(baselineMarkdown, (editor) => {
        const baseline = captureBaseline(editor, baselineMarkdown);
        editor.commands.setContent(editedMarkdown, false);
        return serializePreservingSource(editor, baseline);
    });

/** 未做任何编辑：合并结果必须与原文逐字节相同（gap+source+trailing 精确切分原文）。 */
const serializeUnchanged = (markdown: string): string =>
    withEditor(markdown, (editor) => {
        const baseline = captureBaseline(editor, markdown);
        return serializePreservingSource(editor, baseline);
    });

/** 对照：整篇重新序列化（现有 getMarkdown 行为），用于证明未编辑块会被规范化改写。 */
const fullReserialize = (markdown: string): string =>
    withEditor(markdown, (editor) => editor.storage.markdown.getMarkdown());

describe("未编辑文档逐字节保真", () => {
    const fixtures: Array<[string, string]> = [
        ["标题与段落", "# 标题\n\n第一段。\n\n第二段。"],
        ["相邻异构列表不被拆开", "- 甲\n* 乙"],
        ["下划线强调不被规范化", "*星号斜体* 和 _下划线斜体_"],
        ["表格分隔宽度保留", "| 名称 | 数量 |\n| :----: | -----: |\n| 苹果 | 1 |"],
        ["代码围栏中的竖线与反引号", "````typescript\nconst fence = ```;\nconsole.log('a | b');\n````"],
        ["行尾两空格硬换行", "第一行  \n第二行"],
        ["块级公式", "$$\n\\int_0^1 x^2 dx\n$$"],
        ["mermaid", "```mermaid\ngraph TD\n  A --> B\n```"],
        ["callout", "> [!NOTE]- 标题\n> 第一行\n> 第二行"],
        ["脚注引用与定义", "带脚注的文字[^note]。\n\n[^note]: 脚注内容"],
        ["TOC", "[TOC]\n\n# 标题"],
        ["raw 扩展块", ":::custom key=value\n扩展正文 **不得被改写**\n:::"],
        ["多元素 HTML 块", "<div>a</div>\n<p>b</p>"],
        ["YAML 前置", "---\ntitle: 测试\ntags:\n  - markdown\n---\n\n正文。"],
        ["以代码块结尾", "# 标题\n\n```js\nconst a = 1;\n```"],
        ["以表格结尾", "前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |"],
        ["EOF 换行保留", "# 标题\n\n正文。\n"],
        ["空文档", ""],
        ["仅空行", "\n\n   \n"],
    ];

    for (const [name, markdown] of fixtures) {
        test(name, () => {
            assert.equal(serializeUnchanged(markdown), markdown);
        });
    }
});

describe("只重新序列化改动过的块", () => {
    const baselineMarkdown = "# 标题\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙";

    test("改标题，其余易被规范化的块逐字节保留", () => {
        const edited = "# 新标题\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙";
        const output = mergeAfterEdit(baselineMarkdown, edited);
        // 下划线强调不变星号、`* 乙` 不变 `- 乙`、相邻列表不被拆成两段。
        assert.equal(output, "# 新标题\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙");
        // 对照：整篇重新序列化会把这些未编辑块规范化改写。
        assert.notEqual(fullReserialize(edited), output);
        assert.ok(fullReserialize(edited).includes("*下划线*"), "全量序列化应已把 _下划线_ 改写为 *下划线*");
    });

    test("真实事务在标题末尾插入字符，只影响标题块", () => {
        const output = withEditor(baselineMarkdown, (editor) => {
            const baseline = captureBaseline(editor, baselineMarkdown);
            const headingEnd = 1 + editor.state.doc.child(0).content.size;
            editor.view.dispatch(editor.state.tr.insertText("X", headingEnd));
            return serializePreservingSource(editor, baseline);
        });
        assert.equal(output, "# 标题X\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙");
    });

    test("编辑段落时表格分隔宽度原样保留", () => {
        const baseline = "前言。\n\n| 名称 | 数量 |\n| :----: | -----: |\n| 苹果 | 1 |";
        const edited = "改过的前言。\n\n| 名称 | 数量 |\n| :----: | -----: |\n| 苹果 | 1 |";
        const output = mergeAfterEdit(baseline, edited);
        assert.equal(output, "改过的前言。\n\n| 名称 | 数量 |\n| :----: | -----: |\n| 苹果 | 1 |");
        assert.ok(output.includes("| :----: | -----: |"), "表格分隔行宽度必须原样保留");
    });
});

describe("结构变化的对齐", () => {
    test("中间插入块：前后原文保留，新块以空行分隔", () => {
        const output = mergeAfterEdit("# 标题\n\n结尾段落。", "# 标题\n\n新插入段落。\n\n结尾段落。");
        assert.equal(output, "# 标题\n\n新插入段落。\n\n结尾段落。");
    });

    test("删除中间块：连同其前导空行一并丢弃", () => {
        const output = mergeAfterEdit("# 标题\n\n中间段落。\n\n结尾段落。", "# 标题\n\n结尾段落。");
        assert.equal(output, "# 标题\n\n结尾段落。");
    });

    test("拆分段落：一个块变两个块", () => {
        const output = mergeAfterEdit("甲乙", "甲\n\n乙");
        assert.equal(output, "甲\n\n乙");
    });

    test("跨块选择替换：被覆盖的多个块收敛为一个新块", () => {
        const output = mergeAfterEdit("甲\n\n乙\n\n丙", "甲\n\n丁");
        assert.equal(output, "甲\n\n丁");
    });

    test("在开头插入块不产生多余前导空行", () => {
        const output = mergeAfterEdit("# 标题\n\n正文。", "新开头。\n\n# 标题\n\n正文。");
        assert.equal(output, "新开头。\n\n# 标题\n\n正文。");
    });
});

describe("末尾块与 TrailingParagraph 对账", () => {
    test("编辑以代码块结尾的文档：EOF 不被追加多余空白", () => {
        const baseline = "# 标题\n\n```js\nconst a = 1;\n```";
        const edited = "# 标题\n\n```js\nconst a = 2;\n```";
        const output = mergeAfterEdit(baseline, edited);
        assert.equal(output, "# 标题\n\n```js\nconst a = 2;\n```");
        assert.ok(!output.endsWith("\n\n"), "结尾空段落不应产出多余空行");
    });

    test("编辑以表格结尾的文档：保留标题原文", () => {
        const baseline = "前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |";
        const edited = "新前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |";
        const output = mergeAfterEdit(baseline, edited);
        assert.equal(output, "新前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    });

    test("以代码块结尾且原文含 EOF 换行时保留该换行", () => {
        const baseline = "# 标题\n\n```js\nconst a = 1;\n```\n";
        const edited = "# 新标题\n\n```js\nconst a = 1;\n```\n";
        const output = mergeAfterEdit(baseline, edited);
        assert.equal(output, "# 新标题\n\n```js\nconst a = 1;\n```\n");
    });
});

describe("幂等性", () => {
    test("合并输出再次载入后不做编辑，序列化逐字节还原", () => {
        const merged = mergeAfterEdit(
            "# 标题\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙",
            "# 新标题\n\n*星号* 和 _下划线_\n\n- 甲\n* 乙",
        );
        assert.equal(serializeUnchanged(merged), merged);
    });

    test("对合并输出再次编辑同块，结果与直接编辑一致", () => {
        const baselineMarkdown = "# 标题\n\n_下划线_";
        const firstMerged = mergeAfterEdit(baselineMarkdown, "# 中间态\n\n_下划线_");
        const secondMerged = mergeAfterEdit(firstMerged, "# 终态\n\n_下划线_");
        assert.equal(secondMerged, "# 终态\n\n_下划线_");
    });
});
