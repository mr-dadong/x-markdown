import type { AiProviderPublicConfig } from "../types/ai";

/**
 * 为所有未配置 API 地址的厂商预填官方默认地址。
 * - anthropic 走独立协议、界面上不显示地址输入框，跳过不填。
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
    // 空地址时才预填默认值；anthropic 和默认表里没有的厂商保持为空
    const baseUrl =
      cfg.baseUrl || (key !== "anthropic" ? defaults[key] : undefined);
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
