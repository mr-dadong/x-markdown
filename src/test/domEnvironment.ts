import { Window } from "happy-dom";

/*
 * happy-dom 没有实现 CSS Custom Highlight API，而编辑器用它绘制代码块选中匹配高亮，
 * 缺了它连编辑器都创建不出来。这里补一个只做登记的替身：测试可以据此断言
 * "哪几段文字被登记为高亮"；真正的合成绘制由浏览器负责，测试环境无需还原。
 */
export const registeredHighlights = new Map<string, Range[]>();

class TestHighlight {
  readonly ranges: Range[];

  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

// TipTap、Vue 节点视图和导出器依赖浏览器 DOM。测试中创建独立窗口，
// 让测试走与桌面渲染进程相同的解析和渲染代码，而不是复制一套简化实现。
export const installDomEnvironment = (): Window => {
  const window = new Window({ url: "http://localhost/" });
  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLImageElement: window.HTMLImageElement,
    SVGElement: window.SVGElement,
    DOMParser: window.DOMParser,
    MutationObserver: window.MutationObserver,
    // useSettings 在模块加载时读取 localStorage，测试环境需要把它挂到全局。
    localStorage: window.localStorage,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    Highlight: TestHighlight,
    CSS: {
      highlights: {
        set: (name: string, highlight: TestHighlight): void => {
          registeredHighlights.set(name, highlight.ranges);
        },
        delete: (name: string): void => {
          registeredHighlights.delete(name);
        },
      },
    },
  };

  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return window;
};
