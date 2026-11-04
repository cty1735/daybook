import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @daybook/shared 是 workspace 内的 TS 源码包，交给 Vite 一起转译，不做预打包
  optimizeDeps: {
    exclude: ['@daybook/shared'],
  },
  server: {
    allowedHosts: ['bot.duoduodd.cc.cd'],
    // 开发期把 /api 代理到本地后端，避免跨域与 Cookie 问题
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})