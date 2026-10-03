import { defineComponent as _defineComponent } from 'vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useAiStatus } from '../../composables/useAiStatus'
const SectionTitle = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const SettingGroup = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const IconSelect = { inheritAttrs: false, render() { return this.$slots.default?.() } }
import type { IconSelectOption } from './IconSelect.vue'
const ModelSelector = { inheritAttrs: false, render() { return this.$slots.default?.() } }
import { saveModelCatalog } from '../../services/aiModelCatalog'
import { aiService } from '../../services/aiService'
import { getApiKeyDisplay, prefillBaseUrls } from '../../utils/aiSettingsForm'
import { aiProviderTemplate } from '../../types/ai'
import type { AiProviderTemplate, AiProvider, AiProviderPublicConfig, AiSettingsInput, AiTestConnectionResult } from '../../types/ai'
const anthropicSvg = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const openaiSvg = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const deepseekSvg = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const minimaxSvg = { inheritAttrs: false, render() { return this.$slots.default?.() } }
const ollamaSvg = { inheritAttrs: false, render() { return this.$slots.default?.() } }

interface AiFormSnapshot {
  provider: AiProvider
  temperature: number
  maxTokens: number
  timeoutSeconds: number
  agentMaxSteps: number
  agentTaskMinutes: number
  // Key 不含 apiKey（草稿为空表示保留原值），但含 hasApiKey 以反映密钥有无。
  providers: Record<string, AiProviderPublicConfig>
  removedProviders: AiProvider[]
  apiKeyDrafts: Record<string, string>
}

const API_KEY_MASK = '••••••••••••'


const Panel = /*@__PURE__*/_defineComponent({
  setup(__props, { expose: __expose }) {

const providerOptions: IconSelectOption[] = [
  { value: 'openai', label: 'OpenAI', svg: openaiSvg },
  { value: 'anthropic', label: 'Anthropic', svg: anthropicSvg },
  { value: 'deepseek', label: 'DeepSeek', svg: deepseekSvg },
  { value: 'minimax', label: 'MiniMax', svg: minimaxSvg },
  { value: 'ollama', label: 'Ollama', svg: ollamaSvg },
  { value: 'custom', label: '自定义', icon: 'lucide:sliders-horizontal' },
]

const newTemplate = ref<AiProviderTemplate>('custom')
// 明确记录删除，保存失败时保留记录以便重试。
const removedProviders = ref<AiProvider[]>([])

/** 各厂商官方默认 API 地址（与主进程兜底逻辑一致），加载时直接写进输入框而非仅作提示文字 */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  minimax: 'https://api.minimax.io/v1',
  ollama: 'http://localhost:11434/v1',
  anthropic: 'https://api.anthropic.com/v1',
}

const provider = ref<AiProvider>('openai')
const temperature = ref(0.7)
const maxTokens = ref(16384)
const timeoutSeconds = ref(180)
// 文档 Agent 的执行上限：轮数（步）与任务总时长（分钟）。
const agentMaxSteps = ref(12)
const agentTaskMinutes = ref(5)
const saving = ref(false)
const message = ref('')
const hasError = ref(false)

// 「测试连接」状态：testing 表示请求进行中，testResult 保留最后一次结果供展示。
const testing = ref(false)
const testResult = ref<AiTestConnectionResult | null>(null)
const testResultRef = ref<HTMLElement | null>(null)

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
// 密钥草稿按连接保存，切换厂商不会清掉尚未保存的输入。
const apiKeyDrafts = ref<Record<string, string>>({})
const apiKeyDraft = computed({
  get: () => apiKeyDrafts.value[provider.value] ?? '',
  set: (value: string) => { apiKeyDrafts.value[provider.value] = value },
})

/** 聚焦已掩码的 Key 输入框后进入编辑态：清掉掩码方便直接输入新值 */
const apiKeyEditing = ref(false)

/**
 * 最近一次自动保存成功时的表单快照，用于脏检查。
 * AI 配置必须原子提交（provider + model + baseUrl + key 是一个组合），
 * 不能像普通设置那样改一个就落盘一个：编辑中间态会把 configured=false 泄漏给
 * 主进程，导致选区 AI 工具栏在用户还没改完时就闪回「配置 AI 后使用」。
 * 因此这里在表单停顿约 1 秒后把完整组合整体自动保存，避免中间态落盘。
 */
const snapshotForm = (): AiFormSnapshot => ({
  provider: provider.value,
  temperature: temperature.value,
  maxTokens: maxTokens.value,
  timeoutSeconds: timeoutSeconds.value,
  agentMaxSteps: agentMaxSteps.value,
  agentTaskMinutes: agentTaskMinutes.value,
  providers: JSON.parse(JSON.stringify(providersConfig.value)) as Record<string, AiProviderPublicConfig>,
  removedProviders: [...removedProviders.value],
  apiKeyDrafts: { ...apiKeyDrafts.value },
})

// ref 让首次加载后的脏检查重新计算，避免一直缓存 false。
const savedSnapshot = ref<AiFormSnapshot | null>(null)

const isDirty = computed(() => {
  if (!savedSnapshot.value) return false
  const current = snapshotForm()
  if (
    JSON.stringify(current.removedProviders) !== JSON.stringify(savedSnapshot.value.removedProviders) ||
    current.provider !== savedSnapshot.value.provider ||
    current.temperature !== savedSnapshot.value.temperature ||
    current.maxTokens !== savedSnapshot.value.maxTokens ||
    current.timeoutSeconds !== savedSnapshot.value.timeoutSeconds ||
    current.agentMaxSteps !== savedSnapshot.value.agentMaxSteps ||
    current.agentTaskMinutes !== savedSnapshot.value.agentTaskMinutes ||
    JSON.stringify(current.apiKeyDrafts) !== JSON.stringify(savedSnapshot.value.apiKeyDrafts)
  ) return true
  return JSON.stringify(current.providers) !== JSON.stringify(savedSnapshot.value.providers)
})

/** 把表单恢复到最近一次保存的状态（包含清掉未提交的 Key 草稿和测试结果）。 */
const resetToSaved = (): void => {
  if (!savedSnapshot.value) return
  suppressTestReset = true
  provider.value = savedSnapshot.value.provider
  temperature.value = savedSnapshot.value.temperature
  maxTokens.value = savedSnapshot.value.maxTokens
  timeoutSeconds.value = savedSnapshot.value.timeoutSeconds
  agentMaxSteps.value = savedSnapshot.value.agentMaxSteps
  agentTaskMinutes.value = savedSnapshot.value.agentTaskMinutes
  providersConfig.value = JSON.parse(JSON.stringify(savedSnapshot.value.providers)) as Record<string, AiProviderPublicConfig>
  removedProviders.value = [...savedSnapshot.value.removedProviders]
  apiKeyDrafts.value = { ...savedSnapshot.value.apiKeyDrafts }
  apiKeyEditing.value = false
  message.value = ''
  hasError.value = false
  testResult.value = null
  nextTick(() => { suppressTestReset = false })
}

// ── 自动保存 ──
// 表单停顿约 1 秒后把完整组合整体落盘。停顿窗口保证用户在编辑中间态
// （如刚切厂商还没填 Key）时不会有半成品写入，也就不会让 configured
// 短暂变为 false、引发选区 AI 工具栏闪回。
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

watch(
  [
    provider,
    temperature,
    maxTokens,
    timeoutSeconds,
    agentMaxSteps,
    agentTaskMinutes,
    apiKeyDrafts,
    removedProviders,
    // providersConfig（厂商模型/地址/自定义模型）为嵌套对象，深度监听。
    providersConfig,
  ],
  () => {
    // 加载/保存/还原流程正在刷新表单时，不触发新的自动保存；配置尚未加载完成前也无从保存。
    if (suppressTestReset || !savedSnapshot.value) return
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null
      // 只在真正有改动时保存，避免循环保存。
      if (isDirty.value && !saving.value) saveFromButton()
    }, 1000)
  },
  { deep: true },
)

