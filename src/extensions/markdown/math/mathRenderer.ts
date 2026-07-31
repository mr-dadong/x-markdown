import type { KatexOptions } from "katex";

let katexLoader: Promise<typeof import("katex")["default"]> | null = null;

// KaTeX 体积较大，仅在文档实际包含公式时加载，减少普通文档的启动开销。
export const renderMath = async (
  expression: string,
  options: KatexOptions,
): Promise<string> => {
  katexLoader ??= import("katex").then((module) => module.default);
  const katex = await katexLoader;
  return katex.renderToString(expression, options);
};
