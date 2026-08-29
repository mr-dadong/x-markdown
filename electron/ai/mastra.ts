import { Agent } from "@mastra/core/agent";
import { getAiSettings, currentProviderConfig, resolveApiKey, getAiStatus } from "./aiSettings";
import type { AiSettings, AiStatus } from "../../src/types/ai";

const WRITER_AGENT_ID = "xmd-writer";
const CHAT_AGENT_ID = "xmd-chat";

let writerAgent: Agent<string> | null = null;
let chatAgent: Agent<string> | null = null;
// 两个 Agent 各自维护独立的配置签名，避免一方刷新后覆盖另一方的缓存判断
let writerSignature = "";
let chatSignature = "";

function buildModelConfig(settings: AiSettings): unknown {
  const config = currentProviderConfig(settings);
  const id = `${settings.provider}/${config.model}`;
  const apiKey = config.apiKey ?? resolveApiKey(settings, settings.provider);

  // 为每个已知厂商提供默认 API 地址
  let url = config.baseUrl;
  if (!url) {
    switch (settings.provider) {
      case "openai": url = "https://api.openai.com/v1"; break;
      case "anthropic": url = "https://api.anthropic.com/v1"; break;
      case "deepseek": url = "https://api.deepseek.com/v1"; break;
      case "minimax": url = "https://api.minimax.io/v1"; break;
      case "ollama": url = "http://localhost:11434/v1"; break;
    }
  }

  // Ollama 需要确保末尾带 /v1
  if (settings.provider === "ollama" && url && !/\/v1\/?$/.test(url)) {
    url = url.replace(/\/+$/, "") + "/v1";
  }

  if (url) {
    return {
      id,
      url,
      ...(apiKey ? { apiKey } : {}),
    };
  }
  return {
    id,
    ...(apiKey ? { apiKey } : {}),
  };
}

export async function getWriterAgent(): Promise<Agent<string>> {
  const settings = await getAiSettings();
  const config = currentProviderConfig(settings);
  const signature = [
    settings.provider,
    config.model,
    config.baseUrl ?? "",
    (config.apiKey ?? resolveApiKey(settings, settings.provider))?.slice(-4) ?? "",
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
  const config = currentProviderConfig(settings);
  const signature = [
    settings.provider,
    config.model,
    config.baseUrl ?? "",
    (config.apiKey ?? resolveApiKey(settings, settings.provider))?.slice(-4) ?? "",
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