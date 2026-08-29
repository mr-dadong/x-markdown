<template>
  <div v-show="settingsOpen" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-7"
    role="dialog" @mousedown.self="closeSettings">
    <section
      class="flex h-[min(680px,88vh)] w-[min(940px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <header class="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-inverse">
            <Icon icon="lucide:settings" :size="17" />
          </div>
          <div class="flex flex-col">
            <h2 class="text-[15px] font-semibold tracking-tight text-ink">设置</h2>
            <span class="text-[10px] text-muted">XMD 工作区偏好</span>
          </div>
        </div>
        <button type="button" title="关闭设置"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="closeSettings">
          <Icon icon="lucide:x" :size="18" />
        </button>
      </header>

      <div class="flex min-h-0 flex-1">
        <nav class="flex w-52 shrink-0 flex-col gap-2 border-r border-line bg-panel p-3">
          <span class="px-3 pb-2 pt-1 text-[10px] font-semibold tracking-[0.15em] text-muted">偏好设置</span>
          <button v-for="item in navigationItems" :key="item.id" type="button"
            class="flex h-10 items-center gap-3 rounded-md px-3 text-left text-[14px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            :class="activeSection === item.id ? 'bg-control-active text-ink' : 'text-secondary hover:bg-control-hover hover:text-ink'"
            @click="activeSection = item.id">
            <Icon :icon="item.icon" :size="16" />
            <span>{{ item.label }}</span>
          </button>
          <div class="mt-auto flex items-center gap-2 border-t border-line px-3 pt-3 text-[10px] text-muted">
            <span class="h-1.5 w-1.5 rounded-full bg-[#46a758]" />
            <span>设置自动保存</span>
          </div>
        </nav>

        <main class="editor-scroll flex min-w-0 flex-1 flex-col overflow-y-auto px-10 py-8">
          <template v-if="activeSection === 'general'">
            <SectionTitle title="通用" description="配置文档打开方式、资源位置和代码阅读体验。" />
            <SettingGroup title="默认编辑模式" description="打开文档时使用的默认视图。">
              <ChoiceControl v-model="settings.editorMode" :options="editorModeOptions" />
            </SettingGroup>
            <SettingGroup title="自动保存" description="停止输入一段时间后自动写入磁盘；未命名的新文档仍需手动选择保存位置。">
              <ToggleSwitch v-model="settings.autoSave" />
            </SettingGroup>
            <SettingGroup v-if="settings.autoSave" title="自动保存间隔" description="从停止输入到自动保存之间的等待时间。">
              <ChoiceControl v-model="autoSaveIntervalModel" :options="autoSaveIntervalOptions" />
            </SettingGroup>
            <SettingGroup title="显示功能菜单说明" description="在斜杠功能菜单中显示每个命令的辅助说明。">
              <ToggleSwitch v-model="settings.showSlashCommandDescriptions" />
            </SettingGroup>
            <SettingGroup title="插入文件方式" description="引用原文件不会产生副本；复制到 assets 时会在编辑区显示实时进度，完成后可随文档目录一起打包。">
              <ChoiceControl v-model="settings.attachmentHandling" :options="attachmentHandlingOptions" />
            </SettingGroup>
            <SettingGroup title="代码块内自动换行" description="较长的代码会在编辑区宽度内折行显示。">
              <ToggleSwitch v-model="settings.codeWrap" />
            </SettingGroup>
            <SettingGroup title="显示代码块内的行号" description="在每行代码左侧显示连续编号。">
              <ToggleSwitch v-model="settings.codeLineNumbers" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'typography'">
            <SectionTitle title="排版" description="调整编辑器的阅读体验：正文字号、字体、行宽与预览缩放。" />
            <SettingGroup title="正文字号" description="预览模式正文的基准字号，标题、列表等元素会按比例跟随缩放。">
              <ChoiceControl v-model="settings.bodyFontSize" :options="bodyFontSizeOptions" />
            </SettingGroup>
            <SettingGroup title="正文字体" description="预览模式正文使用的字体族，源码模式始终使用等宽字体。">
              <ChoiceControl v-model="settings.bodyFont" :options="bodyFontOptions" />
            </SettingGroup>
            <SettingGroup title="行宽" description="编辑区正文列的最大宽度；全宽时保留现有的左右边距。">
              <ChoiceControl v-model="settings.lineWidth" :options="lineWidthOptions" />
            </SettingGroup>
            <SettingGroup title="预览模式缩放" description="整体放大或缩小 Markdown 预览视图，源码模式不受影响。">
              <ChoiceControl v-model="settings.previewZoom" :options="previewZoomOptions" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'theme'">
            <SectionTitle title="主题" description="选择最适合当前环境的阅读配色。" />
            <SettingGroup title="配色" description="跟随系统会自动响应操作系统的外观变化。">
              <div class="flex gap-3">
                <button v-for="theme in themeOptions" :key="theme.value" type="button"
                  class="flex w-36 flex-col gap-3 rounded-lg border p-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  :class="settings.themeMode === theme.value ? 'border-accent bg-selected' : 'border-line bg-panel hover:border-muted'"
                  @click="settings.themeMode = theme.value">
                  <span class="flex h-16 w-full overflow-hidden rounded border border-line" :class="theme.preview">
                    <span class="flex h-full w-1/3 border-r border-current opacity-50" />
                    <span class="flex h-full flex-1 items-center justify-center">
                      <span class="h-1.5 w-8 rounded-full bg-current opacity-40" />
                    </span>
                  </span>
                  <span class="flex items-center justify-between text-[13px] font-medium text-ink">
                    {{ theme.label }}
                    <Icon v-if="settings.themeMode === theme.value" icon="lucide:check" :size="14" />
                  </span>
                </button>
              </div>
            </SettingGroup>
            <SettingGroup title="代码块样式" description="选择代码窗口与语法高亮的外观，修改后会立即应用。">
              <CodeBlockStylePicker v-model="settings.codeBlockStyle" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'shortcuts'">
            <!-- 下方列表已有完整边框，关闭标题分隔线，避免顶部出现重叠的细横线。 -->
            <SectionTitle title="快捷键" description="点击右侧按键组合，再直接按下新的组合键；退格或删除可清除。" :show-divider="false" />
            <div class="flex flex-col overflow-hidden rounded-lg border border-line">
              <div v-for="shortcut in shortcutItems" :key="shortcut.id"
                class="flex min-h-14 items-center justify-between gap-5 border-b border-line px-4 py-3 last:border-b-0">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[14px] font-medium text-ink">{{ shortcut.label }}</span>
                  <span class="text-[12px] leading-5 text-muted">{{ shortcut.description }}</span>
                </div>
                <ShortcutRecorder v-model="settings.shortcuts[shortcut.id]"
                  :conflict-label="conflictLabel(shortcut.id)" :validate="(value) => validateShortcut(shortcut.id, value)" />
              </div>
            </div>
            <button type="button"
              class="mt-4 flex h-9 w-fit items-center rounded-md border border-line px-3 text-[13px] text-secondary hover:bg-control-hover hover:text-ink"
              @click="resetShortcuts">
              恢复默认快捷键
            </button>
          </template>

          <template v-else-if="activeSection === 'ai'">
            <AiSettingsPanel />
          </template>

          <template v-else-if="activeSection === 'changelog'">
            <SectionTitle title="更新日志" description="查看 XMD 各版本的功能更新与改进。" :show-divider="false" />
            <div v-if="updateLogsLoading" class="flex flex-1 items-center justify-center py-16 text-[13px] text-muted">
              正在获取更新日志...
            </div>
            <div v-else-if="updateLogsError" class="flex flex-col items-center justify-center gap-4 py-16">
              <div class="flex flex-col items-center gap-1 text-center">
                <span class="text-[14px] font-medium text-ink">更新日志加载失败</span>
                <span class="text-[12px] text-muted">{{ updateLogsError }}</span>
              </div>
              <button type="button"
                class="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[13px] font-medium text-secondary hover:bg-control-hover hover:text-ink"
                @click="loadUpdateLogs">
                <Icon icon="lucide:refresh-cw" :size="13" />
                重新加载
              </button>
            </div>
            <div v-else class="flex flex-col gap-4">
              <article v-for="log in updateLogs" :key="log.version"
                class="flex flex-col gap-5 rounded-lg border border-line bg-panel p-5">
                <div class="flex items-center justify-between gap-5">
                  <div class="flex min-w-0 items-center gap-3">
                    <span
                      class="flex h-6 shrink-0 items-center rounded-full bg-selected px-2.5 font-mono text-[10px] font-semibold tracking-wide text-accent">
                      V{{ log.version }}
                    </span>
                    <h3 class="truncate text-[16px] font-semibold tracking-tight text-ink">{{ log.title }}</h3>
                  </div>
                  <time class="shrink-0 text-[11px] font-medium text-muted">{{ log.date }}</time>
                </div>
                <div class="flex flex-col gap-2.5 border-t border-line pt-4">
                  <div v-for="item in log.content" :key="item" class="flex items-start gap-3">
                    <span class="mt-[9px] flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span class="text-[13px] leading-6 text-secondary">{{ item }}</span>
                  </div>
                </div>
              </article>
            </div>
          </template>

          <template v-else>
            <SectionTitle title="关于 XMD" description="专注、本地优先的 Markdown 写作工具。" />
            <div class="flex items-center gap-4 rounded-lg border border-line bg-panel p-5">
              <img :src="appIcon" alt="XMD" class="h-16 w-16 rounded-xl" />
              <div class="flex flex-col gap-1">
                <strong class="text-[18px] tracking-tight text-ink">XMD</strong>
                <span class="text-[13px] text-muted">让 Markdown 写作回归内容本身</span>
                <span class="text-[12px] text-muted">作者：{{ appAuthor }}</span>
              </div>
              <span
                class="ml-auto rounded border border-line bg-paper px-2 py-1 font-mono text-[10px] text-muted">v{{ appVersion }}</span>
            </div>
            <!-- 项目简介采用纵向阅读顺序，避免短标题与长正文被挤成不均衡的多列。 -->
            <div class="flex flex-col gap-2 border-b border-line py-5">
              <h4 class="text-[14px] font-semibold text-ink">项目简介</h4>
              <p class="text-[12px] leading-5 text-muted">文档始终保存在本地。</p>
              <p class="max-w-2xl text-[13px] leading-6 text-secondary">
                轻量编辑、源码模式、项目大纲与代码高亮，都被收纳在同一个安静的工作区中。
              </p>
            </div>
            <SettingGroup title="检测更新" :description="checkMessage || '手动检查 XMD 是否有可用的新版本。'">
              <button type="button"
                class="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[13px] font-medium text-secondary hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="isChecking" @click="checkForUpdates(true)">
                <Icon icon="lucide:refresh-cw" :size="13" />
                {{ isChecking ? '正在检查…' : '检查更新' }}
              </button>
            </SettingGroup>
          </template>
        </main>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useSettings, type SettingsSection } from '../composables/useSettings'
