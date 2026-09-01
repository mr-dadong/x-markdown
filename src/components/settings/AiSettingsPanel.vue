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

    <SettingGroup v-if="provider !== 'anthropic'" title="API 地址" description="官方默认地址已直接填入，可按需修改。">
      <input v-model="currentBaseUrl" type="text" class="ai-control" :placeholder="baseUrlPlaceholder" />
    </SettingGroup>

    <SettingGroup v-if="provider !== 'ollama'" title="API Key" description="已配置的厂商显示掩码；聚焦后输入新值即可替换，留空保持原 Key。">
      <input :value="apiKeyDisplay" type="password" class="ai-control" placeholder="sk-..." autocomplete="off"
        @focus="onApiKeyFocus" @input="onApiKeyInput" @blur="onApiKeyBlur" />
    </SettingGroup>

    <!-- 生成参数分组：三个数值参数收进一个圆角容器，与上方的连接配置在视觉上区分开 -->
    <div class="flex flex-col rounded-lg border border-line bg-panel">
      <div class="flex flex-col gap-1 px-5 pb-3 pt-4">
        <h4 class="text-[13px] font-semibold text-ink">生成参数</h4>
        <p class="text-[12px] text-muted">控制生成质量与稳定性，保存后对所有 AI 功能生效。</p>
      </div>
      <div class="flex items-center justify-between gap-8 border-b border-line px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">温度</span>
          <span class="text-[12px] text-muted">0-2，数值越高生成结果越有创造性。</span>
        </div>
        <input v-model.number="temperature" type="number" min="0" max="2" step="0.1" class="ai-control !bg-paper" />
      </div>
      <div class="flex items-center justify-between gap-8 border-b border-line px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">最大输出</span>
          <span class="text-[12px] text-muted">单次生成的最大 token 数，过小可能导致长内容被截断。</span>
        </div>
        <input v-model.number="maxTokens" type="number" min="256" max="32768" step="256" class="ai-control !bg-paper" />
      </div>
      <div class="flex items-center justify-between gap-8 px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">超时时间</span>
          <span class="text-[12px] text-muted">等待模型响应的最长时间，单位：秒。</span>
        </div>
        <input v-model.number="timeoutSeconds" type="number" min="5" max="300" step="5" class="ai-control !bg-paper" />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <!-- 保存按钮随时可点（保存是幂等的）：不依赖「有改动」才亮，
           避免测试成功自动保存后按钮变灰、用户想手动保存却点不了的困惑。 -->
      <button type="button"
        class="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="saving" @click="save">
        <Icon icon="lucide:save" :size="16" />
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <!-- 测试连接：把当前表单草稿（未保存也可）发给主进程临时配置做 1 token 真实请求。 -->
      <button type="button"
        class="flex h-9 items-center gap-2 rounded-md border border-line bg-paper px-4 text-[13px] font-medium text-secondary hover:border-accent hover:bg-selected hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="testing || saving" @click="runConnectionTest">
        <Icon :icon="testing ? 'lucide:loader-circle' : 'lucide:plug-zap'" :size="15"
          :class="testing ? 'animate-spin' : ''" />
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
      <span v-if="isDirty && !message && !testResult" class="flex items-center gap-1.5 text-[12px] text-accent">
        <span class="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        有未保存的更改
      </span>
      <button v-if="isDirty" type="button"
        class="flex h-9 items-center rounded-md px-2.5 text-[12px] text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="saving" @click="resetToSaved">
        还原
      </button>
      <span v-if="message && !testResult" class="text-[12px]" :class="hasError ? 'text-danger' : 'text-secondary'">{{
        message }}</span>
    </div>

    <!-- 测试结果面板：成功显示延迟和模型，失败显示具体的错误与排查建议。 -->
    <div v-if="testResult" ref="testResultRef" class="flex flex-col gap-1.5 rounded-lg border px-4 py-3"
      :class="testResult.ok ? 'border-[#46a758]/40 bg-[#46a758]/5' : 'border-danger/40 bg-danger/5'">
      <div class="flex items-center gap-2">
        <Icon :icon="testResult.ok ? 'lucide:check-circle-2' : 'lucide:x-circle'" :size="16"
          :class="testResult.ok ? 'text-[#46a758]' : 'text-danger'" />
        <span class="text-[13px] font-medium" :class="testResult.ok ? 'text-[#2c7a3d]' : 'text-danger'">
          {{ testResult.ok ? '连接成功' : '连接失败' }}
        </span>
        <span class="ml-auto font-mono text-[11px] text-muted">{{ testResult.provider }} · {{ testResult.model ||
          '（无模型名）' }}</span>
      </div>
      <div v-if="testResult.ok && testResult.latencyMs !== undefined" class="text-[12px] text-secondary">
        端到端延迟 {{ testResult.latencyMs }} ms
        <span v-if="testResult.sampleTokenCount" class="ml-2">已收到模型响应</span>
      </div>
      <!-- 测试通过后的保存状态说明：自动保存结果 / 表单本来就是保存状态。 -->
      <div v-if="testResult.ok && testSaveNote" class="text-[12px]"
        :class="hasError ? 'text-danger' : 'text-[#2c7a3d]'">
        {{ testSaveNote }}
      </div>
      <div v-if="!testResult.ok" class="break-all text-[12px] leading-5 text-secondary">{{ testResult.error }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useAiStatus } from '../../composables/useAiStatus'
