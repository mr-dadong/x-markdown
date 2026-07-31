import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'
import 'katex/dist/katex.min.css'
import './icons'

// 创建 Vue 应用
const app = createApp(App)

// 挂载应用
app.mount('#app')
