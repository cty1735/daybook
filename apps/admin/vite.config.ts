import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 管理后台：同域部署在 /admin/ 下，开发期 5174
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  optimizeDeps: {
    exclude: ['@daybook/shared'],
  },
  server: {
    port: 5174,
    strictPort: true,
    // 正常只通过 5173 的 /admin/ 代理访问（同域单入口）；
    // 直接访问 5174 根路径会被重定向到 /admin/，避免误以为这里是前台。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
