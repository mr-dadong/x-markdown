import { Window } from "happy-dom";

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
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
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
