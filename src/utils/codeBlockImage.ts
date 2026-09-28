import { toPng } from "html-to-image";
import { decodeDataUrl } from "./dataUrl";

// html-to-image 内部的画布边长上限（见其 util.js 的 canvasDimensionLimit）：
// 画布超过它时库会把整张图等比缩小一次，文字因此变糊。
// 这里自己规划尺寸与像素比，保证永远不触发那次缩放。
const CANVAS_DIMENSION_LIMIT = 16384;
// 单个分片的高度上限（CSS 像素）：按 2× 渲染时一张图不超过 12000 像素高，
// 既远离上面那条上限，也把单张图的内存占用控制在约 150MB 像素数据以内。
const MAX_SLICE_HEIGHT = 6000;
// 桌面端首选像素比：高分屏下 2× 才看得清代码。
const PREFERRED_PIXEL_RATIO = 2;

/*
 * 把编辑器里的代码块克隆到屏幕外容器，生成一张只含纯代码内容的分享卡片：
 * - 窗口式标题栏（data-xmd-code-header）与操作按钮属于编辑器组件装饰，
 *   克隆后整体移除，图片里只留代码正文；
 * - 代码块根节点保留原有 class，语法高亮配色随用户所选代码块外观原样生效；
 * - pre 去掉窗口边框、回为独立圆角，外层留出适度边距，像一张代码卡片；
 * - 不换行时容器按最长代码行收缩（max-content），长行完整进入图片，
 *   并把 code 元素改成不收缩，避免 flex 布局把代码行压窄；
 * - 自动换行时固定 800px 宽，长行在图片内折行。
 *
 * styleReference 用来读取字号、行高与字体族：分片克隆不在编辑器的
 * .tiptap / .typography-pane 作用域内，必须从编辑器里的真实代码块取计算样式，
 * 否则会回落到 preflight 默认值。传被克隆节点自身时即「就地取材」。
 */
export const mountCodeBlockSnapshot = (
    codeBlockRoot: HTMLElement,
    wrap: boolean,
    styleReference: HTMLElement = codeBlockRoot,
): HTMLElement => {
    const host = document.createElement("div");
    // 屏幕外挂载且宽度只由代码内容决定；四周留白让图片像一张独立的代码卡片。
    host.style.cssText =
        `position:fixed;left:-99999px;top:0;box-sizing:border-box;padding:16px;` +
        `width:${wrap ? "800px" : "max-content"};`;
    const clone = codeBlockRoot.cloneNode(true) as HTMLElement;
    // 代码块根节点在编辑器里带有段间距，截图以代码卡片为界。
    clone.style.margin = "0";
    // 窗口式标题栏（含红绿灯、语言选择器与操作按钮）不进入分享图。
    clone.querySelectorAll("[data-xmd-code-header]").forEach((header) => header.remove());
    const sourcePre = styleReference.querySelector("pre");
    const pre = clone.querySelector("pre");
    if (pre) {
        const preStyle = (pre as HTMLElement).style;
        // 编辑器里长行靠横向滚动查看，图片是静态画面，克隆后完整展开。
        preStyle.overflow = "visible";
        // preClass 里的边框与上下不对称圆角都是窗口组件样式；
        // class 本身带 !important，需同样用 important 内联才能覆盖。
        preStyle.setProperty("border", "none", "important");
        preStyle.setProperty("border-radius", "10px", "important");
        // 把源 pre 的计算样式复制过来，保证图片排版与编辑器视觉一致。
        if (sourcePre) {
            const sourceStyle = getComputedStyle(sourcePre);
            preStyle.fontSize = sourceStyle.fontSize;
            preStyle.fontFamily = sourceStyle.fontFamily;
            preStyle.lineHeight = sourceStyle.lineHeight;
            // 代码正文的等宽字体来自 .tiptap code 规则，同样只作用于编辑器作用域；
            // 一并复制到克隆 code，否则字体族会退回 preflight 的默认等宽栈。
            const sourceCode = sourcePre.querySelector("code");
            const snapshotCode = pre.querySelector("code");
            if (sourceCode && snapshotCode) {
                (snapshotCode as HTMLElement).style.fontFamily =
                    getComputedStyle(sourceCode).fontFamily;
            }
        }
    }
    if (!wrap) {
        const code = pre?.querySelector("code");
        if (code) {
            // code 默认 flex-1 可收缩，flex 布局会把代码行压到容器宽度内；
            // 改为按内容取宽，配合容器的 max-content 得到最长行的完整宽度。
            (code as HTMLElement).style.flex = "none";
        }
    }
    host.appendChild(clone);
    document.body.appendChild(host);
    return host;
};