// 模型选择器引用
const modelSelectorRef = ref<InstanceType<typeof ModelSelector> | null>(null)

// 保存后刷新全局共享的 AI 状态（单例 ref），让选区 AI 工具栏即时生效。
const { refresh: refreshAiStatus } = useAiStatus()

// ── 当前厂商的快捷访问 ──
const currentConfig = computed(() => providersConfig.value[provider.value] ?? { model: '', hasApiKey: false, customModels: [] })

// 显示名称与协议分开，同一厂商可创建多个连接。
const currentTemplate = computed(() => aiProviderTemplate(provider.value))
const connectionOptions = computed<IconSelectOption[]>(() => Object.entries(providersConfig.value).map(([id, config]) => {
  const template = providerOptions.find((option) => option.value === aiProviderTemplate(id as AiProvider))!
  return { ...template, value: id, label: config.name || template.label }
}))
const currentName = computed({
  get: () => currentConfig.value.name ?? '',
  set: (name: string) => { providersConfig.value[provider.value] = { ...currentConfig.value, name } },
})
const addConnection = (): void => {
  const template = newTemplate.value
  const id: AiProvider = `${template}:${crypto.randomUUID()}`
  const label = providerOptions.find((option) => option.value === template)!.label
  providersConfig.value[id] = { name: `${label} 新连接`, model: '', baseUrl: DEFAULT_BASE_URLS[template], hasApiKey: false, customModels: [] }
  provider.value = id
}

/** 旧连接和新连接都能删除，先选择剩余连接再提交删除记录。 */
const removeConnection = (): void => {
  const id = provider.value
  const remaining = Object.keys(providersConfig.value).find((key) => key !== id)
  if (!remaining) throw new Error('请先添加其他连接，再删除此连接')
  provider.value = remaining as AiProvider
  delete providersConfig.value[id]
  delete apiKeyDrafts.value[id]
  removedProviders.value.push(id)
}

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