import SectionTitle from './SectionTitle.vue'
import SettingGroup from './SettingGroup.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import IconSelect from './IconSelect.vue'
import type { IconSelectOption } from './IconSelect.vue'
import ModelSelector from './ModelSelector.vue'
import { aiService } from '../../services/aiService'
import { getApiKeyDisplay, prefillBaseUrls } from '../../utils/aiSettingsForm'
import type { AiProvider, AiProviderPublicConfig, AiSettingsInput, AiTestConnectionResult } from '../../types/ai'
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

/** 各厂商官方默认 API 地址（与主进程兜底逻辑一致），加载时直接写进输入框而非仅作提示文字 */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  minimax: 'https://api.minimax.io/v1',
  ollama: 'http://localhost:11434/v1',
  custom: 'https://api.example.com/v1',
}

const enabled = ref(false)
const provider = ref<AiProvider>('openai')
const temperature = ref(0.7)
const maxTokens = ref(8192)
const timeoutSeconds = ref(30)
const saving = ref(false)
const message = ref('')
const hasError = ref(false)

// 「测试连接」状态：testing 表示请求进行中，testResult 保留最后一次结果供展示。
const testing = ref(false)
const testResult = ref<AiTestConnectionResult | null>(null)
const testResultRef = ref<HTMLElement | null>(null)
// 测试成功后关于保存状态的说明（自动保存结果 / 已是保存状态）。
const testSaveNote = ref('')

