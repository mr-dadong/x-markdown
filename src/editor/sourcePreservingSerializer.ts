import type { Editor, MarkdownToken } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownManager } from "@tiptap/markdown";
import { lcsMatches } from "../utils/longestCommonSubsequence";

/**
 * 块级源码映射增量保存（方案 B）核心。
 *
 * 预览模式下每次编辑都全量 `getMarkdown()` 会把整篇 AST 重新序列化，Markdown 是
 * “多对一”的有损格式，未编辑的块也会被规范化改写。这里改为：以“最近一次从外部载入
 * 的原文”为基准（baseline），把原文按顶层块切成源码片段并记录每块的 PM 节点指纹；
 * emit 时用当前文档指纹与 baseline 对齐，未改动块直接吐出磁盘原文字节，只有真正
 * 改动/新增的块才单块重新序列化。
 */

/** baseline 中一个顶层块的原文切片。 */
export interface BaselineSegment {
    /** 本块核心内容之前、上一块核心内容之后的原文空白（首块为文件开头到块首）。 */
    gap: string;
    /** 本块的原文字节，已剔除块尾换行（换行归入下一块的 gap 或末块的 trailing）。 */
    source: string;
    /** 捕获时该块对应 PM 顶层节点的指纹。 */
    fingerprint: string;
}

/** 从外部载入的原文基准，用户输入期间保持不变，保存也不重建。 */
export interface Baseline {
    /** 原始 Markdown 全文。 */
    text: string;
    /** 顶层块原文切片，与捕获时 `doc` 前 N 个顶层子节点一一对应。 */
    segments: BaselineSegment[];
    /** 末块核心内容之后到 EOF 的原文空白（含结尾换行）。 */
    trailing: string;
}

/** 官方 @tiptap/markdown 挂在 storage 上的解析/序列化管理器。 */
const markdownManager = (editor: Editor): MarkdownManager =>
    editor.storage.markdown.manager;

/** marked 实例的最小可用形态：只需要能对源码做词法分析。 */
interface MarkedLexerHost {
    lexer: (src: string) => MarkdownToken[];
}

/** 顶层块的源码行区间，endLine 为下一行（与 markdown-it 的 token.map 语义一致）。 */
export interface BlockRange {
    startLine: number;
    endLine: number;
}

/**
 * 抽取顶层块的源码行区间。
 *
 * 必须用挂了全部自定义 tokenizer 的 marked 实例来分词，否则自定义语法会被
 * 拆成普通段落，区间数量与文档顶层节点对不上。例如 YAML 前置：
 * 纯 markdown-it 会把它拆成「分割线 + 段落 + 列表 + 分割线 + 段落」5 个块，
 * 而文档里只有一个 rawMarkdownBlock，对齐会整体错位。
 *
 * 行号由**字符偏移**换算，而不是累加每个 token 的换行数：
 * marked 的 raw 不保证以换行结尾（例如文档末尾的代码块、表格），
 * 累加换行数会让游标停在行中间，后续块的行号整体错位一行。
 */
export const topLevelBlockRanges = (editor: Editor, markdown: string): BlockRange[] => {
    const instance = markdownManager(editor).instance as unknown as MarkedLexerHost;
    const tokens = instance.lexer(markdown);

    // 每一行的起始字符偏移；lineStarts[行数] 落到 EOF。
    const lineStarts: number[] = [0];
    for (let index = 0; index < markdown.length; index += 1) {
        if (markdown.charCodeAt(index) === 10) lineStarts.push(index + 1);
    }
    const lineOf = (offset: number): number => {
        let low = 0;
        let high = lineStarts.length - 1;
        let found = 0;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (lineStarts[middle] <= offset) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return found;
    };

    const ranges: BlockRange[] = [];
    let offset = 0;
    for (const token of tokens) {
        const raw = String(token.raw ?? "");
        const startOffset = offset;
        offset += raw.length;
        // 空行不是块，但同样占用源码位置，必须跳过而不是忽略。
        if (token.type === "space" || raw.length === 0) continue;
        ranges.push({
            startLine: lineOf(startOffset),
            // endLine 取块末字符所在行的下一行，与 markdown-it 的 token.map 语义一致。
            endLine: lineOf(offset - 1) + 1,
        });
    }

    return ranges;
};

