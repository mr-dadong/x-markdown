<template>
  <section class="flex flex-col gap-5">
    <SectionTitle title="AI 设置" description="配置本地或云端模型，AI 助手会通过 Mastra Agent 调用。" />

    <SettingGroup title="启用 AI" description="关闭后 AI 助手不会发出任何模型请求。">
      <ToggleSwitch v-model="enabled" />
    </SettingGroup>

    <SettingGroup title="模型提供方" description="OpenAI/Anthropic 使用官方 API，Ollama 适合本地模型。">
      <IconSelect v-model="provider" :options="providerOptions" placeholder="选择提供方" />
    </SettingGroup>

    <SettingGroup title="模型名称" description="从列表选择或输入自定义模型名称，点击刷新获取可用模型。">
      <ModelSelector ref="modelSelectorRef" v-model="model" v-model:customModels="customModels"
        placeholder="gpt-4o-mini" @fetch="onFetchModels" />
    </SettingGroup>

    <SettingGroup v-if="provider !== 'anthropic'" title="API 地址"
      description="留空使用官方地址；Ollama 通常填 http://localhost:11434/v1。">
      <input v-model="baseUrl" type="text" class="ai-control" placeholder="https://api.openai.com/v1" />
    </SettingGroup>

    <SettingGroup v-if="provider !== 'ollama'" title="API Key" description="只保存在主进程安全存储中，设置页不会回显明文。">
      <input v-model="apiKey" type="password" class="ai-control" :placeholder="hasApiKey ? '已配置，留空保持不变' : 'sk-...'"
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
import ModelSelector from './ModelSelector.vue'
import { aiService } from '../../services/aiService'
import type { AiProvider } from '../../types/ai'

const providerOptions = [
  { value: 'openai', label: 'OpenAI', icon: 'lucide:sparkles' },
  { value: 'anthropic', label: 'Anthropic', icon: 'lucide:brain' },
  { value: 'ollama', label: 'Ollama', icon: 'lucide:server' },
  { value: 'custom', label: 'OpenAI Compatible', icon: 'lucide:sliders-horizontal' },
]

const enabled = ref(false)
const provider = ref<AiProvider>('openai')
const model = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const temperature = ref(0.7)
const maxTokens = ref(2048)
const timeoutSeconds = ref(30)
const hasApiKey = ref(false)
const saving = ref(false)
const message = ref('')
const hasError = ref(false)
const customModels = ref<string[]>([])

// 模型选择器引用
const modelSelectorRef = ref<InstanceType<typeof ModelSelector> | null>(null)

const onFetchModels = async () => {
  if (!modelSelectorRef.value) return
  modelSelectorRef.value.startLoading()

  try {
    // 先保存当前设置，确保使用最新的 baseUrl 和 apiKey
    await aiService.saveSettings({
      provider: provider.value,
      baseUrl: baseUrl.value.trim() || null,
      apiKey: apiKey.value || undefined,
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

// 切换提供方时清空模型列表
watch(provider, () => {
  modelSelectorRef.value?.setModels([])
})

const timeoutMs = computed(() => Math.max(1, Math.round(timeoutSeconds.value * 1000)))

const allowLocalRequests = computed(() => {
  if (provider.value === 'ollama') return true
  const url = baseUrl.value.trim().toLowerCase()
  if (!url) return false
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')
})

const load = async (): Promise<void> => {
  try {
    const settings = await aiService.getSettings()
    enabled.value = settings.enabled
    provider.value = settings.provider
    model.value = settings.model
    baseUrl.value = settings.baseUrl ?? ''
    hasApiKey.value = settings.hasApiKey
    temperature.value = settings.temperature
    maxTokens.value = settings.maxTokens
    timeoutSeconds.value = Math.round(settings.timeoutMs / 1000)
    customModels.value = settings.customModels ?? []
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
    const settings = await aiService.saveSettings({
      enabled: enabled.value,
      provider: provider.value,
      model: model.value.trim(),
      baseUrl: baseUrl.value.trim() || null,
      apiKey: apiKey.value || undefined,
      temperature: temperature.value,
      maxTokens: maxTokens.value,
      timeoutMs: timeoutMs.value,
      allowLocalRequests: allowLocalRequests.value,
      customModels: customModels.value,
    })
    hasApiKey.value = settings.hasApiKey
    apiKey.value = ''
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