// 测试结果位于设置页底部，渲染完成后主动滚动弹窗内部容器，确保完整结果立即可见。
watch(testResult, (result) => {
  if (!result) return
  void nextTick(() => {
    testResultRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
})

// 保存/还原流程会用服务端返回值整体刷新表单，这不算用户修改，不应清掉刚显示的测试结果。
let suppressTestReset = false

/** 每个厂商的公开配置（来自服务端，不含 apiKey） */
const providersConfig = ref<Record<string, AiProviderPublicConfig>>({})

/** 当前正在输入的 API Key（不回显，不保存到 providersConfig） */
const apiKeyDraft = ref('')

/** 聚焦已掩码的 Key 输入框后进入编辑态：清掉掩码方便直接输入新值 */
const apiKeyEditing = ref(false)

/**
 * 最近一次加载/保存成功时的表单快照，用于脏检查。
 * AI 配置必须原子提交（provider + model + baseUrl + key 是一个组合），
 * 不能像普通设置那样边改边存：编辑中间态会把 configured=false 泄漏给
 * 主进程，导致选区 AI 工具栏在用户还没改完时就闪回「配置 AI 后使用」。
 * 因此这里保留显式保存按钮，用快照判断「有没有真正改动」。
 */
interface AiFormSnapshot {
  enabled: boolean
  provider: AiProvider
  temperature: number
  maxTokens: number
  timeoutSeconds: number
  // Key 不含 apiKey（草稿为空表示保留原值），但含 hasApiKey 以反映密钥有无。
  providers: Record<string, AiProviderPublicConfig>
  apiKeyDraft: string
}

const snapshotForm = (): AiFormSnapshot => ({
  enabled: enabled.value,
  provider: provider.value,
  temperature: temperature.value,
  maxTokens: maxTokens.value,
  timeoutSeconds: timeoutSeconds.value,
  providers: JSON.parse(JSON.stringify(providersConfig.value)) as Record<string, AiProviderPublicConfig>,
  apiKeyDraft: apiKeyDraft.value,
})

let savedSnapshot: AiFormSnapshot | null = null

const isDirty = computed(() => {
  if (!savedSnapshot) return false
  const current = snapshotForm()
  if (
    current.enabled !== savedSnapshot.enabled ||
    current.provider !== savedSnapshot.provider ||
    current.temperature !== savedSnapshot.temperature ||
    current.maxTokens !== savedSnapshot.maxTokens ||
    current.timeoutSeconds !== savedSnapshot.timeoutSeconds ||
    current.apiKeyDraft !== savedSnapshot.apiKeyDraft
  ) return true
  return JSON.stringify(current.providers) !== JSON.stringify(savedSnapshot.providers)
})

/** 把表单恢复到最近一次保存的状态（包含清掉未提交的 Key 草稿和测试结果）。 */
const resetToSaved = (): void => {
  if (!savedSnapshot) return
  suppressTestReset = true
  enabled.value = savedSnapshot.enabled
  provider.value = savedSnapshot.provider
  temperature.value = savedSnapshot.temperature
  maxTokens.value = savedSnapshot.maxTokens
  timeoutSeconds.value = savedSnapshot.timeoutSeconds
  providersConfig.value = JSON.parse(JSON.stringify(savedSnapshot.providers)) as Record<string, AiProviderPublicConfig>
  apiKeyDraft.value = savedSnapshot.apiKeyDraft
  apiKeyEditing.value = false
  message.value = ''
  hasError.value = false
  testResult.value = null
  testSaveNote.value = ''
  nextTick(() => { suppressTestReset = false })
}

// 模型选择器引用
const modelSelectorRef = ref<InstanceType<typeof ModelSelector> | null>(null)

// 保存后刷新全局共享的 AI 状态（单例 ref），让选区 AI 工具栏即时生效。
const { refresh: refreshAiStatus } = useAiStatus()

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

/** 已保存 Key 时输入框里显示的掩码（password 型输入框渲染为圆点），表示该厂商配置过密钥 */
const API_KEY_MASK = '••••••••••••'

const apiKeyDisplay = computed(() =>
  getApiKeyDisplay(apiKeyDraft.value, apiKeyEditing.value, currentConfig.value.hasApiKey, API_KEY_MASK),
)

const onApiKeyFocus = (): void => {
  // 只在掩码状态下切入编辑态；未配置过的厂商本来就是空输入框
  if (!apiKeyDraft.value && currentConfig.value.hasApiKey) apiKeyEditing.value = true
}

const onApiKeyInput = (event: Event): void => {
  apiKeyDraft.value = (event.target as HTMLInputElement).value
}

const onApiKeyBlur = (): void => {
  // 退出编辑态；没输入内容就恢复掩码显示（留空 = 保留已保存的 Key）
  apiKeyEditing.value = false
}

// 切换厂商时清空 API Key 草稿、编辑态和模型列表；旧厂商的测试结果对新厂商无效。
watch(provider, () => {
  apiKeyDraft.value = ''
  apiKeyEditing.value = false
  modelSelectorRef.value?.setModels([])
  testResult.value = null
  testSaveNote.value = ''
})

// 启用开关、模型、API 地址、Key 草稿任一变化都会让旧的测试结果失效，立即撤下成功/失败提示。
watch([enabled, currentModel, currentBaseUrl, apiKeyDraft], () => {
  if (suppressTestReset) return
  testResult.value = null
  testSaveNote.value = ''
})

// ── 获取模型列表 ──
const buildDraftPayload = (): AiSettingsInput => {
  const providersPayload: Record<string, { model: string; baseUrl?: string; apiKey?: string; customModels?: string[] }> = {}
  for (const key of ALL_PROVIDERS) {
    const cfg = providersConfig.value[key]
    if (!cfg) continue
    // 从 Vue reactive 中显式拷贝一层纯净的 JavaScript 字面量对象，
    // 防止 Proxy + undefined 字段在穿过 Electron IPC 时触发 “An object could not be cloned”。
    // 同时只保留能结构化克隆的字符串/字符串数组类型。
    const baseUrl = typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim() ? cfg.baseUrl.trim() : undefined
    const apiKey =
      key === provider.value && apiKeyDraft.value.trim()
        ? apiKeyDraft.value.trim()
        : undefined
    const customModels = Array.isArray(cfg.customModels)
      ? cfg.customModels
        .filter((m): m is string => typeof m === 'string')
        .map((m) => m.trim())
        .filter(Boolean)
      : []
    providersPayload[key] = {
      model: typeof cfg.model === 'string' ? cfg.model.trim() : '',
      ...(baseUrl ? { baseUrl } : {}),
      customModels,
      ...(apiKey ? { apiKey } : {}),
    }
  }
  const draft: AiSettingsInput = {
    enabled: Boolean(enabled.value),
    provider: provider.value,
    providers: providersPayload,
    temperature: typeof temperature.value === 'number' ? temperature.value : 0.7,
    maxTokens: typeof maxTokens.value === 'number' ? Math.max(1, Math.floor(maxTokens.value)) : 8192,
    timeoutMs: typeof timeoutMs.value === 'number' ? Math.max(1, Math.floor(timeoutMs.value)) : 30000,
    allowLocalRequests: Boolean(allowLocalRequests.value),
  }
  // 最后一次保险：序列化再反序列化彻底清掉 Proxy、Symbol、循环引用。
  // 副作用是把任何无法 JSON 化的字段全部去掉，保证跨 IPC 一定可克隆。
  return JSON.parse(JSON.stringify(draft)) as AiSettingsInput
}

const onFetchModels = async () => {
  if (!modelSelectorRef.value) return
  modelSelectorRef.value.startLoading()
  try {
    // 草稿模式：直接把当前表单当草稿发给主进程临时验证，不会写磁盘，
    // 也不会触发 cachedSettings / 快照状态等副作用 —— 避免「点刷新」
    // 就把改动「落盘」并让 isDirty 错误地变成干净。
    const draft = buildDraftPayload()
    const result = await aiService.fetchModelsWithDraft(draft)
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

// 预填后输入框一般都有值；placeholder 仅在用户手动清空地址时兜底提示。
const baseUrlPlaceholder = computed(() => DEFAULT_BASE_URLS[provider.value] ?? DEFAULT_BASE_URLS.openai)

const load = async (): Promise<void> => {
  try {
    const settings = await aiService.getSettings()
    enabled.value = settings.enabled
    provider.value = settings.provider
    // 加载每个厂商的独立配置（不含 apiKey）；未配置地址的厂商直接预填官方默认地址，
    // 让输入框始终展示实际会生效的地址，而不是一聚焦就消失的提示文字。
    providersConfig.value = prefillBaseUrls(settings.providers, DEFAULT_BASE_URLS)
    temperature.value = settings.temperature
    maxTokens.value = settings.maxTokens
    timeoutSeconds.value = Math.round(settings.timeoutMs / 1000)
    savedSnapshot = snapshotForm()
    apiKeyDraft.value = ''
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  }
}

const save = async (): Promise<void> => {
  saving.value = true
  hasError.value = false
  message.value = ''
  suppressTestReset = true
  try {
    // 复用 buildDraftPayload() 构造纯净的可克隆 payload（含未保存的 Key 草稿）。
    const payload = buildDraftPayload()
    const settings = await aiService.saveSettings(payload)
    // 保存后重新加载 providers 状态（服务端可能加密了 apiKey）
    providersConfig.value = { ...settings.providers }
    apiKeyDraft.value = ''
    // 立即同步全局 AI 状态，选区 AI 工具栏等入口马上从
    // 「配置 AI 后使用」切换为正常动作按钮，无需重启应用。
    await refreshAiStatus()
    savedSnapshot = snapshotForm()
    message.value = 'AI 设置已保存'
    // 测试结果面板显示时按钮行的 message 会被面板遮住，同步刷新面板里的保存说明
    if (testResult.value?.ok) testSaveNote.value = '配置已保存并生效'
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
    nextTick(() => { suppressTestReset = false })
  }
}

/**
 * 真实请求级别的连通性测试：让主进程用「当前表单草稿 + 已保存密钥合并」
 * 的临时配置发一次 1 token 的聊天补全（max_tokens=1，费用可忽略）。
 * 测试通过后如果表单有改动会立即自动保存并生效——测试通过说明这套配置
 * 真实可用，省去再点一次「保存」，也避免「没改动时保存按钮是灰色」的困惑。
 */
const runConnectionTest = async (): Promise<void> => {
  testing.value = true
  testResult.value = null
  testSaveNote.value = ''
  hasError.value = false
  message.value = ''
  try {
    const draft = buildDraftPayload()
    testResult.value = await aiService.testConnectionWithDraft(draft)
    if (!testResult.value.ok) return
    if (!isDirty.value) {
      testSaveNote.value = '当前配置已是保存状态'
      return
    }
    await save()
    testSaveNote.value = hasError.value ? `自动保存失败：${message.value}` : '配置已自动保存并生效'
  } catch (error) {
    testResult.value = {
      ok: false,
      provider: provider.value,
      model: currentConfig.value.model ?? '',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    testing.value = false
  }
}

defineExpose({
  /** 当前是否有未保存的更改（供父级在切分区或关闭前提示）。 */
  get isDirty() { return isDirty.value },
  /** 还原到最近一次保存的状态。 */
  resetToSaved,
})

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
