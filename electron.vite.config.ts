import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Vite 8 起 rollupOptions 已废弃，改用 Rolldown 的 rolldownOptions。
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      // 生产环境压缩渲染进程脚本，减少安装包体积和首屏 JavaScript 解析时间。
      // Vite 8 默认用 Rolldown 自带的 oxc 压缩器；若指定 'esbuild'，Vite 8 要求
      // esbuild ^0.27 或 ^0.28，而项目里的 esbuild 由 electron-vite 提供（0.25.x），
      // 版本不匹配，因此显式使用 oxc。
      minify: 'oxc',
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '127.0.0.1',
    },
  },
})