// 等一帧，让浏览器完成屏幕外克隆节点的布局，避免截到未排版的画面。
const waitForLayout = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

/*
 * 代码正文在 DOM 里被语法高亮拆成大量内联节点，换行符散落在文本节点中。
 * 这里按换行符把内容拆成「每个逻辑行一份片段」：片段套回原标签（保留高亮 class），
 * 跨行的元素（例如跨行块注释）会按行拆开再各自套回同名标签，配色因此不变。
 */
const splitInlineByLine = (element: Element): DocumentFragment[] => {
    const lines: DocumentFragment[] = [document.createDocumentFragment()];
    const startNewLine = (): void => {
        lines.push(document.createDocumentFragment());
    };
    for (const child of Array.from(element.childNodes)) {
        // 文本节点：换行符落在哪，就在哪切到下一行。
        if (child.nodeType === Node.TEXT_NODE) {
            (child.nodeValue ?? "").split("\n").forEach((part, index) => {
                if (index > 0) startNewLine();
                if (part) lines[lines.length - 1].appendChild(document.createTextNode(part));
            });
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        // 元素节点：递归拆行后，逐行套回同标签同属性的空壳。
        // nodeType 已确认是元素节点，这里断言成 Element 以便递归拆行。
        splitInlineByLine(child as Element).forEach((fragment, index) => {
            if (index > 0) startNewLine();
            // 该行没有内容时不再产出空标签，避免生成无意义的空 span。
            if (!fragment.childNodes.length) return;
            const wrapper = child.cloneNode(false);
            wrapper.appendChild(fragment);
            lines[lines.length - 1].appendChild(wrapper);
        });
    }
    return lines;
};

/*
 * 把代码块根节点按逻辑行切成若干份，每份都是结构完整的代码块：
 * 根节点与 pre 的 class 原样保留，配色、圆角与内边距随原样式生效；
 * 行号列与代码行按同一区间切开，切出来的编号仍然对应原本的行号。
 */
export const buildCodeBlockSliceRoots = (
    codeBlockRoot: HTMLElement,
    linesPerSlice: number,
): HTMLElement[] => {
    const sourcePre = codeBlockRoot.querySelector("pre");
    const sourceCode = sourcePre?.querySelector("code");
    // DOM 结构不是编辑器代码块时无从拆行，整块作为唯一分片。
    if (!sourcePre || !sourceCode) return [codeBlockRoot.cloneNode(true) as HTMLElement];

    const lineFragments = splitInlineByLine(sourceCode);
    // 行号列是 pre 里 code 之外的那个容器；自动换行时行号不渲染，这里拿到空值。
    const numberColumn =
        Array.from(sourcePre.children).find((child) => child !== sourceCode) ?? null;
    const numberSpans = numberColumn ? Array.from(numberColumn.children) : [];

    const sliceRoots: HTMLElement[] = [];
    for (let start = 0; start < lineFragments.length; start += linesPerSlice) {
        const end = Math.min(start + linesPerSlice, lineFragments.length);
        const slicePre = sourcePre.cloneNode(false) as HTMLElement;
        if (numberColumn) {
            const sliceColumn = numberColumn.cloneNode(false) as HTMLElement;
            numberSpans.slice(start, end).forEach((span) => sliceColumn.appendChild(span.cloneNode(true)));
            slicePre.appendChild(sliceColumn);
        }
        const sliceCode = sourceCode.cloneNode(false) as HTMLElement;
        lineFragments.slice(start, end).forEach((fragment, index) => {
            // 行与行之间补回拆掉的换行符，空行因此仍然是空行。
            if (index > 0) sliceCode.appendChild(document.createTextNode("\n"));
            sliceCode.appendChild(fragment);
        });
        slicePre.appendChild(sliceCode);
        const sliceRoot = codeBlockRoot.cloneNode(false) as HTMLElement;
        sliceRoot.appendChild(slicePre);
        sliceRoots.push(sliceRoot);
    }
    return sliceRoots;
};

/*
 * 规划每个分片包含多少逻辑行：
 * 按整块的平均行高估算，最坏情况下也至少保留一行；
 * 没有布局信息（行高为 0）时无法估算，整块作为一张图。
 */
export const resolveLinesPerSlice = (averageLineHeight: number, lineCount: number): number =>
    averageLineHeight > 0
        ? Math.max(1, Math.floor(MAX_SLICE_HEIGHT / averageLineHeight))
        : lineCount;

/*
 * 计算渲染像素比：优先 2×，同时保证画布两条边都不超过库的上限，
 * 这样 html-to-image 不会再自作主张把整张图缩小。
 * 极宽的代码行（超过 8192 CSS 像素）只能靠降低像素比容纳，此时仍不低于 1×。
 */
const resolvePixelRatio = (width: number, height: number): number => {
    const limitRatio = Math.min(
        CANVAS_DIMENSION_LIMIT / width,
        CANVAS_DIMENSION_LIMIT / height,
    );
    // 向下取到两位小数，避免浮点误差把画布顶过上限。
    return Math.floor(Math.min(PREFERRED_PIXEL_RATIO, limitRatio) * 100) / 100;
};

export interface CodeBlockImageProgress {
    // 已完成的图片张数。
    completed: number;
    // 本次导出总共会生成几张图片。
    total: number;
}

/*
 * 把代码块导出为若干张 PNG，返回每张图片的二进制：
 * - 代码块不高时只有一张，等价于「整块导出成一张图」；
 * - 超过 MAX_SLICE_HEIGHT 时按逻辑行切分，每片单独渲染成一张图片；
 *   每片画布都不大，库的等比缩小不会触发，文字始终清晰。
 */
export const codeBlockToPngSlices = async (
    codeBlockRoot: HTMLElement,
    wrap: boolean,
    reportProgress: (progress: CodeBlockImageProgress) => void,
): Promise<Uint8Array[]> => {
    // 先整块挂载一次，量出整块宽度与平均行高，据此规划分片。
    const fullHost = mountCodeBlockSnapshot(codeBlockRoot, wrap);
    let fullWidth: number;
    let linesPerSlice: number;
    try {
        await waitForLayout();
        const mountedCode = fullHost.querySelector("pre code");
        const codeHeight = mountedCode?.getBoundingClientRect().height ?? 0;
        const lineCount = (mountedCode?.textContent ?? "").split("\n").length;
        // 平均每个逻辑行的高度：自动换行时同一逻辑行会占多个视觉行，
        // 用平均值规划可以少切几片，个别偏高的分片再由像素比单独容纳。
        const averageLineHeight = codeHeight / lineCount;
        fullWidth = fullHost.clientWidth;
        linesPerSlice = resolveLinesPerSlice(averageLineHeight, lineCount);
    } finally {
        // 量完立即移除，后续逐片挂载，避免同时留下多个屏幕外容器。
        fullHost.remove();
    }

    const sliceRoots = buildCodeBlockSliceRoots(codeBlockRoot, linesPerSlice);
    const slices: Uint8Array[] = [];
    for (const [index, sliceRoot] of sliceRoots.entries()) {
        // 样式参照编辑器里的真实代码块：分片克隆自己读不到编辑器作用域内的字体规则。
        const host = mountCodeBlockSnapshot(sliceRoot, wrap, codeBlockRoot);
        try {
            // 所有分片保持整块宽度，否则不含最长行的分片会收缩成更窄的卡片。
            host.style.width = `${fullWidth}px`;
            await waitForLayout();
            const dataUrl = await toPng(host, {
                pixelRatio: resolvePixelRatio(host.clientWidth, host.clientHeight),
                // 像素比已按画布上限算好，关掉库的自动缩放，避免它再整图缩小一次。
                skipAutoScale: true,
                // 代码块使用系统等宽字体，跳过字体文件抓取与内嵌，加快生成速度。
                skipFonts: true,
                // 圆角以外的透明区域填当前主题底色，避免图片出现透明底。
                backgroundColor: getComputedStyle(document.body).backgroundColor,
                style: {
                    // 屏幕外容器的 fixed 定位与负 left 会被原样内联进截图 SVG，
                    // 内容因此被定位到画布之外，导出只剩背景色的纯白图；
                    // 克隆时改回常规流式布局，让内容从画布左上角开始渲染。
                    position: "static",
                    left: "0px",
                    top: "0px",
                },
            });
            const decoded = decodeDataUrl(dataUrl);
            // toPng 栅格化失败时会返回 "data:,"，解码结果是空字节而非 null；
            // 一并拦下，避免落盘出打不开的 0 字节 PNG。
            if (!decoded || decoded.bytes.length === 0) throw new Error("PNG 数据解码失败");
            slices.push(decoded.bytes);
        } finally {
            // 无论成败都移除屏幕外容器，不留临时节点。
            host.remove();
        }
        reportProgress({ completed: index + 1, total: sliceRoots.length });
    }
    return slices;
};
