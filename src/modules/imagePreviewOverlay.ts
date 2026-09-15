import { mediaService } from "../services/mediaService";

// 图片放大预览层：思维导图、架构图这类超宽高分辨率图片在编辑器里
// 按正文列宽等比缩小后文字看不清，这里用全屏蒙层显示：
// 打开时大图先适应窗口看全貌、小图按 1:1 原尺寸，
// 配合滚轮缩放与双向滚动查看细节（ Esc 或「关闭」按钮退出）。
//
// 蒙层用纯 DOM 实现：图片节点视图本身就是纯 DOM（见 editorExtensions.ts），
// 保持同一套写法；蒙层临时挂在 body 上，全局同一时间只保留一个实例。

export interface ImagePreviewOptions {
    // Markdown 中写的图片地址（相对路径或 file URL），
    // 既用于解析显示图，也用于「系统应用打开」
    src: string;
    // 图片描述文字，缺失时标题栏回退显示文件名
    alt: string | null;
    currentDocumentPath: string | null;
}

// 缩放比例上下限：再小/再大都没有实际查看意义
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
// 滚轮每档的缩放倍率
const WHEEL_ZOOM_STEP = 1.1;
// 按钮每次点击的缩放倍率
const BUTTON_ZOOM_STEP = 1.25;

// 当前预览层的关闭入口；没有预览层时为 null
let closeCurrentPreview: (() => void) | null = null;

const clampZoom = (zoom: number): number =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