/**
 * 节点指纹缓存。ProseMirror 结构共享，未改动块的节点引用在事务间保持不变，
 * 因此以节点对象为键缓存 JSON 指纹，可把每次按键的指纹计算降到 O(改动) 摊销。
 */
const fingerprintCache = new WeakMap<ProseMirrorNode, string>();

const fingerprint = (node: ProseMirrorNode): string => {
    const cached = fingerprintCache.get(node);
    if (cached !== undefined) return cached;
    const value = JSON.stringify(node.toJSON());
    fingerprintCache.set(node, value);
    return value;
};

/**
 * 单独序列化一个顶层块：把它包进一个临时 doc 再交给 Markdown 序列化器，
 * 父上下文仍是 doc，与整篇序列化时该块的渲染完全一致，自动继承表格/公式/
 * mermaid/callout/footnote/raw 等自定义块逻辑与转义放宽包装。
 */
export const serializeSingleBlock = (
    editor: Editor,
    node: ProseMirrorNode,
): string =>
    // 官方序列化器接收 JSON 文档：把单块包进临时 doc，父上下文仍是 doc，
    // 与整篇序列化时该块的渲染完全一致，自动继承表格/公式/mermaid/callout/
    // footnote/raw 等自定义块逻辑与转义放宽包装。
    markdownManager(editor).serialize({
        type: "doc",
        content: [node.toJSON()],
    });

/**
 * 以 `text` 为原文、`editor.state.doc` 为对应文档，捕获一份 baseline。
 * 必须在文本与文档一致的时刻调用（onCreate 用初始内容、watch 的 setContent 之后），
 * 否则指纹与源码切片会错位。
 */
export const captureBaseline = (editor: Editor, text: string): Baseline => {
    const ranges = topLevelBlockRanges(editor, text);

    // 每行起始字符偏移；lineStarts[行数] 落到 EOF，供末块 endLine 越界时取用。
    const lineStarts: number[] = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
    }
    const lineStart = (line: number): number => lineStarts[line] ?? text.length;

    const doc = editor.state.doc;
    const segments: BaselineSegment[] = [];
    let previousCoreEnd = 0;
    for (let index = 0; index < ranges.length; index += 1) {
        const start = lineStart(ranges[index].startLine);
        const rawEnd = lineStart(ranges[index].endLine);
        // token.map 的 endLine 指向块末行的下一行，切片会带上块尾换行；
        // 把结尾换行剥出核心内容，交由下一块的 gap（或末块 trailing）承载，
        // 这样替换某块时不会因为源码尾部换行与 gap 叠加而错乱分隔。
        const core = text.slice(start, rawEnd).replace(/\n+$/, "");
        segments.push({
            gap: text.slice(previousCoreEnd, start),
            source: core,
            fingerprint: fingerprint(doc.child(index)),
        });
        previousCoreEnd = start + core.length;
    }

    return { text, segments, trailing: text.slice(previousCoreEnd) };
};

/**
 * 用当前文档与 baseline 对齐，产出忠实合并文本：
 * - 未改动块（指纹命中）：直接输出 baseline 原文字节；
 * - 改动块：baseline 侧独有 -> 跳过，当前侧独有 -> 单块重新序列化；
 * - 新增块：单块重新序列化；序列化结果为空的当前侧独有节点
 *   （TrailingParagraph / 点击块间空隙产生的临时空段落）不产出内容；
 * - 块间空白：相邻两个保留块用原文 gap 逐字节还原，其余边界统一空行；
 * - 末尾始终接回 baseline 的 EOF 空白。
 */