/** 删除当前连接中的自定义模型；删掉当前模型时需要重新选择。 */
const removeCustomModel = (model: string): void => {
  currentCustomModels.value = currentCustomModels.value.filter((item) => item !== model)
  if (currentModel.value === model) currentModel.value = ''
}

/** 已保存 Key 时输入框里显示的掩码（password 型输入框渲染为圆点），表示该厂商配置过密钥 */
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

// 切换连接只清空编辑态和临时模型列表，保留各连接的密钥草稿。
watch(provider, () => {
  apiKeyEditing.value = false
  modelSelectorRef.value?.setModels([])
  testResult.value = null
})

// 模型、API 地址、Key 草稿任一变化都会让旧的测试结果失效，立即撤下成功/失败提示。
watch([currentModel, currentBaseUrl, apiKeyDraft], () => {
  if (suppressTestReset) return
  testResult.value = null
})

// ── 获取模型列表 ──
const buildDraftPayload = (): AiSettingsInput => {
  const providersPayload: Record<string, { name?: string; model: string; baseUrl?: string; apiKey?: string; customModels?: string[] }> = {}
  for (const key of Object.keys(providersConfig.value)) {
    const cfg = providersConfig.value[key]
    if (!cfg) continue
    // 从 Vue reactive 中显式拷贝一层纯净的 JavaScript 字面量对象，
    // 防止 Proxy + undefined 字段在穿过 Electron IPC 时触发 “An object could not be cloned”。
    // 同时只保留能结构化克隆的字符串/字符串数组类型。
    const baseUrl = typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim() ? cfg.baseUrl.trim() : undefined
    const apiKey =
      apiKeyDrafts.value[key]?.trim()
        ? apiKeyDrafts.value[key].trim()
        : undefined
    const customModels = Array.isArray(cfg.customModels)
      ? cfg.customModels
        .filter((m): m is string => typeof m === 'string')
        .map((m) => m.trim())
        .filter(Boolean)
      : []
    providersPayload[key] = {
      name: cfg.name,
      model: typeof cfg.model === 'string' ? cfg.model.trim() : '',
      ...(baseUrl ? { baseUrl } : {}),
      customModels,
      ...(apiKey ? { apiKey } : {}),
    }
  }
  const draft: AiSettingsInput = {
    removedProviders: [...removedProviders.value],
    // 保留旧 IPC 字段，配置完成后直接使用 AI。
    enabled: true,
    provider: provider.value,
    providers: providersPayload,
    temperature: typeof temperature.value === 'number' ? temperature.value : 0.7,
    maxTokens: typeof maxTokens.value === 'number' ? Math.max(1, Math.floor(maxTokens.value)) : 16384,
    timeoutMs: typeof timeoutMs.value === 'number' ? Math.max(1, Math.floor(timeoutMs.value)) : 180000,
    allowLocalRequests: Boolean(allowLocalRequests.value),
    agentMaxSteps: typeof agentMaxSteps.value === 'number' ? Math.max(1, Math.floor(agentMaxSteps.value)) : 12,
    agentTaskMs: typeof agentTaskMinutes.value === 'number' && agentTaskMinutes.value > 0
      ? Math.max(60000, Math.floor(agentTaskMinutes.value * 60 * 1000))
      : 5 * 60 * 1000,
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
      // 复用设置中获取的模型，侧栏无需重复请求厂商。
      saveModelCatalog(draft.provider!, draft.providers![draft.provider!].baseUrl ?? '', result.models)
      modelSelectorRef.value.setModels(result.models)
    }
  } catch (error) {
    modelSelectorRef.value.setError(error instanceof Error ? error.message : String(error))
  }
}

const timeoutMs = computed(() => Math.max(1, Math.round(timeoutSeconds.value * 1000)))

const allowLocalRequests = computed(() => {
  if (currentTemplate.value === 'ollama') return true
  const url = (currentBaseUrl.value || '').trim().toLowerCase()
  if (!url) return false
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')
})

// 预填后输入框一般都有值；placeholder 仅在用户手动清空地址时兜底提示。
const baseUrlPlaceholder = computed(() => DEFAULT_BASE_URLS[currentTemplate.value] ?? 'https://你的服务地址/v1')

const load = async (): Promise<void> => {
  try {
    const settings = await aiService.getSettings()
    provider.value = settings.provider
    // 加载每个厂商的独立配置（不含 apiKey）；未配置地址的厂商直接预填官方默认地址，
    // 让输入框始终展示实际会生效的地址，而不是一聚焦就消失的提示文字。
    providersConfig.value = prefillBaseUrls(settings.providers, DEFAULT_BASE_URLS)
    temperature.value = settings.temperature
    maxTokens.value = settings.maxTokens
    timeoutSeconds.value = Math.round(settings.timeoutMs / 1000)
    agentMaxSteps.value = settings.agentMaxSteps
    agentTaskMinutes.value = Math.max(1, Math.round(settings.agentTaskMs / 60000))
    apiKeyDrafts.value = {}
    savedSnapshot.value = snapshotForm()
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  }
}

