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
            <h2 class="text-[15px] font-semibold tracking-tight text-ink">{{ t('settings.title') }}</h2>
            <span class="text-[10px] text-muted">{{ t('settings.subtitle') }}</span>
          </div>
        </div>
        <button type="button" :title="t('settings.closeTitle')"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="closeSettings">
          <Icon icon="lucide:x" :size="18" />
        </button>
      </header>

      <div class="flex min-h-0 flex-1">
        <nav class="flex w-52 shrink-0 flex-col gap-2 border-r border-line bg-panel p-3">
          <span class="px-3 pb-2 pt-1 text-[10px] font-semibold tracking-[0.15em] text-muted">{{ t('settings.preferences') }}</span>
          <button v-for="item in navigationItems" :key="item.id" type="button"
            class="flex h-10 items-center gap-3 rounded-md px-3 text-left text-[14px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            :class="activeSection === item.id ? 'bg-control-active text-ink' : 'text-secondary hover:bg-control-hover hover:text-ink'"
            @click="tryChangeSection(item.id)">
            <Icon :icon="item.icon" :size="16" />
            <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span>{{ item.label }}</span>
              <span v-if="item.id === 'ai' && aiPanelRef?.isDirty"
                class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                :title="t('settings.aiUnsaved')" />
            </span>
          </button>
          <div class="mt-auto flex items-center gap-2 border-t border-line px-3 pt-3 text-[10px] text-muted">
            <span class="h-1.5 w-1.5 rounded-full bg-[#46a758]" />
            <span>{{ t('settings.autoSaveBadge') }}</span>
          </div>
        </nav>

        <main class="editor-scroll flex min-w-0 flex-1 flex-col overflow-y-auto px-10 py-8">
          <template v-if="activeSection === 'general'">
            <SectionTitle :title="t('settings.general.title')" :description="t('settings.general.description')" />
            <SettingGroup :title="t('settings.language.title')" :description="t('settings.language.description')">
              <ChoiceControl :model-value="settings.language" :options="languageOptions"
                @update:model-value="changeLanguage" />
            </SettingGroup>
            <SettingGroup :title="t('settings.editorMode.title')" :description="t('settings.editorMode.description')">
              <ChoiceControl v-model="settings.editorMode" :options="editorModeOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.autoSave.title')" :description="t('settings.autoSave.description')">
              <ToggleSwitch v-model="settings.autoSave" />
            </SettingGroup>
            <SettingGroup v-if="settings.autoSave" :title="t('settings.autoSaveInterval.title')" :description="t('settings.autoSaveInterval.description')">
              <ChoiceControl v-model="autoSaveIntervalModel" :options="autoSaveIntervalOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.slashHints.title')" :description="t('settings.slashHints.description')">
              <ToggleSwitch v-model="settings.showSlashCommandDescriptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.attachment.title')" :description="t('settings.attachment.description')">
              <ChoiceControl v-model="settings.attachmentHandling" :options="attachmentHandlingOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.codeWrap.title')" :description="t('settings.codeWrap.description')">
              <ToggleSwitch v-model="settings.codeWrap" />
            </SettingGroup>
            <SettingGroup :title="t('settings.codeLineNumbers.title')" :description="t('settings.codeLineNumbers.description')">
              <ToggleSwitch v-model="settings.codeLineNumbers" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'typography'">
            <SectionTitle :title="t('settings.typography.title')" :description="t('settings.typography.description')" />
            <SettingGroup :title="t('settings.fontSize.title')" :description="t('settings.fontSize.description')">
              <ChoiceControl v-model="settings.bodyFontSize" :options="bodyFontSizeOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.fontFamily.title')" :description="t('settings.fontFamily.description')">
              <ChoiceControl v-model="settings.bodyFont" :options="bodyFontOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.lineWidth.title')" :description="t('settings.lineWidth.description')">
              <ChoiceControl v-model="settings.lineWidth" :options="lineWidthOptions" />
            </SettingGroup>
            <SettingGroup :title="t('settings.previewZoom.title')" :description="t('settings.previewZoom.description')">
              <ChoiceControl v-model="settings.previewZoom" :options="previewZoomOptions" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'theme'">
            <SectionTitle :title="t('settings.theme.title')" :description="t('settings.theme.description')" />
            <SettingGroup :title="t('settings.palette.title')" :description="t('settings.palette.description')">
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
            <SettingGroup :title="t('settings.codeBlockStyle.title')" :description="t('settings.codeBlockStyle.description')">
              <CodeBlockStylePicker v-model="settings.codeBlockStyle" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'export'">
            <SectionTitle :title="t('settings.export.title')" :description="t('settings.export.description')" />
            <SettingGroup :title="t('settings.pageSize.title')" :description="t('settings.pageSize.description')">
              <ChoiceControl v-model="settings.pdfPageSize" :options="pdfPageSizeOptions" />
              <div v-if="settings.pdfPageSize === 'custom'" class="mt-3 flex items-center gap-2">
                <input v-model.number="settings.pdfPageWidth" type="number" min="1" max="200" step="0.01"
                  class="h-8 w-24 rounded-md border border-line bg-paper px-2 text-[13px] text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent" />
                <span class="text-[12px] text-muted">×</span>
                <input v-model.number="settings.pdfPageHeight" type="number" min="1" max="200" step="0.01"
                  class="h-8 w-24 rounded-md border border-line bg-paper px-2 text-[13px] text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent" />
                <span class="text-[12px] text-muted">{{ t('settings.inches') }}</span>
              </div>
            </SettingGroup>
            <SettingGroup :title="t('settings.margin.title')" :description="t('settings.margin.description')">
              <input v-model.number="settings.pdfMargin" type="number" min="0" max="20" step="0.05"
                class="h-8 w-24 rounded-md border border-line bg-paper px-2 text-[13px] text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent" />
            </SettingGroup>
            <SettingGroup :title="t('settings.headerFooter.title')" :description="t('settings.headerFooter.description')">
              <div class="flex flex-col gap-2">
                <input v-model="settings.pdfHeaderText" type="text" :placeholder="t('settings.headerPlaceholder')"
                  class="h-8 w-full rounded-md border border-line bg-paper px-2 text-[13px] text-ink placeholder:text-placeholder focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent" />
                <input v-model="settings.pdfFooterText" type="text" :placeholder="t('settings.footerPlaceholder')"
                  class="h-8 w-full rounded-md border border-line bg-paper px-2 text-[13px] text-ink placeholder:text-placeholder focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent" />
              </div>
            </SettingGroup>
            <SettingGroup :title="t('settings.breakH1.title')" :description="t('settings.breakH1.description')">
              <ToggleSwitch v-model="settings.pdfBreakBetweenH1" />
            </SettingGroup>
          </template>

          <template v-else-if="activeSection === 'shortcuts'">
            <!-- 下方列表已有完整边框，关闭标题分隔线，避免顶部出现重叠的细横线。 -->
            <SectionTitle :title="t('settings.shortcuts.title')" :description="t('settings.shortcuts.description')" :show-divider="false" />
            <div class="flex flex-col overflow-hidden rounded-lg border border-line">
              <div v-for="shortcut in shortcutItems" :key="shortcut.id"
                class="flex min-h-14 items-center justify-between gap-5 border-b border-line px-4 py-3 last:border-b-0">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[14px] font-medium text-ink">{{ t(shortcut.labelKey) }}</span>
                  <span class="text-[12px] leading-5 text-muted">{{ t(shortcut.descriptionKey) }}</span>
                </div>
                <ShortcutRecorder v-model="settings.shortcuts[shortcut.id]"
                  :conflict-label="conflictLabel(shortcut.id)" :validate="(value) => validateShortcut(shortcut.id, value)" />
              </div>
            </div>
            <button type="button"
              class="mt-4 flex h-9 w-fit items-center rounded-md border border-line px-3 text-[13px] text-secondary hover:bg-control-hover hover:text-ink"
              @click="resetShortcuts">
              {{ t('settings.shortcuts.reset') }}
            </button>
          </template>

          <template v-else-if="activeSection === 'ai'">
            <AiSettingsPanel ref="aiPanelRef" />
          </template>

          <template v-else-if="activeSection === 'changelog'">
            <div class="flex min-h-0 flex-1 flex-col">
              <SectionTitle :title="t('settings.changelog.title')" :description="t('settings.changelog.description')" :show-divider="false" />
              <div v-if="updateLogsLoading" class="flex flex-1 items-center justify-center py-16 text-[13px] text-muted">
                {{ t('settings.changelog.loading') }}
              </div>
              <div v-else-if="updateLogsError" class="flex flex-col items-center justify-center gap-4 py-16">
                <div class="flex flex-col items-center gap-1 text-center">
                  <span class="text-[14px] font-medium text-ink">{{ t('settings.changelog.failed') }}</span>
                  <span class="text-[12px] text-muted">{{ updateLogsError }}</span>
                </div>
                <button type="button"
                  class="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[13px] font-medium text-secondary hover:bg-control-hover hover:text-ink"
                  @click="loadUpdateLogs">
                  <Icon icon="lucide:refresh-cw" :size="13" />
                  {{ t('externalChange.reload') }}
                </button>
              </div>
              <!-- 懒加载列表：默认只渲染前 20 条，滚动接近底部时再追加一页 -->
              <div v-else ref="changelogScrollRef"
                class="editor-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1" @scroll="handleChangelogScroll">
                <article v-for="log in visibleUpdateLogs" :key="log.version"
                  class="flex flex-col gap-5 rounded-lg border border-line bg-panel p-5">
                  <div class="flex items-center justify-between gap-5">
                    <div class="flex min-w-0 items-center gap-3">
                      <span
                        class="flex h-6 shrink-0 items-center rounded-full bg-selected px-2.5 font-mono text-[10px] font-semibold tracking-wide text-accent">
                        V{{ log.version }}
                      </span>
                      <h3 class="truncate text-[16px] font-semibold tracking-tight text-ink">{{ releaseNotesFor(log).title }}</h3>
                      <span v-if="releaseNotesFor(log).untranslated" class="shrink-0 text-[11px] text-muted">
                        {{ t('update.chineseOnly') }}
                      </span>
                    </div>
                    <time class="shrink-0 text-[11px] font-medium text-muted">{{ log.date }}</time>
                  </div>
                  <div class="flex flex-col gap-2.5 border-t border-line pt-4">
                    <div v-for="item in releaseNotesFor(log).content" :key="item" class="flex items-start gap-3">
                      <span class="mt-[9px] flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span class="text-[13px] leading-6 text-secondary">{{ item }}</span>
                    </div>
                  </div>
                </article>
                <!-- 列表底部状态：追加中、还有更多或已全部加载 -->
                <div class="flex items-center justify-center py-3 text-[12px] text-muted">
                  <span v-if="changelogLoadingMore">{{ t('settings.changelog.loadingMore') }}</span>
                  <span v-else-if="updateLogs.length === 0">{{ t('settings.changelog.empty') }}</span>
                  <span v-else-if="changelogAllLoaded">{{ t('settings.changelog.allLoaded', { count: updateLogs.length }) }}</span>
                  <span v-else>{{ t('settings.changelog.scrollMore') }}</span>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <SectionTitle :title="t('settings.about.title')" :description="t('settings.about.description')" />
            <div class="flex items-center gap-4 rounded-lg border border-line bg-panel p-5">
              <img :src="appIcon" alt="XMD" class="h-16 w-16 rounded-xl" />
              <div class="flex flex-col gap-1">
                <strong class="text-[18px] tracking-tight text-ink">XMD</strong>
                <span class="text-[13px] text-muted">{{ t('settings.about.tagline') }}</span>
                <span class="text-[12px] text-muted">{{ t('settings.about.author', { author: appAuthor }) }}</span>
              </div>
              <span
                class="ml-auto rounded border border-line bg-paper px-2 py-1 font-mono text-[10px] text-muted">v{{ appVersion }}</span>
            </div>
            <!-- 项目简介采用纵向阅读顺序，避免短标题与长正文被挤成不均衡的多列。 -->
            <div class="flex flex-col gap-2 border-b border-line py-5">
              <h4 class="text-[14px] font-semibold text-ink">{{ t('settings.about.intro') }}</h4>
              <p class="text-[12px] leading-5 text-muted">{{ t('settings.about.local') }}</p>
              <p class="max-w-2xl text-[13px] leading-6 text-secondary">
                {{ t('settings.about.summary') }}
              </p>
            </div>
            <SettingGroup :title="t('settings.update.title')" :description="checkMessage || t('settings.update.description')">
              <button type="button"
                class="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[13px] font-medium text-secondary hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="isChecking" @click="checkForUpdates(true)">
                <Icon icon="lucide:refresh-cw" :size="13" />
                {{ isChecking ? t('settings.update.checking') : t('settings.update.check') }}
              </button>
            </SettingGroup>
          </template>
        </main>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useSettings, type SettingsSection } from '../composables/useSettings'
