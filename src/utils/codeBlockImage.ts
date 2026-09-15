import { toPng } from "html-to-image";
import { decodeDataUrl } from "./dataUrl";

/*
 * 把编辑器里的代码块克隆到屏幕外容器，生成一张只含纯代码内容的分享卡片：
 * - 窗口式标题栏（data-xmd-code-header）与操作按钮属于编辑器组件装饰，
 *   克隆后整体移除，图片里只留代码正文；
 * - 代码块根节点保留原有 class，语法高亮配色随用户所选代码块外观原样生效；
 * - pre 去掉窗口边框、回为独立圆角，外层留出适度边距，像一张代码卡片；
 * - 不换行时容器按最长代码行收缩（max-content），长行完整进入图片，
 *   并把 code 元素改成不收缩，避免 flex 布局把代码行压窄；
 * - 自动换行时固定 800px 宽，长行在图片内折行。
 */
export const mountCodeBlockSnapshot = (
    codeBlockRoot: HTMLElement,
    wrap: boolean,
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
    const pre = clone.querySelector("pre");
    if (pre) {
        const preStyle = (pre as HTMLElement).style;
        // 编辑器里长行靠横向滚动查看，图片是静态画面，克隆后完整展开。
        preStyle.overflow = "visible";
        // preClass 里的边框与上下不对称圆角都是窗口组件样式；
        // class 本身带 !important，需同样用 important 内联才能覆盖。
        preStyle.setProperty("border", "none", "important");
        preStyle.setProperty("border-radius", "10px", "important");
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

/*
 * 用 html-to-image 把代码块 DOM 生成为 PNG 二进制：
 * 截图基准是屏幕外克隆容器的实际尺寸，内容多大图片就多大，没有多余空白；
 * pixelRatio 2 让文字在高分屏上依然清晰。
 */
export const codeBlockToPngBytes = async (
    codeBlockRoot: HTMLElement,
    wrap: boolean,
): Promise<Uint8Array> => {
    const host = mountCodeBlockSnapshot(codeBlockRoot, wrap);
    try {
        // 等待一帧让浏览器完成克隆节点的布局，避免截到未排版的画面。
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const dataUrl = await toPng(host, {
            pixelRatio: 2,
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
        if (!decoded) throw new Error("PNG 数据解码失败");
        return decoded.bytes;
    } finally {
        // 无论成败都移除屏幕外容器，不留临时节点。
        host.remove();
    }
};
