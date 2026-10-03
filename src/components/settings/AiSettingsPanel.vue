<template>
  <fieldset :disabled="saving || testing" class="flex min-w-0 flex-col gap-5 border-0 p-0">
    <SectionTitle title="AI 设置" description="管理多个模型连接，分别保存地址、密钥与模型。" />

    <!-- 按连接展示列表，当前连接同时用于聊天和文档助手。 -->
    <div class="flex flex-col gap-2 rounded-lg border border-line p-4">
      <!-- 删除操作跟随当前连接放在右上角，不再打断下方配置表单。 -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-2">
          <span class="text-[13px] font-semibold text-ink">模型连接</span>
          <p class="text-[12px] text-muted">点击选择当前连接，同一厂商可添加多个账号或服务地址。</p>
        </div>
        <button type="button" class="flex shrink-0 items-center rounded-md px-2 py-1 text-[12px] text-danger hover:bg-selected disabled:cursor-not-allowed disabled:opacity-50" :disabled="connectionOptions.length === 1" @click="removeConnection">删除此连接</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="connection in connectionOptions" :key="connection.value" type="button"
          class="flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
          :class="provider === connection.value ? 'border-accent bg-selected text-accent' : 'border-line text-secondary hover:bg-selected'"
          @click="provider = connection.value as AiProvider">
          {{ connection.label }}
          <span v-if="provider === connection.value" class="text-[11px]">当前使用</span>
        </button>
      </div>
      <!-- 添加入口收进连接区域，厂商模板和按钮在窄窗口中可以换行。 -->
      <div class="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <span class="text-[12px] text-muted">新建连接</span>
        <IconSelect v-model="newTemplate" :options="providerOptions" placeholder="选择厂商模板" />
        <button type="button" class="flex h-9 shrink-0 items-center rounded-md border border-line px-3 text-[13px] text-ink hover:bg-selected" @click="addConnection">添加连接</button>
      </div>
      <span v-if="connectionOptions.length === 1" class="text-[12px] text-muted">请先添加其他连接，再删除此连接。</span>
    </div>
    <SettingGroup title="连接名称" description="例如：工作账号、公司中转服务。">
      <input v-model="currentName" type="text" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent" placeholder="输入连接名称" />
    </SettingGroup>

    <SettingGroup title="模型名称" description="从列表选择或输入自定义模型名称，点击刷新获取可用模型。">
      <ModelSelector ref="modelSelectorRef" v-model="currentModel" v-model:customModels="currentCustomModels"
        placeholder="输入或选择模型" @fetch="onFetchModels" />
    </SettingGroup>

    <!-- 自定义模型直接展示在页面上，无需先清空输入框才能删除。 -->
    <div v-if="currentCustomModels.length" class="flex flex-col gap-2 rounded-lg border border-line p-4">
      <span class="text-[13px] font-medium text-ink">已添加的自定义模型</span>
      <div v-for="model in currentCustomModels" :key="model" class="flex items-center justify-between gap-3">
        <span class="min-w-0 break-all text-[13px] text-secondary">{{ model }}</span>
        <button type="button" class="flex shrink-0 rounded-md px-2 py-1 text-[12px] text-danger hover:bg-selected" @click="removeCustomModel(model)">删除</button>
      </div>
    </div>

    <SettingGroup title="API 地址" description="填写此连接的服务地址，厂商模板会填入官方地址。">
      <input v-model="currentBaseUrl" type="text" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent" :placeholder="baseUrlPlaceholder" />
    </SettingGroup>

    <SettingGroup v-if="currentTemplate !== 'ollama'" title="API Key" description="已配置的厂商显示掩码；聚焦后输入新值即可替换，留空保持原 Key。">
      <input :value="apiKeyDisplay" type="password" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent" placeholder="sk-..." autocomplete="off"
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
        <input v-model.number="temperature" type="number" min="0" max="2" step="0.1" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper" />
      </div>
      <div class="flex items-center justify-between gap-8 border-b border-line px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">单次请求输出预算</span>
          <span class="text-[12px] text-muted">单次生成的最大 token 数，过小可能导致长内容被截断。</span>
        </div>
        <input v-model.number="maxTokens" type="number" min="256" max="32768" step="256" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper" />
      </div>
      <div class="flex items-center justify-between gap-8 px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">超时时间</span>
          <span class="text-[12px] text-muted">等待模型响应的最长时间，单位：秒。</span>
        </div>
        <input v-model.number="timeoutSeconds" type="number" min="5" max="300" step="5" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper" />
      </div>
    </div>

    <!-- 文档 Agent 执行参数：与上方连接/生成参数分开，专门控制长任务的轮数和总时长。 -->
    <div class="flex flex-col rounded-lg border border-line bg-panel">
      <div class="flex flex-col gap-1 px-5 pb-3 pt-4">
        <h4 class="text-[13px] font-semibold text-ink">文档 Agent</h4>
        <p class="text-[12px] text-muted">控制后台 Agent 处理文档的轮数与总时长，复杂任务请适当调大。</p>
      </div>
      <div class="flex items-center justify-between gap-8 border-b border-line px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">最大轮数</span>
          <span class="text-[12px] text-muted">Agent 最多执行的工具步骤数，越高越能处理复杂修改。</span>
        </div>
        <input v-model.number="agentMaxSteps" type="number" min="1" max="100" step="1" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper" />
      </div>
      <div class="flex items-center justify-between gap-8 px-5 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-ink">任务总时长</span>
          <span class="text-[12px] text-muted">整个 Agent 任务允许的最长时间，单位：分钟。</span>
        </div>
        <input v-model.number="agentTaskMinutes" type="number" min="1" max="120" step="1" class="flex h-9 w-[200px] max-w-[420px] rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent !bg-paper" />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <!-- 测试连接：把当前表单草稿发给主进程临时配置做 1 token 真实请求。 -->
      <button type="button"
        class="flex h-9 items-center gap-2 rounded-md border border-line bg-paper px-4 text-[13px] font-medium text-secondary hover:border-accent hover:bg-selected hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="testing || saving" @click="runConnectionTest">
        <Icon :icon="testing ? 'lucide:loader-circle' : 'lucide:plug-zap'" :size="15"
           />
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
      <!-- 自动保存：表单停顿约 1 秒后整体提交，不覆盖用户正在编辑的中间态。 -->
      <span v-if="isDirty && !message && !testResult" class="flex items-center gap-1.5 text-[12px] text-accent">
        <span class="h-1.5 w-1.5 rounded-full bg-accent" />
        更改将自动保存
      </span>
      <button type="button" class="flex h-9 cursor-pointer items-center rounded-md border border-line px-3 text-[12px] text-ink hover:border-accent hover:bg-selected hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" :disabled="saving" @click="saveFromButton">{{ saving ? '保存中…' : '立即保存' }}</button>
      <button v-if="isDirty" type="button"
        class="flex h-9 items-center rounded-md px-2.5 text-[12px] text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="saving" @click="resetToSaved">
        还原
      </button>
      <span v-if="message" class="text-[12px]" :class="hasError ? 'text-danger' : 'text-secondary'">{{
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
      <div v-if="!testResult.ok" class="break-all text-[12px] leading-5 text-secondary">{{ testResult.error }}</div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useAiStatus } from '../../composables/useAiStatus'
import SectionTitle from './SectionTitle.vue'
import SettingGroup from './SettingGroup.vue'
import IconSelect from './IconSelect.vue'
import type { IconSelectOption } from './IconSelect.vue'
import ModelSelector from './ModelSelector.vue'
import { saveModelCatalog } from '../../services/aiModelCatalog'
import { aiService } from '../../services/aiService'
import { getApiKeyDisplay, prefillBaseUrls } from '../../utils/aiSettingsForm'
import { aiProviderTemplate } from '../../types/ai'
import type { AiProviderTemplate, AiProvider, AiProviderPublicConfig, AiSettingsInput, AiTestConnectionResult } from '../../types/ai'
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
    message.value = 'AI 设置已保存'
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

defineExpose({
  /** 当前是否有未保存的更改（供父级在切分区或关闭前决定是否落盘）。 */
  get isDirty() { return isDirty.value },
  /** 还原到最近一次保存的状态。 */
  resetToSaved,
  /** 立即落盘当前表单（若有改动）。 */
  flushNow,
})

onMounted(() => void load())
</script>