import { locale, setLanguagePreference, t } from '../composables/useI18n'
import { resolveReleaseNotes } from '../utils/releaseNotes'
import { isLanguagePreference } from '../i18n/locale'
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
import type { PdfPageSize } from '../utils/pdfOptions'
import { overlayState } from '../modules/overlayState'

const settingsOpen = overlayState.settingsOpen
const settingsSection = overlayState.settingsSection

// AI 配置在无操作约 1 秒后自动保存；关闭设置前先立即落盘最后一批编辑，避免停顿窗口未结束就离开导致丢失。
const aiPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)

const closeSettings = async (): Promise<void> => {
  // 关闭前把尚未触发的自动保存立即落盘（无改动时是空操作）。
  await aiPanelRef.value?.flushNow()
  settingsOpen.value = false
  settingsSection.value = 'general'
}

// 版本号和作者统一读取 package.json，发布时只需维护一处即可。
const appVersion = packageInfo.version
const appAuthor = packageInfo.author
const { settings, resetShortcuts } = useSettings()
const { isChecking, checkMessage, checkForUpdates } = useUpdater()
const activeSection = ref<SettingsSection>(settingsSection.value)

// 语言选项在每次渲染时取词表，切换语言后选项文案随之更新。
const languageOptions = computed(() => [
  { value: 'system', label: t('settings.language.system') },
  { value: 'zh-CN', label: t('settings.language.zhCN') },
  { value: 'en', label: t('settings.language.en') },
])

