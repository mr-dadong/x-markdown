let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let initialized = false;

const loadMermaid = async (): Promise<typeof import("mermaid")["default"]> => {
  mermaidLoader ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidLoader;

  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // 语法错误只交给编辑器自己的错误卡片展示，避免 Mermaid 额外生成整张错误 SVG。
      suppressErrorRendering: true,
      theme: "neutral",
    });
    initialized = true;
  }

  return mermaid;
};

/** Mermaid 体积较大，只有文档实际包含图表时才加载渲染器。 */
export const renderMermaid = async (id: string, source: string): Promise<string> => {
  const mermaid = await loadMermaid();
  try {
    const result = await mermaid.render(id, source);
    return result.svg;
  } finally {
    // Mermaid 11.16.0 在部分异常路径会跳过内部清理，按本次唯一 ID 兜底移除临时节点。
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(`i${id}`)?.remove();
  }
};
