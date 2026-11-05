# 测试

三层验证，从快到慢。所有脚本都是独立的 Node 脚本（无测试框架依赖），失败时返回非 0 退出码。

| 脚本 | 覆盖 | 需要先启动 |
|---|---|---|
| `pnpm test` | 共享领域层单元测试（LWW、金额、CSV 往返、Zod） | 无 |
| `pnpm test:api` | 后端同步协议 + 账号体系端到端（注册 / 登录 / 锁定 / 改密 / 恢复码 / push / pull / LWW / 墓碑 / 分页 / 文档接口数） | `pnpm dev:api` |
| `pnpm test:e2e` | 浏览器端到端（IndexedDB 持久化 / 迁移 / 注册→同步→退出闭环） | `pnpm dev`（api + web） |
| `pnpm test:admin` | 管理后台接口端到端（401/403、封禁登录拦截、解封、强制下线、物化列筛选、软删/恢复的 seq、审计留痕、统计、授权） | `pnpm dev:api` |
| `pnpm test:admin:e2e` | 管理后台浏览器端到端（登录 → 概览 → 用户 → 流水 → 统计 → 日志 → 系统 → 退出，含截图） | `pnpm dev:api` + `pnpm dev:admin` |
| `pnpm db:inspect` | 从 SQLite 文件侧核对落库情况 | 无 |
| `node tests/admin-inspect.mjs` | 核对物化列（amount/type/category）回填与审计表 | 无 |

## 一键跑完整验证

```powershell
# 终端 1：拉起前后端
pnpm dev

# 终端 2
pnpm test        # 单元
pnpm test:api    # 后端协议
pnpm test:e2e    # 浏览器（会自动拉起无头 Chrome，结束时清理进程与临时 profile）
pnpm db:inspect  # 看服务端到底存了什么
```

## 说明

- `api-e2e.mjs` 默认打 `http://127.0.0.1:3001`，可用 `API_BASE` / `ORIGIN` 环境变量覆盖。
- `browser-e2e.mjs` 不带参数时会自己找 Chrome 并拉起无头实例；也可以先手动启动
  Chrome（`--remote-debugging-port=9333`）再 `node tests/browser-e2e.mjs 9333`。
- 账号测试用随机用户名 + 随机 `X-Forwarded-For`，避免「同一 IP 每小时 20 次登录」限流影响反复调试。
- 开发模式下找回密码的重置令牌会随 `/api/auth/forgot-password` 响应返回（`EXPOSE_DEV_AUTH=1`），
  测试与本地调试因此不需要 SMTP；生产环境必须 `EXPOSE_DEV_AUTH=0`。
- 浏览器端测试复用真实交互路径（点 FAB、按金额键盘、注册表单、点「立即同步」），
  不是直接调 store，所以能捕捉到真实的渲染/事件问题。