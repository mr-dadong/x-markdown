let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let initialized = false;

const loadMermaid = async (): Promise<typeof import("mermaid")["default"]> => {
  mermaidLoader ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidLoader;

  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
    });
    initialized = true;
  }

  return mermaid;
};

/** Mermaid 体积较大，只有文档实际包含图表时才加载渲染器。 */
export const renderMermaid = async (id: string, source: string): Promise<string> => {
  const mermaid = await loadMermaid();
  const result = await mermaid.render(id, source);
  return result.svg;
};