// 标题优先用 alt 文字；没有 alt 时从地址里取文件名，便于认出是哪张图
const getTitle = (options: ImagePreviewOptions): string => {
    if (options.alt) return options.alt;
    const plain = options.src.split(/[?#]/u)[0];
    const fileName = plain.split("/").pop() ?? "";
    try {
        // 地址中的中文可能是百分号编码，还原后显示
        return decodeURIComponent(fileName) || options.src;
    } catch {
        // 非法百分号编码无法还原，直接显示原始文件名
        return fileName || options.src;
    }
};

// 蒙层走深色底，按钮沿用 HTML 源码编辑器那套深色控件配色
const BUTTON_CLASS =
    "flex h-7 shrink-0 items-center justify-center rounded-md border border-[#3d3f45] bg-[#292a2e] px-2 text-[12px] text-[#e4e6eb] hover:bg-[#3a3b40]";

const createButton = (
    label: string,
    title: string,
    onClick: () => void,
): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.textContent = label;
    button.className = BUTTON_CLASS;
    button.addEventListener("click", onClick);
    return button;
};

export const openImagePreview = (options: ImagePreviewOptions): void => {
    // 同一时间只保留一个预览层：打开新图前先关掉旧蒙层
    closeCurrentPreview?.();

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[170] flex flex-col bg-black/75 outline-none";
    overlay.tabIndex = -1;

    // ===== 顶栏：左侧图名与提示，右侧缩放与打开按钮 =====
    const header = document.createElement("div");
    header.className = "flex h-11 shrink-0 items-center justify-between gap-3 px-4";

    const headerLeft = document.createElement("div");
    headerLeft.className = "flex min-w-0 flex-1 items-center gap-3";
    const title = document.createElement("span");
    title.className = "truncate text-[13px] font-semibold text-[#e4e6eb]";
    title.textContent = getTitle(options);
    const hint = document.createElement("span");
    hint.className = "shrink-0 text-[12px] text-[#969aa3]";
    hint.textContent = "滚轮缩放 · 滚动条平移 · Esc 关闭";
    headerLeft.append(title, hint);

    const headerRight = document.createElement("div");
    headerRight.className = "flex shrink-0 items-center gap-1.5";

    // 缩放比例只读展示，固定宽度避免数字变化时顶栏抖动
    const zoomLabel = document.createElement("span");
    zoomLabel.className = "w-12 shrink-0 text-center text-[12px] text-[#969aa3]";

    // ===== 滚动区：图片按当前缩放比例的真实尺寸摆放 =====
    const scroller = document.createElement("div");
    scroller.className = "flex min-h-0 flex-1 overflow-auto";
    const image = document.createElement("img");
    // m-auto：图片小于视口时整体居中，大于视口时不影响双向滚动
    image.className = "m-auto max-w-none";
    image.draggable = false;
    image.alt = options.alt ?? "";
    scroller.append(image);

    let zoom = 1;
    let naturalWidth = 0;

    const applyZoom = (next: number): void => {
        zoom = clampZoom(next);
        // 宽度按原图宽度乘比例写死，高度交给浏览器按原图比例计算
        if (naturalWidth > 0) {
            image.style.width = `${Math.round(naturalWidth * zoom)}px`;
        }
        zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    };

    // 适应窗口比例：把原图等比缩到刚好放进滚动区（宽和高都不超出）
    const getFitWindowZoom = (): number => {
        if (naturalWidth === 0 || image.naturalHeight === 0) return 1;
        return Math.min(
            scroller.clientWidth / naturalWidth,
            scroller.clientHeight / image.naturalHeight,
        );
    };

    const zoomOutButton = createButton("−", "缩小", () => {
        applyZoom(zoom / BUTTON_ZOOM_STEP);
    });
    const zoomInButton = createButton("＋", "放大", () => {
        applyZoom(zoom * BUTTON_ZOOM_STEP);
    });
    const fitWidthButton = createButton("适应宽度", "把图片缩放到与窗口同宽", () => {
        if (naturalWidth > 0) applyZoom(scroller.clientWidth / naturalWidth);
    });
    const fitWindowButton = createButton("适应窗口", "把整张图缩放到刚好放进窗口", () => {
        applyZoom(getFitWindowZoom());
    });
    const actualSizeButton = createButton("1:1", "按原图真实尺寸显示", () => {
        applyZoom(1);
    });
    const openExternalButton = createButton("系统应用打开", "用系统默认看图器打开原图", () => {
        void mediaService
            .openFile(options.src, options.currentDocumentPath)
            .then((error) => {
                // 打开失败要把原因显示出来，不能静默吞掉
                if (error) hint.textContent = `系统应用打开失败：${error}`;
            });
    });
    const closeButton = createButton("关闭", "关闭放大预览", () => {
        close();
    });
    const separator = document.createElement("span");
    separator.className = "mx-1 h-4 w-px shrink-0 bg-[#3d3f45]";
    headerRight.append(
        zoomOutButton,
        zoomLabel,
        zoomInButton,
        fitWidthButton,
        fitWindowButton,
        actualSizeButton,
        separator,
        openExternalButton,
        closeButton,
    );

    header.append(headerLeft, headerRight);
    overlay.append(header, scroller);

    // 滚轮以光标所在位置为锚点缩放：先算出光标对应的内容坐标，
    // 缩放后再反推滚动偏移，视觉上图形象着「钉」在光标下
    scroller.addEventListener(
        "wheel",
        (event) => {
            event.preventDefault();
            if (naturalWidth === 0) return;
            const next = clampZoom(
                event.deltaY < 0 ? zoom * WHEEL_ZOOM_STEP : zoom / WHEEL_ZOOM_STEP,
            );
            if (next === zoom) return;
            const rect = scroller.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            const contentX = offsetX + scroller.scrollLeft;
            const contentY = offsetY + scroller.scrollTop;
            const ratio = next / zoom;
            applyZoom(next);
            scroller.scrollLeft = contentX * ratio - offsetX;
            scroller.scrollTop = contentY * ratio - offsetY;
        },
        { passive: false },
    );

    const handleKeydown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
    };

    function close(): void {
        window.removeEventListener("keydown", handleKeydown);
        overlay.remove();
        if (closeCurrentPreview === close) closeCurrentPreview = null;
    }

    document.body.append(overlay);
    // 焦点落到蒙层上，键盘操作（Esc）立刻可用
    overlay.focus();
    window.addEventListener("keydown", handleKeydown);
    closeCurrentPreview = close;

    // 图片加载完成前先按 1:1 占位显示比例；加载完成后由 load 回调按原图尺寸定初始比例
    applyZoom(1);
    // 挂载后再读图：readImage 负责把 Markdown 相对路径解析成渲染进程可用的显示地址
    void mediaService
        .readImage(options.src, options.currentDocumentPath)
        .then((displayUrl) => {
            if (!displayUrl) {
                hint.textContent = "图片加载失败：读取不到文件内容";
                return;
            }
            image.src = displayUrl;
        })
        .catch((error: unknown) => {
            hint.textContent = `图片加载失败：${String(error)}`;
        });

    image.addEventListener("load", () => {
        naturalWidth = image.naturalWidth;
        // 初始比例：比窗口大的图先适应窗口看全貌（避免一打开只有局部、
        // 必须先拖滚动条才能看全），比窗口小的图保持 1:1 不放大防糊；
        // 需要看细节时再用滚轮或「1:1」按钮放大
        applyZoom(Math.min(1, getFitWindowZoom()));
    });
};
