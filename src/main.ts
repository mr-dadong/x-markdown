import { createApp } from 'vue'
import App from './App.vue'
import { diagnosticService } from './services/diagnosticService'
import './assets/main.css'

diagnosticService.installGlobalErrorHandlers()
import 'katex/dist/katex.min.css'
import './icons'

// 创建 Vue 应用
const app = createApp(App)

// 挂载应用
app.mount('#app')