// ChoiceControl 只传出字符串，这里收敛到受支持的偏好值再写入设置。
const changeLanguage = (value: string): void => {
  if (isLanguagePreference(value)) setLanguagePreference(value)
}

// 设置页常驻挂载以避免生产环境首次动态创建时错过呈现；每次打开前同步目标分区。
watch(settingsOpen, (open) => {
  if (open) activeSection.value = settingsSection.value
})

const updateLogs = ref<UpdateLog[]>([])
const updateLogsLoading = ref(false)
const updateLogsError = ref('')

// 更新日志懒加载：默认只渲染 20 条，滚动接近底部时再追加一页。
const CHANGELOG_PAGE_SIZE = 20
const changelogScrollRef = ref<HTMLElement | null>(null)
const visibleLogCount = ref(CHANGELOG_PAGE_SIZE)
// 追加页的锁：同一轮滚动只追加一次，等新增条目渲染完成后再解锁。
const changelogLoadingMore = ref(false)
const visibleUpdateLogs = computed(() => updateLogs.value.slice(0, visibleLogCount.value))
const changelogAllLoaded = computed(() => visibleLogCount.value >= updateLogs.value.length)

const loadMoreLogs = (): void => {
  if (changelogLoadingMore.value || changelogAllLoaded.value) return
  changelogLoadingMore.value = true
  visibleLogCount.value = Math.min(
    visibleLogCount.value + CHANGELOG_PAGE_SIZE,
    updateLogs.value.length,
  )
  // 等本轮新增条目渲染完成后再解锁，避免快速滚动到底时一次跳过多个分页。
  void nextTick(() => {
    changelogLoadingMore.value = false
  })
}

