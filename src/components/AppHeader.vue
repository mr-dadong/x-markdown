<template>
  <header class="app-drag flex h-10 shrink-0 items-center justify-between border-b pl-2 text-[13px] select-none"
    :class="isDarkTheme ? 'border-line bg-toolbar text-ink' : 'border-[#dddddb] bg-[#f4f4f3] text-[#292929]'">
    <div class="flex min-w-0 items-center">
      <!-- 标题栏只保留应用级标识和菜单，当前文件信息由下方文档栏承载。 -->
      <div class="app-drag flex h-7 w-8 shrink-0 items-center justify-center">
        <img src="@/assets/icon.png" alt="XMD" class="h-5 w-5" />
      </div>
      <nav class="app-no-drag flex h-full items-center" title="应用菜单">
        <button v-for="(menu, index) in menus" :key="menu" type="button"
          class="flex h-7 items-center rounded px-2 text-[13px] font-normal focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          :class="activeMenuIndex === index
            ? (isDarkTheme ? 'bg-control-active text-ink' : 'bg-[#e8e8e6] text-[#292929]')
            : (isDarkTheme ? 'bg-transparent text-ink hover:bg-control-hover' : 'bg-transparent text-[#292929] hover:bg-[#e8e8e6]')"
          @click="openMenu(index, $event)">
          {{ menu }}
        </button>
      </nav>
    </div>

    <div class="app-no-drag flex h-full shrink-0 items-center gap-0.5">
      <button v-if="hasUpdate" type="button" title="查看可用更新"
        class="flex h-7 w-8 items-center justify-center rounded bg-transparent text-[#2f9e44] hover:bg-[#dff3e4] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click="emit('open-update')">
        <Icon icon="lucide:refresh-cw" :size="18" />
      </button>
      <button type="button"
        class="flex h-7 w-8 items-center justify-center rounded bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
        :class="isDarkTheme ? 'text-icon hover:bg-control-hover hover:text-ink' : 'text-[#666666] hover:bg-[#e8e8e6] hover:text-[#292929]'"
        :title="isDarkTheme ? '切换到白天主题' : '切换到夜晚主题'" @click="emit('toggle-theme')">
        <Icon :icon="isDarkTheme ? 'lucide:sun' : 'lucide:moon'" :size="19" />
      </button>
      <button type="button"
        class="flex h-7 w-8 items-center justify-center rounded bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
        :class="isDarkTheme ? 'text-icon hover:bg-control-hover hover:text-ink' : 'text-[#666666] hover:bg-[#e8e8e6] hover:text-[#292929]'"
        :title="`设置 (${settings.shortcuts.openSettings || '未设置'})`" @click="emit('open-settings')">
        <Icon icon="lucide:settings" :size="19" />
      </button>
      <WindowControl :is-dark-theme="isDarkTheme" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue/offline'
import WindowControl from './WindowControl.vue'
import { windowService } from '../services/windowService'
import { useSettings } from '../composables/useSettings'

const { settings } = useSettings()

defineProps<{
  isDarkTheme: boolean
  hasUpdate: boolean
}>()

const emit = defineEmits<{
  'toggle-theme': []
  'open-settings': []
  'open-update': []
}>()

// 顺序必须与主进程 applicationMenu 模板保持一致，popup 时按索引取子菜单。
const menus = ['文件', '导出', '编辑', '视图', '窗口']
const activeMenuIndex = ref<number | null>(null)

// 将按钮位置交给 Electron，让原生菜单紧贴对应文字按钮展开。
const openMenu = async (menuIndex: number, event: MouseEvent): Promise<void> => {
  const button = event.currentTarget as HTMLButtonElement
  const bounds = button.getBoundingClientRect()
  activeMenuIndex.value = menuIndex

  try {
    await windowService.showApplicationMenu({
      menuIndex,
      x: Math.round(bounds.left),
      y: Math.round(bounds.bottom),
    })
  } finally {
    activeMenuIndex.value = null
  }
}
</script>