import { useUpdater } from '../composables/useUpdater'
import { SHORTCUT_DEFINITIONS, type ShortcutId } from '../constants/shortcuts'
import type { UpdateLog } from '../types/update'
import ChoiceControl from './settings/ChoiceControl.vue'
import AiSettingsPanel from './settings/AiSettingsPanel.vue'
import CodeBlockStylePicker from './settings/CodeBlockStylePicker.vue'
import SectionTitle from './settings/SectionTitle.vue'
import SettingGroup from './settings/SettingGroup.vue'
import ShortcutRecorder from './settings/ShortcutRecorder.vue'
import ToggleSwitch from './settings/ToggleSwitch.vue'
import appIcon from '../../build/icons/256x256.png'
import packageInfo from '../../package.json'
import { updateService } from '../services/updateService'
import { overlayState } from '../modules/overlayState'

const settingsOpen = overlayState.settingsOpen
const settingsSection = overlayState.settingsSection

const closeSettings = (): void => {
  settingsOpen.value = false
  settingsSection.value = 'general'
}

// 版本号和作者统一读取 package.json，发布时只需维护一处即可。
const appVersion = packageInfo.version
const appAuthor = packageInfo.author
const { settings, resetShortcuts } = useSettings()
const { isChecking, checkMessage, checkForUpdates } = useUpdater()
const activeSection = ref<SettingsSection>(settingsSection.value)