// 关闭页面时等待同一次保存完成，避免重复写入。
let pendingSave: Promise<void> | null = null
const save = (): Promise<void> => {
  if (pendingSave) return pendingSave
  pendingSave = performSave().finally(() => { pendingSave = null })
  return pendingSave
}
// 自动保存失败已经展示在页面中，保留草稿供用户重试。
const saveFromButton = (): void => {
  void save().catch((error: unknown) => {
    // 按钮和定时器没有等待方，必须在页面明确显示保存失败。
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
  })
}
const performSave = async (): Promise<void> => {
  saving.value = true
  hasError.value = false
  message.value = ''
  suppressTestReset = true
  // 取消可能仍在等待中的自动保存定时器，避免保存后再次触发做无用保存。
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  try {
    // 复用 buildDraftPayload() 构造纯净的可克隆 payload（含未保存的 Key 草稿）。
    const payload = buildDraftPayload()
    const settings = await aiService.saveSettings(payload)
    // 保存后重新加载 providers 状态（服务端可能加密了 apiKey）
    providersConfig.value = { ...settings.providers }
    apiKeyDrafts.value = {}
    removedProviders.value = []
    // 立即同步全局 AI 状态，选区 AI 工具栏等入口马上从
    // 「配置 AI 后使用」切换为正常动作按钮，无需重启应用。
    await refreshAiStatus()
    savedSnapshot.value = snapshotForm()
    message.value = 'AI 设置已自动保存'
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    saving.value = false
    nextTick(() => { suppressTestReset = false })
  }
}

/**
 * 真实请求级别的连通性测试：让主进程用「当前表单草稿 + 已保存密钥合并」
 * 的临时配置发一次 1 token 的聊天补全（max_tokens=1，费用可忽略）。
 * 测试成功后立即保存；保存失败会显示错误并保留草稿。
 */
const runConnectionTest = async (): Promise<void> => {
  testing.value = true
  testResult.value = null
  hasError.value = false
  message.value = ''
  try {
    const draft = buildDraftPayload()
    testResult.value = await aiService.testConnectionWithDraft(draft)
    // 连接成功后立即保存，确保离开页面时配置已经落盘。
    if (testResult.value.ok) await flushNow()
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

/**
 * 立即落盘当前表单（若有改动）。供父级在切分区或关闭设置前调用，
 * 确保停顿窗口还没结束时用户离开也能保住最后一批编辑。
 */
const flushNow = (): Promise<void> => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (saving.value) return pendingSave!
  if (isDirty.value) return save()
  return Promise.resolve()
}

__expose({
  /** 当前是否有未保存的更改（供父级在切分区或关闭前决定是否落盘）。 */
  get isDirty() { return isDirty.value },
  /** 还原到最近一次保存的状态。 */
  resetToSaved,
  /** 立即落盘当前表单（若有改动）。 */
  flushNow,
})

onMounted(() => void load())

const __returned__ = { providerOptions, newTemplate, removedProviders, DEFAULT_BASE_URLS, provider, temperature, maxTokens, timeoutSeconds, agentMaxSteps, agentTaskMinutes, saving, message, hasError, testing, testResult, testResultRef, get suppressTestReset() { return suppressTestReset }, set suppressTestReset(v) { suppressTestReset = v }, providersConfig, apiKeyDrafts, apiKeyDraft, apiKeyEditing, snapshotForm, savedSnapshot, isDirty, resetToSaved, get autoSaveTimer() { return autoSaveTimer }, set autoSaveTimer(v) { autoSaveTimer = v }, modelSelectorRef, refreshAiStatus, currentConfig, currentTemplate, connectionOptions, currentName, addConnection, removeConnection, currentModel, currentBaseUrl, currentCustomModels, removeCustomModel, API_KEY_MASK, apiKeyDisplay, onApiKeyFocus, onApiKeyInput, onApiKeyBlur, buildDraftPayload, onFetchModels, timeoutMs, allowLocalRequests, baseUrlPlaceholder, load, get pendingSave() { return pendingSave }, set pendingSave(v) { pendingSave = v }, save, saveFromButton, performSave, runConnectionTest, flushNow, get Icon() { return Icon }, SectionTitle, SettingGroup, IconSelect, ModelSelector }
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })
return __returned__
}

})
import { createVNode as _createVNode, createCommentVNode as _createCommentVNode, createElementVNode as _createElementVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, createTextVNode as _createTextVNode, normalizeClass as _normalizeClass, vModelText as _vModelText, withDirectives as _withDirectives, withCtx as _withCtx, createBlock as _createBlock } from "vue"

