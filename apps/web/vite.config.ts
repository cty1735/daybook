import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** `/admin` 少了结尾斜杠时补一个 302，避免直接落到代理的 404 */
function adminTrailingSlash(): Plugin {
  return {
    name: 'daybook-admin-trailing-slash',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (/^\/admin(\?|#|$)/.test(url)) {
          res.statusCode = 302
          res.setHeader('Location', `/admin/${url.slice('/admin'.length)}`)
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), adminTrailingSlash()],
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
      // 管理后台同域挂在 /admin/：转发到 admin 的 dev server（5174）。
      // 这样前端只有 5173 一个入口：`/` 是 App、`/admin/` 是后台，
      // 不会再出现「开过一次后台，之后刷新前台也变后台」的串台问题。
      // 用正则精确匹配，避免 /administrator 之类的路径被误转发。
      '^/admin(/.*)?$': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})