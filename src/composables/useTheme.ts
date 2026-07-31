import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSettings } from './useSettings'

export const useTheme = () => {
  const { settings } = useSettings()
  const systemPrefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const isDarkTheme = computed(() =>
    settings.themeMode === 'system' ? systemPrefersDark.value : settings.themeMode === 'dark',
  )

  watch(
    isDarkTheme,
    (isDark) => document.documentElement.classList.toggle('dark', isDark),
    { immediate: true },
  )

  const toggleTheme = (): void => {
    settings.themeMode = isDarkTheme.value ? 'light' : 'dark'
  }

  const syncSystemTheme = (event: MediaQueryListEvent): void => {
    systemPrefersDark.value = event.matches
  }

  onMounted(() => systemThemeQuery.addEventListener('change', syncSystemTheme))
  onUnmounted(() => systemThemeQuery.removeEventListener('change', syncSystemTheme))

  return {
    isDarkTheme,
    toggleTheme,
  }
}
