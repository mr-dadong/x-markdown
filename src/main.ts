import { createApp } from 'vue'
import App from './App.vue'
import { diagnosticService } from './services/diagnosticService'
import { setupI18n } from './composables/useI18n'
import { setupSettingsSync } from './composables/useSettings'
import './assets/main.css'

diagnosticService.installGlobalErrorHandlers()
import 'katex/dist/katex.min.css'
import './icons'

// 挂载前先确定界面语言，让首屏文案与主进程菜单使用同一语言。
setupI18n()
// 快捷键与主进程菜单的同步从模块加载时移到入口，避免测试导入即触发 Electron API。
setupSettingsSync()

// 创建 Vue 应用
const app = createApp(App)

// 挂载应用
app.mount('#app')
