import type { AiChatRequest, AiEditAction, AiInvokeRequest } from "../../src/types/ai";

const ACTION_INSTRUCTIONS: Record<AiEditAction, string> = {
  polish: "润色文字，保持原意和语气，让表达更清晰自然。",
  rewrite: "重写文字，改进结构和表达，但不要改变核心信息。",
  summarize: "总结这段内容，保留关键信息，用简洁的 Markdown 输出。",
  translate: "把这段内容翻译成目标语言；未指定时默认翻译为简体中文。",
  continue: "根据当前内容自然续写，保持风格和上下文一致。",
  "explain-code": "解释这段代码做了什么，包含关键实现思路和注意点。",
  "fix-code": "修复这段代码中的问题，输出修复后的代码，必要时简短说明改动。",
  outline: "基于当前内容生成 Markdown 标题大纲。",
  toc: "生成适用于当前文档的 Markdown 目录，替换原目录占位内容。",
  table: "把当前内容整理成 Markdown 表格，结构清晰，表头准确。",
  callout: "把当前内容整理成一个 Markdown Callout 提示块。",
  mermaid: "把当前内容转换为 Mermaid 图表源码，只输出代码块。",
  frontmatter: "为当前文档生成 YAML frontmatter，包含 title、summary、tags 字段。",
};

export const AI_ACTION_LABELS: Record<AiEditAction, string> = {
  polish: "润色",
  rewrite: "重写",
  summarize: "总结",
  translate: "翻译",
  continue: "续写",
  "explain-code": "解释代码",
  "fix-code": "修复代码",
  outline: "生成大纲",
  toc: "生成目录",
  table: "整理为表格",
  callout: "整理为提示块",
  mermaid: "生成 Mermaid",
  frontmatter: "生成 YAML",
};

export function buildAiPrompt(request: AiInvokeRequest): string {
  const action = ACTION_INSTRUCTIONS[request.action] ?? ACTION_INSTRUCTIONS.polish;
  const target = request.selection?.trim() || request.documentContext?.trim();

  if (!target) {
    throw new Error("没有可处理的文本，请先选中内容或打开文档");
  }

  const parts = [
    `请执行以下 Markdown 写作动作：${AI_ACTION_LABELS[request.action]}`,
    action,
  ];

  if (request.options?.language) {
    parts.push(`目标语言：${request.options.language}`);
  }
  if (request.options?.instruction) {
    parts.push(`额外要求：${request.options.instruction}`);
  }

  if (request.selection?.trim()) {
    parts.push(`选中内容：\n\`\`\`\n${request.selection.trim()}\n\`\`\``);
  }
  if (request.documentContext?.trim()) {
    parts.push(`文档上下文（只用于辅助理解）：\n\`\`\`\n${request.documentContext.trim()}\n\`\`\``);
  }

  parts.push("只输出可安全插入 Markdown 文档的结果，不要输出多余的前言或解释。");
  return parts.join("\n\n");
}

export function buildChatSystemPrompt(request: AiChatRequest): string {
  const parts = [
    "你是 XMD 的 Markdown 写作助手，正在与用户进行多轮对话。",
    "请根据对话上下文和文档内容提供帮助。",
    "返回 Markdown 格式的结果，保持简洁专业。",
  ];

  if (request.documentContext?.trim()) {
    parts.push(
      "以下是用户当前正在编辑的 Markdown 文档内容（仅供参考，不要直接修改）：",
      "```",
      request.documentContext.trim(),
      "```",
    );
  }

  if (request.selection?.trim()) {
    parts.push(
      "用户当前选中的文本：",
      "```",
      request.selection.trim(),
      "```",
    );
  }

  return parts.join("\n\n");
}