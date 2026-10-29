<script setup lang="ts">
import { t } from '../composables/useI18n'
import { Icon } from '@iconify/vue/offline'
import { windowService } from '../services/windowService'

defineProps<{
    isDarkTheme: boolean
}>()

const minimizeWindow = (): void => {
    windowService.minimize()
}

const maximizeWindow = (): void => {
    windowService.maximize()
}

const closeWindow = (): void => {
    windowService.close()
}
</script>

<template>
    <div class="app-no-drag ml-1 flex h-full items-center">
        <button type="button"
            class="flex h-full w-10 cursor-pointer items-center justify-center border-none bg-transparent"
            :class="isDarkTheme ? 'text-icon hover:bg-control-hover' : 'text-[#666666] hover:bg-[#e8e8e6] hover:text-[#292929]'"
            @click="minimizeWindow" :title="t('menu.window.minimize')">
            <Icon icon="lucide:minus" :size="16" />
        </button>
        <button type="button"
            class="flex h-full w-10 cursor-pointer items-center justify-center border-none bg-transparent"
            :class="isDarkTheme ? 'text-icon hover:bg-control-hover' : 'text-[#666666] hover:bg-[#e8e8e6] hover:text-[#292929]'"
            @click="maximizeWindow" :title="t('window.maximize')">
            <Icon icon="lucide:square" :size="14" />
        </button>
        <button type="button"
            class="flex h-full w-10 cursor-pointer items-center justify-center border-none bg-transparent"
            :class="isDarkTheme ? 'text-icon hover:bg-danger hover:text-inverse' : 'text-[#666666] hover:bg-[#c42b1c] hover:text-[#ffffff]'"
            @click="closeWindow" :title="t('common.close')">
            <Icon icon="lucide:x" :size="16" />
        </button>
    </div>
</template>