// 设置页常驻挂载以避免生产环境首次动态创建时错过呈现；每次打开前同步目标分区。
watch(settingsOpen, (open) => {
  if (open) activeSection.value = settingsSection.value
})

const updateLogs = ref<UpdateLog[]>([])
const updateLogsLoading = ref(false)
const updateLogsError = ref('')

const navigationItems = [
  { id: 'general' as const, label: '通用', icon: 'lucide:sliders-horizontal' },
  { id: 'typography' as const, label: '排版', icon: 'lucide:type' },
  { id: 'theme' as const, label: '主题', icon: 'lucide:palette' },
  { id: 'shortcuts' as const, label: '快捷键', icon: 'lucide:keyboard' },
  { id: 'ai' as const, label: 'AI', icon: 'lucide:sparkles' },
  { id: 'changelog' as const, label: '更新日志', icon: 'lucide:history' },
  { id: 'about' as const, label: '关于', icon: 'lucide:info' },
]

const loadUpdateLogs = async (): Promise<void> => {
  updateLogsLoading.value = true
  updateLogsError.value = ''

  const result = await updateService.getLogs()
  if (!result.success || !result.releases) {
    updateLogsError.value = result.error || '版本信息内容为空'
    updateLogsLoading.value = false
    return
  }

  updateLogs.value = result.releases
  updateLogsLoading.value = false
}