export const serializePreservingSource = (editor: Editor, baseline: Baseline): string => {
    const doc = editor.state.doc;
    const baseCount = baseline.segments.length;

    // 编辑器会在末尾维护空段落（TrailingParagraph / 点击块间空隙产生），它们不在原文里、
    // 序列化也为空。对齐前从尾部剥除，既避免它们产出多余空白，也防止破坏后缀裁剪
    // 把 LCS 拖成 O(n^2)。
    let currentCount = doc.childCount;
    while (currentCount > 0) {
        const last = doc.child(currentCount - 1);
        if (last.type.name !== "paragraph" || last.content.size !== 0) break;
        currentCount -= 1;
    }

    const baseFingerprints = baseline.segments.map((segment) => segment.fingerprint);
    const currentFingerprints: string[] = [];
    for (let index = 0; index < currentCount; index += 1) {
        currentFingerprints.push(fingerprint(doc.child(index)));
    }

    // 编辑通常是局部的：先按指纹相等裁掉公共前缀/后缀，仅对中间残差做 LCS。
    let prefix = 0;
    while (
        prefix < baseCount &&
        prefix < currentCount &&
        baseFingerprints[prefix] === currentFingerprints[prefix]
    ) {
        prefix += 1;
    }
    let suffix = 0;
    while (
        suffix < baseCount - prefix &&
        suffix < currentCount - prefix &&
        baseFingerprints[baseCount - 1 - suffix] === currentFingerprints[currentCount - 1 - suffix]
    ) {
        suffix += 1;
    }

    // 输出条目：baseIndex 非空表示逐字节保留的 baseline 块，null 表示序列化生成的块（插入/改动）。
    const entries: Array<{ text: string; baseIndex: number | null }> = [];
    const preserve = (baseIndex: number): void => {
        entries.push({ text: baseline.segments[baseIndex].source, baseIndex });
    };
    const insert = (currentIndex: number): void => {
        const text = serializeSingleBlock(editor, doc.child(currentIndex));
        if (text.trim() === "") return;
        entries.push({ text, baseIndex: null });
    };

    // 公共前缀：全部原样保留。
    for (let index = 0; index < prefix; index += 1) preserve(index);

    // 残差：LCS 匹配对保留 baseline 原文；当前侧独有 -> 插入；baseline 侧独有 -> 跳过。
    const baseResidual = baseFingerprints.slice(prefix, baseCount - suffix);
    const currentResidual = currentFingerprints.slice(prefix, currentCount - suffix);
    const matches = lcsMatches(baseResidual, currentResidual);
    let cursorCurrent = 0;
    for (const [matchBase, matchCurrent] of matches) {
        for (let index = cursorCurrent; index < matchCurrent; index += 1) insert(prefix + index);
        preserve(prefix + matchBase);
        cursorCurrent = matchCurrent + 1;
    }
    for (let index = cursorCurrent; index < currentResidual.length; index += 1) insert(prefix + index);

    // 公共后缀：全部原样保留。
    for (let index = baseCount - suffix; index < baseCount; index += 1) preserve(index);

    /*
     * 拼接：只有相邻两个条目都是保留块、且在 baseline 中下标连续时，才用原文 gap
     * 逐字节还原块间空白（可能是多个空行、也可能是相邻列表间的单个换行）；其余边界
     * 涉及插入/改动/删除，统一用空行分隔。首块前导空白与 EOF 空白单独处理。
     */
    let output = "";
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (index === 0) {
            output += entry.baseIndex === 0 ? baseline.segments[0].gap : "";
        } else {
            const previous = entries[index - 1];
            // previous.baseIndex 非空且 entry.baseIndex 恰好比它大 1 -> 两个保留块在原文中相邻。
            const gap =
                previous.baseIndex !== null && entry.baseIndex === previous.baseIndex + 1
                    ? baseline.segments[entry.baseIndex].gap
                    : "\n\n";
            output += gap;
        }
        output += entry.text;
    }
    return output + baseline.trailing;
};
