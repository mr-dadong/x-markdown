<template>
  <section class="flex flex-col gap-5">
    <SectionTitle title="AI 设置" description="配置本地或云端模型，AI 助手会通过 Mastra Agent 调用。" />

    <SettingGroup title="启用 AI" description="关闭后 AI 助手不会发出任何模型请求。">
      <ToggleSwitch v-model="enabled" />
    </SettingGroup>

    <SettingGroup title="模型提供方" description="每个厂商独立保存模型、API 地址和密钥。">
      <IconSelect v-model="provider" :options="providerOptions" placeholder="选择提供方" />
    </SettingGroup>

    <SettingGroup title="模型名称" description="从列表选择或输入自定义模型名称，点击刷新获取可用模型。">
      <ModelSelector ref="modelSelectorRef" v-model="currentModel" v-model:customModels="currentCustomModels"
        placeholder="输入或选择模型" @fetch="onFetchModels" />
    </SettingGroup>

    <SettingGroup v-if="provider !== 'anthropic'" title="API 地址"
      description="留空使用官方地址；Ollama 可留空或填 http://localhost:11434/v1。">
      <input v-model="currentBaseUrl" type="text" class="ai-control" :placeholder="baseUrlPlaceholder" />
    </SettingGroup>

    <SettingGroup v-if="provider !== 'ollama'" title="API Key" description="每个厂商独立保存，不共享。">
      <input v-model="apiKeyDraft" type="password" class="ai-control" :placeholder="apiKeyPlaceholder"
        autocomplete="off" />
    </SettingGroup>

    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3 border-b border-line py-4">
        <label class="w-20 shrink-0 text-[13px] font-medium text-ink">温度</label>
        <span class="flex-1 text-[12px] text-muted">0-2，越高越有创造性</span>
        <input v-model.number="temperature" type="number" min="0" max="2" step="0.1" class="ai-control !w-28" />
      </div>
      <div class="flex items-center gap-3 border-b border-line py-4">
        <label class="w-20 shrink-0 text-[13px] font-medium text-ink">最大输出</label>
        <span class="flex-1 text-[12px] text-muted">单次生成的最大 token 数</span>
        <input v-model.number="maxTokens" type="number" min="256" max="32768" step="256" class="ai-control !w-28" />
      </div>
      <div class="flex items-center gap-3 border-b border-line py-4">
        <label class="w-20 shrink-0 text-[13px] font-medium text-ink">超时时间</label>
        <span class="flex-1 text-[12px] text-muted">单位：秒</span>
        <input v-model.number="timeoutSeconds" type="number" min="5" max="300" step="5" class="ai-control !w-28" />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button type="button"
        class="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="saving" @click="save">
        <Icon icon="lucide:save" :size="16" />
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <span v-if="message" class="text-[12px]" :class="hasError ? 'text-danger' : 'text-secondary'">{{ message }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import SectionTitle from './SectionTitle.vue'
import SettingGroup from './SettingGroup.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import IconSelect from './IconSelect.vue'
import type { IconSelectOption } from './IconSelect.vue'
import ModelSelector from './ModelSelector.vue'
import { aiService } from '../../services/aiService'
import type { AiProvider, AiProviderPublicConfig } from '../../types/ai'
import anthropicSvg from '../../assets/icon/anthropic.svg?raw'
import openaiSvg from '../../assets/icon/openai.svg?raw'
import deepseekSvg from '../../assets/icon/deepseek.svg?raw'
import minimaxSvg from '../../assets/icon/minimax.svg?raw'
import ollamaSvg from '../../assets/icon/ollama.svg?raw'

const providerOptions: IconSelectOption[] = [
  { value: 'openai', label: 'OpenAI', svg: openaiSvg },
  { value: 'anthropic', label: 'Anthropic', svg: anthropicSvg },
  { value: 'deepseek', label: 'DeepSeek', svg: deepseekSvg },
  { value: 'minimax', label: 'MiniMax', svg: minimaxSvg },
  { value: 'ollama', label: 'Ollama', svg: ollamaSvg },
  { value: 'custom', label: '自定义', icon: 'lucide:sliders-horizontal' },
]

const ALL_PROVIDERS: AiProvider[] = ['openai', 'anthropic', 'deepseek', 'minimax', 'ollama', 'custom']

const enabled = ref(false)
const provider = ref<AiProvider>('openai')
const temperature = ref(0.7)
const maxTokens = ref(2048)
const timeoutSeconds = ref(30)
const saving = ref(false)
const message = ref('')
const hasError = ref(false)

/** 每个厂商的公开配置（来自服务端，不含 apiKey） */
const providersConfig = ref<Record<string, AiProviderPublicConfig>>({})

/** 当前正在输入的 API Key（不回显，不保存到 providersConfig） */
const apiKeyDraft = ref('')

// 模型选择器引用
const modelSelectorRef = ref<InstanceType<typeof ModelSelector> | null>(null)

// ── 当前厂商的快捷访问 ──
const currentConfig = computed(() => providersConfig.value[provider.value] ?? { model: '', hasApiKey: false, customModels: [] })

const currentModel = computed({
  get: () => currentConfig.value.model ?? '',
  set: (val: string) => {
    providersConfig.value = { ...providersConfig.value, [provider.value]: { ...currentConfig.value, model: val } }
  },
})

const currentBaseUrl = computed({
  get: () => currentConfig.value.baseUrl ?? '',
  set: (val: string) => {
    providersConfig.value = { ...providersConfig.value, [provider.value]: { ...currentConfig.value, baseUrl: val || undefined } }
  },
})

const currentCustomModels = computed({
  get: () => currentConfig.value.customModels ?? [],
  set: (val: string[]) => {
    providersConfig.value = { ...providersConfig.value, [provider.value]: { ...currentConfig.value, customModels: val } }
  },
})

const apiKeyPlaceholder = computed(() => {
  if (currentConfig.value.hasApiKey) return '已配置，留空保持不变'
  return 'sk-...'
})

// 切换厂商时清空 API Key 草稿和模型列表
watch(provider, () => {
  apiKeyDraft.value = ''
  modelSelectorRef.value?.setModels([])
})

// ── 获取模型列表 ──
const onFetchModels = async () => {
  if (!modelSelectorRef.value) return
  modelSelectorRef.value.startLoading()
  try {
    // 先保存当前设置，确保使用最新的 baseUrl 和 apiKey
    const providersPayload: Record<string, { model: string; baseUrl?: string; apiKey?: string; customModels?: string[] }> = {}
    for (const key of ALL_PROVIDERS) {
      const cfg = providersConfig.value[key]
      if (!cfg) continue
      providersPayload[key] = {
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        customModels: cfg.customModels,
        apiKey: key === provider.value && apiKeyDraft.value.trim() ? apiKeyDraft.value.trim() : undefined,
      }
    }
    await aiService.saveSettings({
      provider: provider.value,
      providers: providersPayload,
    })
    const result = await aiService.fetchModels()
    if (result.error) {
      modelSelectorRef.value.setError(result.error)
    } else {
      modelSelectorRef.value.setModels(result.models)
    }
  } catch (error) {
    modelSelectorRef.value.setError(error instanceof Error ? error.message : String(error))
  }
}

const timeoutMs = computed(() => Math.max(1, Math.round(timeoutSeconds.value * 1000)))

const allowLocalRequests = computed(() => {
  if (provider.value === 'ollama') return true
  const url = (currentBaseUrl.value || '').trim().toLowerCase()
  if (!url) return false
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')
})

const baseUrlPlaceholder = computed(() => {
  switch (provider.value) {
    case 'openai': return 'https://api.openai.com/v1'
    case 'deepseek': return 'https://api.deepseek.com/v1'
    case 'minimax': return 'https://api.minimax.io/v1'
    case 'ollama': return 'http://localhost:11434/v1'
    case 'custom': return 'https://api.example.com/v1'
    default: return 'https://api.openai.com/v1'
  }
})

const load = async (): Promise<void> => {
  try {
    const settings = await aiService.getSettings()
    enabled.value = settings.enabled
    provider.value = settings.provider
    // 加载每个厂商的独立配置（不含 apiKey）
    providersConfig.value = { ...settings.providers }
    temperature.value = settings.temperature
    maxTokens.value = settings.maxTokens
    timeoutSeconds.value = Math.round(settings.timeoutMs / 1000)
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  }
}

const save = async (): Promise<void> => {
  saving.value = true
  hasError.value = false
  message.value = ''
  try {
    // 构建 providers 负载，将当前厂商的 apiKey 草稿带进去
    const providersPayload: Record<string, { model: string; baseUrl?: string; apiKey?: string; customModels?: string[] }> = {}
    for (const key of ALL_PROVIDERS) {
      const cfg = providersConfig.value[key]
      if (!cfg) continue
      providersPayload[key] = {
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        customModels: cfg.customModels,
        apiKey: key === provider.value && apiKeyDraft.value.trim() ? apiKeyDraft.value.trim() : undefined,
      }
    }
    const settings = await aiService.saveSettings({
      enabled: enabled.value,
      provider: provider.value,
      providers: providersPayload,
      temperature: temperature.value,
      maxTokens: maxTokens.value,
      timeoutMs: timeoutMs.value,
      allowLocalRequests: allowLocalRequests.value,
    })
    // 保存后重新加载 providers 状态（服务端可能加密了 apiKey）
    providersConfig.value = { ...settings.providers }
    apiKeyDraft.value = ''
    message.value = 'AI 设置已保存'
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<style scoped>
.ai-control {
  width: 200px;
  max-width: 420px;
  height: 36px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background-color: var(--color-panel);
  padding: 0 10px;
  color: var(--color-ink);
  font-size: 13px;
  outline: none;
}

.ai-control:focus {
  border-color: var(--color-accent);
}
</style>