const _hoisted_1 = ["disabled"]
const _hoisted_2 = { class: "flex flex-col gap-2 rounded-lg border border-line p-4" }
const _hoisted_3 = { class: "flex flex-wrap gap-2" }
const _hoisted_4 = ["onClick"]
const _hoisted_5 = {
  key: 0,
  class: "text-[11px]"
}
const _hoisted_6 = { class: "flex items-center gap-3 rounded-lg border border-line px-5 py-4" }
const _hoisted_7 = { class: "flex items-center gap-3" }
const _hoisted_8 = ["disabled"]
const _hoisted_9 = {
  key: 0,
  class: "text-[12px] text-muted"
}
const _hoisted_10 = {
  key: 0,
  class: "flex flex-col gap-2 rounded-lg border border-line p-4"
}
const _hoisted_11 = { class: "min-w-0 break-all text-[13px] text-secondary" }
const _hoisted_12 = ["onClick"]
const _hoisted_13 = ["placeholder"]
const _hoisted_14 = ["value"]
const _hoisted_15 = { class: "flex flex-col rounded-lg border border-line bg-panel" }
const _hoisted_16 = { class: "flex items-center justify-between gap-8 border-b border-line px-5 py-4" }
const _hoisted_17 = { class: "flex items-center justify-between gap-8 border-b border-line px-5 py-4" }
const _hoisted_18 = { class: "flex items-center justify-between gap-8 px-5 py-4" }
const _hoisted_19 = { class: "flex flex-col rounded-lg border border-line bg-panel" }
const _hoisted_20 = { class: "flex items-center justify-between gap-8 border-b border-line px-5 py-4" }
const _hoisted_21 = { class: "flex items-center justify-between gap-8 px-5 py-4" }
const _hoisted_22 = { class: "flex items-center gap-3" }
const _hoisted_23 = ["disabled"]
const _hoisted_24 = {
  key: 0,
  class: "flex items-center gap-1.5 text-[12px] text-accent"
}
const _hoisted_25 = ["disabled"]
const _hoisted_26 = ["disabled"]
const _hoisted_27 = { class: "flex items-center gap-2" }
const _hoisted_28 = { class: "ml-auto font-mono text-[11px] text-muted" }
const _hoisted_29 = {
  key: 0,
  class: "text-[12px] text-secondary"
}
const _hoisted_30 = {
  key: 0,
  class: "ml-2"
}
const _hoisted_31 = {
  key: 1,
  class: "break-all text-[12px] leading-5 text-secondary"
}

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("fieldset", {
    disabled: $setup.saving || $setup.testing,
    class: "flex min-w-0 flex-col gap-5 border-0 p-0"
  }, [
    _createVNode($setup["SectionTitle"], {
      title: "AI 设置",
      description: "管理多个模型连接，分别保存地址、密钥与模型。"
    }),
    _createCommentVNode(" 按连接展示列表，当前连接同时用于聊天和文档助手。 "),
    _createElementVNode("div", _hoisted_2, [
      _cache[11] || (_cache[11] = _createElementVNode("span", { class: "text-[13px] font-semibold text-ink" }, "模型连接", -1 /* CACHED */)),
      _cache[12] || (_cache[12] = _createElementVNode("p", { class: "text-[12px] text-muted" }, "点击选择当前连接，同一厂商可添加多个账号或服务地址。", -1 /* CACHED */)),
      _createElementVNode("div", _hoisted_3, [
        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList($setup.connectionOptions, (connection) => {
          return (_openBlock(), _createElementBlock("button", {
            key: connection.value,
            type: "button",
            class: _normalizeClass(["flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]", $setup.provider === connection.value ? 'border-accent bg-selected text-accent' : 'border-line text-secondary hover:bg-selected']),
            onClick: $event => ($setup.provider = connection.value as AiProvider)
          }, [
            _createTextVNode(_toDisplayString(connection.label) + " ", 1 /* TEXT */),
            ($setup.provider === connection.value)
              ? (_openBlock(), _createElementBlock("span", _hoisted_5, "当前使用"))
              : _createCommentVNode("v-if", true)
          ], 10 /* CLASS, PROPS */, _hoisted_4))
        }), 128 /* KEYED_FRAGMENT */))
      ])
    ]),
    _createCommentVNode(" 厂商模板决定协议，每次添加都会建立独立的连接。 "),
    _createElementVNode("div", _hoisted_6, [
      _createVNode($setup["IconSelect"], {
        modelValue: $setup.newTemplate,
        "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => (($setup.newTemplate) = $event)),
        options: $setup.providerOptions,
        placeholder: "选择厂商模板"
      }, null, 8 /* PROPS */, ["modelValue"]),
      _createElementVNode("button", {
        type: "button",
        class: "flex h-9 items-center rounded-md border border-line px-3 text-[13px] text-ink hover:bg-selected",
        onClick: $setup.addConnection
      }, "添加连接")
    ]),
    _createVNode($setup["SettingGroup"], {
      title: "连接名称",
      description: "例如：工作账号、公司中转服务。"
    }, {
      default: _withCtx(() => [
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[1] || (_cache[1] = $event => (($setup.currentName) = $event)),
          type: "text",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent",
          placeholder: "输入连接名称"
        }, null, 512 /* NEED_PATCH */), [
          [_vModelText, $setup.currentName]
        ])
      ]),
      _: 1 /* STABLE */
    }),
    _createElementVNode("div", _hoisted_7, [
      _createElementVNode("button", {
        type: "button",
        class: "flex self-start rounded-md border border-line px-3 py-2 text-[12px] text-danger disabled:opacity-50",
        disabled: $setup.connectionOptions.length === 1,
        onClick: $setup.removeConnection
      }, "删除此连接", 8 /* PROPS */, _hoisted_8),
      ($setup.connectionOptions.length === 1)
        ? (_openBlock(), _createElementBlock("span", _hoisted_9, "请先添加其他连接，再删除此连接。"))
        : _createCommentVNode("v-if", true)
    ]),
    _createVNode($setup["SettingGroup"], {
      title: "模型名称",
      description: "从列表选择或输入自定义模型名称，点击刷新获取可用模型。"
    }, {
      default: _withCtx(() => [
        _createVNode($setup["ModelSelector"], {
          ref: "modelSelectorRef",
          modelValue: $setup.currentModel,
          "onUpdate:modelValue": _cache[2] || (_cache[2] = $event => (($setup.currentModel) = $event)),
          customModels: $setup.currentCustomModels,
          "onUpdate:customModels": _cache[3] || (_cache[3] = $event => (($setup.currentCustomModels) = $event)),
          placeholder: "输入或选择模型",
          onFetch: $setup.onFetchModels
        }, null, 8 /* PROPS */, ["modelValue", "customModels"]),
        _createCommentVNode(" 直接输入的模型也可以删除，不依赖是否加入自定义列表。 "),
        ($setup.currentModel)
          ? (_openBlock(), _createElementBlock("button", {
              key: 0,
              type: "button",
              class: "flex shrink-0 rounded-md px-2 py-1 text-[12px] text-danger hover:bg-selected",
              onClick: _cache[4] || (_cache[4] = $event => ($setup.removeCustomModel($setup.currentModel)))
            }, "删除当前模型"))
          : _createCommentVNode("v-if", true)
      ]),
      _: 1 /* STABLE */
    }),
    _createCommentVNode(" 自定义模型直接展示在页面上，无需先清空输入框才能删除。 "),
    ($setup.currentCustomModels.length)
      ? (_openBlock(), _createElementBlock("div", _hoisted_10, [
          _cache[13] || (_cache[13] = _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "已添加的自定义模型", -1 /* CACHED */)),
          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList($setup.currentCustomModels, (model) => {
            return (_openBlock(), _createElementBlock("div", {
              key: model,
              class: "flex items-center justify-between gap-3"
            }, [
              _createElementVNode("span", _hoisted_11, _toDisplayString(model), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "flex shrink-0 rounded-md px-2 py-1 text-[12px] text-danger hover:bg-selected",
                onClick: $event => ($setup.removeCustomModel(model))
              }, "删除", 8 /* PROPS */, _hoisted_12)
            ]))
          }), 128 /* KEYED_FRAGMENT */))
        ]))
      : _createCommentVNode("v-if", true),
    _createVNode($setup["SettingGroup"], {
      title: "API 地址",
      description: "填写此连接的服务地址，厂商模板会填入官方地址。"
    }, {
      default: _withCtx(() => [
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[5] || (_cache[5] = $event => (($setup.currentBaseUrl) = $event)),
          type: "text",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent",
          placeholder: $setup.baseUrlPlaceholder
        }, null, 8 /* PROPS */, _hoisted_13), [
          [_vModelText, $setup.currentBaseUrl]
        ])
      ]),
      _: 1 /* STABLE */
    }),
    ($setup.currentTemplate !== 'ollama')
      ? (_openBlock(), _createBlock($setup["SettingGroup"], {
          key: 1,
          title: "API Key",
          description: "已配置的厂商显示掩码；聚焦后输入新值即可替换，留空保持原 Key。"
        }, {
          default: _withCtx(() => [
            _createElementVNode("input", {
              value: $setup.apiKeyDisplay,
              type: "password",
              class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent",
              placeholder: "sk-...",
              autocomplete: "off",
              onFocus: $setup.onApiKeyFocus,
              onInput: $setup.onApiKeyInput,
              onBlur: $setup.onApiKeyBlur
            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_14)
          ]),
          _: 1 /* STABLE */
        }))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" 生成参数分组：三个数值参数收进一个圆角容器，与上方的连接配置在视觉上区分开 "),
    _createElementVNode("div", _hoisted_15, [
      _cache[17] || (_cache[17] = _createElementVNode("div", { class: "flex flex-col gap-1 px-5 pb-3 pt-4" }, [
        _createElementVNode("h4", { class: "text-[13px] font-semibold text-ink" }, "生成参数"),
        _createElementVNode("p", { class: "text-[12px] text-muted" }, "控制生成质量与稳定性，保存后对所有 AI 功能生效。")
      ], -1 /* CACHED */)),
      _createElementVNode("div", _hoisted_16, [
        _cache[14] || (_cache[14] = _createElementVNode("div", { class: "flex min-w-0 flex-1 flex-col gap-1" }, [
          _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "温度"),
          _createElementVNode("span", { class: "text-[12px] text-muted" }, "0-2，数值越高生成结果越有创造性。")
        ], -1 /* CACHED */)),
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[6] || (_cache[6] = $event => (($setup.temperature) = $event)),
          type: "number",
          min: "0",
          max: "2",
          step: "0.1",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper"
        }, null, 512 /* NEED_PATCH */), [
          [
            _vModelText,
            $setup.temperature,
            void 0,
            { number: true }
          ]
        ])
      ]),
      _createElementVNode("div", _hoisted_17, [
        _cache[15] || (_cache[15] = _createElementVNode("div", { class: "flex min-w-0 flex-1 flex-col gap-1" }, [
          _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "单次请求输出预算"),
          _createElementVNode("span", { class: "text-[12px] text-muted" }, "单次生成的最大 token 数，过小可能导致长内容被截断。")
        ], -1 /* CACHED */)),
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[7] || (_cache[7] = $event => (($setup.maxTokens) = $event)),
          type: "number",
          min: "256",
          max: "32768",
          step: "256",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper"
        }, null, 512 /* NEED_PATCH */), [
          [
            _vModelText,
            $setup.maxTokens,
            void 0,
            { number: true }
          ]
        ])
      ]),
      _createElementVNode("div", _hoisted_18, [
        _cache[16] || (_cache[16] = _createElementVNode("div", { class: "flex min-w-0 flex-1 flex-col gap-1" }, [
          _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "超时时间"),
          _createElementVNode("span", { class: "text-[12px] text-muted" }, "等待模型响应的最长时间，单位：秒。")
        ], -1 /* CACHED */)),
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[8] || (_cache[8] = $event => (($setup.timeoutSeconds) = $event)),
          type: "number",
          min: "5",
          max: "300",
          step: "5",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper"
        }, null, 512 /* NEED_PATCH */), [
          [
            _vModelText,
            $setup.timeoutSeconds,
            void 0,
            { number: true }
          ]
        ])
      ])
    ]),
    _createCommentVNode(" 文档 Agent 执行参数：与上方连接/生成参数分开，专门控制长任务的轮数和总时长。 "),
    _createElementVNode("div", _hoisted_19, [
      _cache[20] || (_cache[20] = _createElementVNode("div", { class: "flex flex-col gap-1 px-5 pb-3 pt-4" }, [
        _createElementVNode("h4", { class: "text-[13px] font-semibold text-ink" }, "文档 Agent"),
        _createElementVNode("p", { class: "text-[12px] text-muted" }, "控制后台 Agent 处理文档的轮数与总时长，复杂任务请适当调大。")
      ], -1 /* CACHED */)),
      _createElementVNode("div", _hoisted_20, [
        _cache[18] || (_cache[18] = _createElementVNode("div", { class: "flex min-w-0 flex-1 flex-col gap-1" }, [
          _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "最大轮数"),
          _createElementVNode("span", { class: "text-[12px] text-muted" }, "Agent 最多执行的工具步骤数，越高越能处理复杂修改。")
        ], -1 /* CACHED */)),
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[9] || (_cache[9] = $event => (($setup.agentMaxSteps) = $event)),
          type: "number",
          min: "1",
          max: "100",
          step: "1",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper"
        }, null, 512 /* NEED_PATCH */), [
          [
            _vModelText,
            $setup.agentMaxSteps,
            void 0,
            { number: true }
          ]
        ])
      ]),
      _createElementVNode("div", _hoisted_21, [
        _cache[19] || (_cache[19] = _createElementVNode("div", { class: "flex min-w-0 flex-1 flex-col gap-1" }, [
          _createElementVNode("span", { class: "text-[13px] font-medium text-ink" }, "任务总时长"),
          _createElementVNode("span", { class: "text-[12px] text-muted" }, "整个 Agent 任务允许的最长时间，单位：分钟。")
        ], -1 /* CACHED */)),
        _withDirectives(_createElementVNode("input", {
          "onUpdate:modelValue": _cache[10] || (_cache[10] = $event => (($setup.agentTaskMinutes) = $event)),
          type: "number",
          min: "1",
          max: "120",
          step: "1",
          class: "flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper"
        }, null, 512 /* NEED_PATCH */), [
          [
            _vModelText,
            $setup.agentTaskMinutes,
            void 0,
            { number: true }
          ]
        ])
      ])
    ]),
    _createElementVNode("div", _hoisted_22, [
      _createCommentVNode(" 测试连接：把当前表单草稿发给主进程临时配置做 1 token 真实请求。 "),
      _createElementVNode("button", {
        type: "button",
        class: "flex h-9 items-center gap-2 rounded-md border border-line bg-paper px-4 text-[13px] font-medium text-secondary hover:border-accent hover:bg-selected hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        disabled: $setup.testing || $setup.saving,
        onClick: $setup.runConnectionTest
      }, [
        _createVNode($setup["Icon"], {
          icon: $setup.testing ? 'lucide:loader-circle' : 'lucide:plug-zap',
          size: 15
        }, null, 8 /* PROPS */, ["icon"]),
        _createTextVNode(" " + _toDisplayString($setup.testing ? '测试中…' : '测试连接'), 1 /* TEXT */)
      ], 8 /* PROPS */, _hoisted_23),
      _createCommentVNode(" 自动保存：表单停顿约 1 秒后整体提交，不覆盖用户正在编辑的中间态。 "),
      ($setup.isDirty && !$setup.message && !$setup.testResult)
        ? (_openBlock(), _createElementBlock("span", _hoisted_24, [...(_cache[21] || (_cache[21] = [
            _createElementVNode("span", { class: "h-1.5 w-1.5 rounded-full bg-accent" }, null, -1 /* CACHED */),
            _createTextVNode(" 更改将自动保存 ", -1 /* CACHED */)
          ]))]))
        : _createCommentVNode("v-if", true),
      _createElementVNode("button", {
        type: "button",
        class: "flex h-9 items-center rounded-md border border-line px-3 text-[12px] text-ink",
        disabled: $setup.saving || !$setup.isDirty,
        onClick: $setup.saveFromButton
      }, "立即保存", 8 /* PROPS */, _hoisted_25),
      ($setup.isDirty)
        ? (_openBlock(), _createElementBlock("button", {
            key: 1,
            type: "button",
            class: "flex h-9 items-center rounded-md px-2.5 text-[12px] text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
            disabled: $setup.saving,
            onClick: $setup.resetToSaved
          }, " 还原 ", 8 /* PROPS */, _hoisted_26))
        : _createCommentVNode("v-if", true),
      ($setup.message && !$setup.testResult)
        ? (_openBlock(), _createElementBlock("span", {
            key: 2,
            class: _normalizeClass(["text-[12px]", $setup.hasError ? 'text-danger' : 'text-secondary'])
          }, _toDisplayString($setup.message), 3 /* TEXT, CLASS */))
        : _createCommentVNode("v-if", true)
    ]),
    _createCommentVNode(" 测试结果面板：成功显示延迟和模型，失败显示具体的错误与排查建议。 "),
    ($setup.testResult)
      ? (_openBlock(), _createElementBlock("div", {
          key: 2,
          ref: "testResultRef",
          class: _normalizeClass(["flex flex-col gap-1.5 rounded-lg border px-4 py-3", $setup.testResult.ok ? 'border-[#46a758]/40 bg-[#46a758]/5' : 'border-danger/40 bg-danger/5'])
        }, [
          _createElementVNode("div", _hoisted_27, [
            _createVNode($setup["Icon"], {
              icon: $setup.testResult.ok ? 'lucide:check-circle-2' : 'lucide:x-circle',
              size: 16,
              class: _normalizeClass($setup.testResult.ok ? 'text-[#46a758]' : 'text-danger')
            }, null, 8 /* PROPS */, ["icon", "class"]),
            _createElementVNode("span", {
              class: _normalizeClass(["text-[13px] font-medium", $setup.testResult.ok ? 'text-[#2c7a3d]' : 'text-danger'])
            }, _toDisplayString($setup.testResult.ok ? '连接成功' : '连接失败'), 3 /* TEXT, CLASS */),
            _createElementVNode("span", _hoisted_28, _toDisplayString($setup.testResult.provider) + " · " + _toDisplayString($setup.testResult.model ||
          '（无模型名）'), 1 /* TEXT */)
          ]),
          ($setup.testResult.ok && $setup.testResult.latencyMs !== undefined)
            ? (_openBlock(), _createElementBlock("div", _hoisted_29, [
                _createTextVNode(" 端到端延迟 " + _toDisplayString($setup.testResult.latencyMs) + " ms ", 1 /* TEXT */),
                ($setup.testResult.sampleTokenCount)
                  ? (_openBlock(), _createElementBlock("span", _hoisted_30, "已收到模型响应"))
                  : _createCommentVNode("v-if", true)
              ]))
            : _createCommentVNode("v-if", true),
          (!$setup.testResult.ok)
            ? (_openBlock(), _createElementBlock("div", _hoisted_31, _toDisplayString($setup.testResult.error), 1 /* TEXT */))
            : _createCommentVNode("v-if", true)
        ], 2 /* CLASS */))
      : _createCommentVNode("v-if", true)
  ], 8 /* PROPS */, _hoisted_1))
}
Panel.render = render; export default Panel;