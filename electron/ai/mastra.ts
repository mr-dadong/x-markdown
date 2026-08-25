import { Agent } from "@mastra/core/agent";
import { getAiSettings, getAiStatus } from "./aiSettings";
import type { AiSettings, AiStatus } from "../../src/types/ai";

const WRITER_AGENT_ID = "xmd-writer";

let writerAgent: Agent<string> | null = null;
let currentSignature = "";

function buildModelConfig(settings: AiSettings): unknown {
  const id = `${settings.provider}/${settings.model}`;
  if (settings.baseUrl) {
    return {
      id,
      url: settings.baseUrl,
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
  if (writerAgent && writerAgent.name === "XMD Writer" && signature === currentSignature) {
    return writerAgent;
  }

  currentSignature = signature;
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

export async function getAiAgentStatus(): Promise<AiStatus> {
  await getWriterAgent();
  return getAiStatus();
}