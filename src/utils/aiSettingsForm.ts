import { aiProviderTemplate, type AiProvider } from "../types/ai";
import type { AiProviderPublicConfig } from "../types/ai";

/**
 * 为所有未配置 API 地址的厂商预填官方默认地址。
 * - 已配置过的地址一律不覆盖。
 * - 返回全新对象，不修改传入的 providers。
 */
export function prefillBaseUrls(
  providers: Record<string, AiProviderPublicConfig>,
  defaults: Record<string, string>,
): Record<string, AiProviderPublicConfig> {
  const result: Record<string, AiProviderPublicConfig> = {};
  for (const key of Object.keys(providers)) {
    const cfg = providers[key];
    // 用连接对应的模板查官方地址，自定义连接没有预设地址。
    const baseUrl = cfg.baseUrl || defaults[aiProviderTemplate(key as AiProvider)];
    result[key] = { ...cfg, baseUrl };
  }
  return result;
}

/**
 * 计算 API Key 输入框的显示值：
 * - 已输入草稿 → 显示草稿（password 型输入框渲染为圆点）。
 * - 编辑态（聚焦了掩码框）→ 显示空，方便直接输入新 Key。
 * - 已保存 Key 且非编辑态 → 显示掩码，提示该厂商配置过密钥。
 * - 未配置过 → 空输入框。
 */
export function getApiKeyDisplay(
  draft: string,
  editing: boolean,
  hasApiKey: boolean,
  mask: string,
): string {
  if (draft) return draft;
  if (editing) return "";
  return hasApiKey ? mask : "";
}