// 滚动接近列表底部（剩余高度不足 80px）时触发下一页加载。
const handleChangelogScroll = (): void => {
  const el = changelogScrollRef.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadMoreLogs()
  }
}

const navigationItems = computed(() => [
  { id: 'general' as const, label: t('settings.nav.general'), icon: 'lucide:sliders-horizontal' },
  { id: 'typography' as const, label: t('settings.nav.typography'), icon: 'lucide:type' },
  { id: 'theme' as const, label: t('settings.nav.theme'), icon: 'lucide:palette' },
  // 图标必须是 src/icons.ts 里注册过的离线图标，否则 Icon 会退化成匿名组件并告警。
  { id: 'export' as const, label: t('settings.nav.export'), icon: 'lucide:download' },
  { id: 'shortcuts' as const, label: t('settings.nav.shortcuts'), icon: 'lucide:keyboard' },
  { id: 'ai' as const, label: 'AI', icon: 'lucide:sparkles' },
  { id: 'changelog' as const, label: t('settings.nav.changelog'), icon: 'lucide:history' },
  { id: 'about' as const, label: t('settings.nav.about'), icon: 'lucide:info' },
])

const loadUpdateLogs = async (): Promise<void> => {
  updateLogsLoading.value = true
  updateLogsError.value = ''

  const result = await updateService.getLogs()
  if (!result.success || !result.releases) {
    updateLogsError.value = result.error || t('settings.changelog.emptyError')
    updateLogsLoading.value = false
    return
  }

  updateLogs.value = result.releases
  // 重新加载后回到第一页，保证默认只渲染 20 条。
  visibleLogCount.value = CHANGELOG_PAGE_SIZE
  updateLogsLoading.value = false
}

