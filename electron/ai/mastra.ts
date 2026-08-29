import { Agent } from "@mastra/core/agent";
import { getAiSettings, getAiStatus } from "./aiSettings";
import type { AiSettings, AiStatus } from "../../src/types/ai";

const WRITER_AGENT_ID = "xmd-writer";
const CHAT_AGENT_ID = "xmd-chat";

let writerAgent: Agent<string> | null = null;
let chatAgent: Agent<string> | null = null;
// 两个 Agent 各自维护独立的配置签名，避免一方刷新后覆盖另一方的缓存判断
let writerSignature = "";
let chatSignature = "";

function buildModelConfig(settings: AiSettings): unknown {
  const id = `${settings.provider}/${settings.model}`;

  // Ollama 需要 OpenAI 兼容地址（带 /v1）：留空时补默认值，
  // 用户填了不带 /v1 的根地址时自动补全
  let url = settings.baseUrl;
  if (settings.provider === "ollama") {
    if (!url) {
      url = "http://localhost:11434/v1";
    } else if (!/\/v1\/?$/.test(url)) {
      url = url.replace(/\/+$/, "") + "/v1";
    }
  }

  if (url) {
    return {
      id,
      url,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    };
  }
  return {
    id,
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
  };
}

export async function getWriterAgent(): Promise<Agent<string>> {
  const settings = await getAiSettings();
  const signature = [
    settings.provider,
    settings.model,
    settings.baseUrl ?? "",
    settings.apiKey?.slice(-4) ?? "",
  ].join("|");
  if (writerAgent && writerAgent.name === "XMD Writer" && signature === writerSignature) {
    return writerAgent;
  }

  writerSignature = signature;
  writerAgent = new Agent<string>({
    id: WRITER_AGENT_ID,
    name: "XMD Writer",
    instructions:
      "你是 XMD 的 Markdown 写作助手。根据用户的动作处理选中文本或文档上下文，只返回 Markdown 内容，避免不必要的解释。",
    model: buildModelConfig(settings) as ConstructorParameters<typeof Agent<string>>[0]["model"],
    maxRetries: 1,
  });

  return writerAgent;
}

export async function getChatAgent(): Promise<Agent<string>> {
  const settings = await getAiSettings();
  const signature = [
    settings.provider,
    settings.model,
    settings.baseUrl ?? "",
    settings.apiKey?.slice(-4) ?? "",
  ].join("|");
  if (chatAgent && chatAgent.name === "XMD Chat" && signature === chatSignature) {
    return chatAgent;
  }

  chatSignature = signature;
  chatAgent = new Agent<string>({
    id: CHAT_AGENT_ID,
    name: "XMD Chat",
    instructions:
      "你是 XMD 的 Markdown 写作助手。用户会与你进行多轮对话，讨论和处理 Markdown 文档内容。" +
      "请根据对话上下文和文档内容提供帮助，返回 Markdown 格式的结果。" +
      "保持回答简洁专业，避免不必要的解释。",
    model: buildModelConfig(settings) as ConstructorParameters<typeof Agent<string>>[0]["model"],
    maxRetries: 1,
  });

  return chatAgent;
}

export async function getAiAgentStatus(): Promise<AiStatus> {
  await getWriterAgent();
  return getAiStatus();
}