watch(activeSection, (section) => {
  if (section === 'changelog' && updateLogs.value.length === 0 && !updateLogsLoading.value) {
    void loadUpdateLogs()
  }
})
const editorModeOptions = [
  { value: 'preview', label: 'MD 预览' },
  { value: 'source', label: '源码展示' },
]
const attachmentHandlingOptions = [
  { value: 'reference', label: '引用原文件' },
  { value: 'copy-to-assets', label: '复制到 assets' },
]
const autoSaveIntervalOptions = [
  { value: '1', label: '1 秒' },
  { value: '3', label: '3 秒' },
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
  { value: '30', label: '30 秒' },
]
const bodyFontSizeOptions = [
  { value: '14', label: '14 px' },
  { value: '15', label: '15 px' },
  { value: '16', label: '16 px' },
  { value: '17', label: '17 px' },
  { value: '18', label: '18 px' },
]
const bodyFontOptions = [
  { value: 'system', label: '系统默认' },
  { value: 'serif', label: '衬线' },
  { value: 'sans', label: '无衬线' },
  { value: 'mono', label: '等宽' },
]
const lineWidthOptions = [
  { value: 'narrow', label: '窄' },
  { value: 'medium', label: '中' },
  { value: 'wide', label: '宽' },
  { value: 'full', label: '全宽' },
]
const previewZoomOptions = [
  { value: 'small', label: '小' },
  { value: 'standard', label: '标准' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '特大' },
]
// ChoiceControl 只接受字符串值，设置内部仍以数字保存间隔，便于直接换算成毫秒。
const autoSaveIntervalModel = computed({
  get: () => String(settings.autoSaveInterval),
  set: (value: string) => {
    settings.autoSaveInterval = Number(value)
  },
})
const themeOptions = [
  { value: 'system' as const, label: '跟随系统', preview: 'bg-[#e9e9e9] text-[#333333]' },
  { value: 'light' as const, label: '浅色', preview: 'bg-[#ffffff] text-[#222222]' },
  { value: 'dark' as const, label: '深色', preview: 'bg-[#26272b] text-[#e4e6eb]' },
]
const shortcutItems = SHORTCUT_DEFINITIONS

// 保留给系统功能（查找、导出、窗口等）的组合，不允许用户占用。
const RESERVED_SHORTCUTS = [
  'F3', 'Escape', 'Esc',
  'Ctrl+F', 'Cmd+F',
  'Ctrl+Shift+E', 'Cmd+Shift+E',
  'Ctrl+Shift+Z', 'Cmd+Shift+Z',
  'Ctrl+Z', 'Cmd+Z', 'Ctrl+X', 'Cmd+X', 'Ctrl+C', 'Cmd+C',
  'Ctrl+V', 'Cmd+V', 'Ctrl+A', 'Cmd+A',
  'Ctrl+R', 'Cmd+R', 'Ctrl+0', 'Cmd+0', 'F11',
  'Ctrl+M', 'Cmd+M', 'Ctrl+W', 'Cmd+W', 'Ctrl+Q', 'Cmd+Q',
]

// 当前值若与其它动作重复，返回对方名称用于行内提示。
const conflictLabel = (id: ShortcutId): string => {
  const value = settings.shortcuts[id]
  if (!value) return ''
  const other = SHORTCUT_DEFINITIONS.find(
    (item) => item.id !== id && settings.shortcuts[item.id] === value,
  )
  return other ? other.label : ''
}

// 录制到新组合后提交前校验：重复或占用系统功能时拒绝。
const validateShortcut = (id: ShortcutId, value: string): string | null => {
  if (!value) return null
  const other = SHORTCUT_DEFINITIONS.find(
    (item) => item.id !== id && settings.shortcuts[item.id] === value,
  )
  if (other) return `该组合已分配给「${other.label}」`
  if (RESERVED_SHORTCUTS.includes(value)) return '该组合被系统功能占用，请换一个'
  return null
}

// Esc 关闭设置页；快捷键录制中由录制器先行消费，不会走到这里。
const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (settingsOpen.value && event.key === 'Escape') closeSettings()
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>