watch(activeSection, (section) => {
  // 每次进入更新日志分区都从第一页开始渲染，保持默认 20 条的懒加载体验。
  if (section === 'changelog') visibleLogCount.value = CHANGELOG_PAGE_SIZE
  if (section === 'changelog' && updateLogs.value.length === 0 && !updateLogsLoading.value) {
    void loadUpdateLogs()
  }
})

// 离开 AI 分区前先立即落盘尚未触发的自动保存，避免停顿窗口未结束就切换导致丢失。
const tryChangeSection = async (section: SettingsSection): Promise<void> => {
  if (activeSection.value === 'ai' && section !== 'ai') {
    await aiPanelRef.value?.flushNow()
  }
  activeSection.value = section
}
const editorModeOptions = computed(() => [
  { value: 'preview', label: t('settings.option.preview') },
  { value: 'source', label: t('settings.option.source') },
])
const attachmentHandlingOptions = computed(() => [
  { value: 'reference', label: t('settings.option.reference') },
  { value: 'copy-to-assets', label: t('settings.option.copyAssets') },
])
const autoSaveIntervalOptions = computed(() => ['1', '3', '5', '10', '30'].map((value) => ({
  value,
  label: t('settings.option.seconds', { count: value }),
})))
const bodyFontSizeOptions = [
  { value: '14', label: '14 px' },
  { value: '15', label: '15 px' },
  { value: '16', label: '16 px' },
  { value: '17', label: '17 px' },
  { value: '18', label: '18 px' },
]
const bodyFontOptions = computed(() => [
  { value: 'system', label: t('settings.option.systemFont') },
  { value: 'serif', label: t('settings.option.serif') },
  { value: 'sans', label: t('settings.option.sans') },
  { value: 'mono', label: t('settings.option.mono') },
])
const lineWidthOptions = computed(() => [
  { value: 'narrow', label: t('settings.option.narrow') },
  { value: 'medium', label: t('settings.option.medium') },
  { value: 'wide', label: t('settings.option.wide') },
  { value: 'full', label: t('settings.option.full') },
])
const previewZoomOptions = computed(() => [
  { value: 'small', label: t('settings.option.small') },
  { value: 'standard', label: t('settings.option.standard') },
  { value: 'large', label: t('settings.option.large') },
  { value: 'xlarge', label: t('settings.option.xlarge') },
])
// 纸张按打印常见规格给出，其余尺寸走「自定义」。
const pdfPageSizeOptions = computed<{ value: PdfPageSize; label: string }[]>(() => [
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
  { value: 'Letter', label: 'Letter' },
  { value: 'Legal', label: 'Legal' },
  { value: 'custom', label: t('settings.option.custom') },
])
// ChoiceControl 只接受字符串值，设置内部仍以数字保存间隔，便于直接换算成毫秒。
const autoSaveIntervalModel = computed({
  get: () => String(settings.autoSaveInterval),
  set: (value: string) => {
    settings.autoSaveInterval = Number(value)
  },
})
const themeOptions = computed(() => [
  { value: 'system' as const, label: t('settings.theme.followSystem'), preview: 'bg-[#e9e9e9] text-[#333333]' },
  { value: 'light' as const, label: t('settings.theme.light'), preview: 'bg-[#ffffff] text-[#222222]' },
  { value: 'dark' as const, label: t('settings.theme.dark'), preview: 'bg-[#26272b] text-[#e4e6eb]' },
])
const shortcutItems = SHORTCUT_DEFINITIONS

// 更新日志按当前界面语言选择中文或英文，远程数据缺英文时标记为未翻译。
const releaseNotesFor = (log: UpdateLog) => resolveReleaseNotes(log, locale.value)

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
  return other ? t(other.labelKey) : ''
}

// 录制到新组合后提交前校验：重复或占用系统功能时拒绝。
const validateShortcut = (id: ShortcutId, value: string): string | null => {
  if (!value) return null
  const other = SHORTCUT_DEFINITIONS.find(
    (item) => item.id !== id && settings.shortcuts[item.id] === value,
  )
  if (other) return t('settings.shortcuts.conflict', { label: t(other.labelKey) })
  if (RESERVED_SHORTCUTS.includes(value)) return t('settings.shortcuts.reserved')
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
