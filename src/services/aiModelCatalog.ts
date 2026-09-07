import type { AiModelInfo } from '../types/ai'
import { ref } from 'vue'

// 设置页刷新列表后，通知已打开的侧栏同步本地数据。
export const modelCatalogRevision = ref(0)

// 按厂商和接口地址保存模型名称，不保存密钥，重启后仍可复用。
const catalogKey = (provider: string, baseUrl: string): string =>
  `ai-model-catalog:${provider}:${encodeURIComponent(baseUrl.trim().replace(/\/+$/, ''))}`

export const saveModelCatalog = (provider: string, baseUrl: string, models: AiModelInfo[]): void => {
  localStorage.setItem(catalogKey(provider, baseUrl), JSON.stringify(models))
  modelCatalogRevision.value += 1
}

export const readModelCatalog = (provider: string, baseUrl: string): AiModelInfo[] => {
  const stored = localStorage.getItem(catalogKey(provider, baseUrl))
  // 未获取过时由界面引导前往设置；损坏的数据明确报错。
  if (stored === null) return []
  const models: unknown = JSON.parse(stored)
  if (!Array.isArray(models) || !models.every((model) =>
    model && typeof model.id === 'string' && (model.name === undefined || typeof model.name === 'string'))) {
    throw new Error('已保存的模型列表格式错误，请在设置中重新获取')
  }
  return models
}
