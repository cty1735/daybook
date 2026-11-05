# 日账 DayBook

> 3 秒记一笔，30 秒看懂这个月钱花在哪。

云端账本的个人记账 Web App：**账本实时读写自己的后端**，登录即可用，多设备天然一致（无需增量同步、无需本地缓存）。

需求来源：`../产品PRO/PRD-日账-个人财务管家.md`（PRD v1.1）。

---

## 交付形态

| 部分 | 技术 | 说明 |
|---|---|---|
| 前端 | Vite 8 + React 19 + TypeScript + Zustand | 移动端优先，桌面自动套手机框；数据实时读写后端 |
| 后端 | Node 22 + Hono 4 + Drizzle + SQLite(libSQL) + better-auth | **必需**（账本真相源），单进程 ~100MB RSS |
| 管理后台 | Vite 8 + React 19 + TypeScript（与前端同栈） | 同域 `/admin/`，仅管理员可进，只管用户 / 流水 / 统计 |
| 共享层 | `packages/shared` | 类型 / Zod / 金额 / 日期 / 统计 / CSV / 旧同步协议，只写一份 |

设计规范严格照 PRD §10「薄荷绿 · 轻盈可爱」执行（色板、圆角、间距、阴影、字体、深色模式全部落进 `apps/web/src/styles/tokens.css`）。

---

## 目录结构

```
daybook/                       ← monorepo 根（pnpm workspaces）
├─ apps/
│  ├─ web/                     前端应用
│  │  └─ src/
│  │     ├─ screens/           首页 / 明细 / 报表 / 我的 + 二级页
│  │     ├─ components/        抽屉、金额键盘、图表（全自绘 SVG）、Toast…
│  │     ├─ store/store.ts     全局状态 + 动作（每次写入实时回写 /api/data）
│  │     ├─ lib/api.ts         后端 API 客户端（含实时读写）
│  │     ├─ lib/auth-state.ts  会话用户缓存
│  │     ├─ lib/csv.ts         CSV 导出下载（浏览器专用）
│  │     ├─ lib/legacy-import.ts 旧版本地账本（IndexedDB）一次性搬家
│  │     ├─ lib/select.ts      图标/符号映射等展示层
│  │     ├─ styles/            tokens / base / components
│  │     └─ icons/Icon.tsx     ~60 个自绘线性 SVG 图标
│  ├─ api/                     后端
│     ├─ src/auth.ts           better-auth（用户名 + 密码）
│     ├─ src/routes/account.ts 注册 / 登录 / 改密 / 设备 / 找回
│     ├─ src/routes/data.ts    /api/data：整本账实时读写（前端主路径）
│     ├─ src/routes/admin.ts   /api/admin/*：用户 / 流水审计 / 统计 / 审计日志
│     ├─ src/lib/admin-guard.ts  requireAdmin + 邮箱脱敏 + 审计写入
│     ├─ src/db/               schema / 连接 / 迁移 / 重置
│     ├─ src/lib/sync-service.ts  LWW / 幂等 / 单调 seq 的写入实现
│     ├─ src/routes/sync.ts    旧 push / pull 路由（前端不再调用）
│     └─ drizzle/              由 drizzle-kit 生成的迁移 SQL
│  └─ admin/                   管理后台（同域 /admin/，开发期经 5173 代理）
│     └─ src/
│        ├─ screens/           概览 / 用户 / 流水审计 / 统计 / 操作日志 / 系统
│        ├─ components/        表格反馈、确认框、纯 SVG 图表
│        └─ lib/               api 客户端、hash 路由、格式化
├─ packages/shared/            前后端共享领域层
├─ docs/API.md                 后端接口文档（请求/响应示例、错误码、调试脚本）
├─ docs/ADMIN-PLAN.md          管理后台技术方案（选型、接口设计、迁移、风险）
└─ tests/                      单元 + 后端端到端 + 浏览器端到端（含后台）
```

---

## 快速开始

```powershell
pnpm install
pnpm dev            # 同时起 api(3001) + web(5173) + admin(5174)
```

打开 <http://localhost:5173>。
后端起来后，接口文档在 <http://127.0.0.1:3001/api/docs>（Swagger UI，可在线调试），OpenAPI 原始规范在 `/api/openapi.json`。

- 新用户首次打开是一本空账：不预置任何示例流水、账户初始余额与预算金额都是 0；想预览报表效果可在「我的 → 数据 → 载入示例数据」，之后随时可清空。
- **必须注册/登录**才能记账：未登录只显示登录 / 注册页，账本数据全部存在云端，换设备登录同一账号即可看到全部记录。
- 注册（用户名 + 密码）后请记住恢复码，用于换机或忘记密码时找回。
  开发模式下没有 SMTP，找回密码的重置令牌会直接随接口返回（`EXPOSE_DEV_AUTH=1`）。
- 前端与后端必须一起跑：没有后端就没有账本。

---

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 并行启动 api(3001) + web(5173) + admin(5174)；统一从 `http://localhost:5173` 访问 |
| `pnpm dev:web` / `pnpm dev:api` / `pnpm dev:admin` | 只启动其中一个 |
| `pnpm dev:all` | `pnpm dev` 的别名（保留旧习惯） |
| `pnpm build` | web + admin 生产构建 + 后端类型检查 |
| `pnpm typecheck` | 四个包全量类型检查 |
| `pnpm lint` | oxlint（仅警告，无 error） |
| `pnpm test` | 共享层单元测试（13 条） |
| `pnpm test:api` | 后端协议端到端（47 条） |
| `pnpm test:e2e` | 浏览器端到端（26 条，自动拉起/清理无头 Chrome） |
| `pnpm test:admin` | 后台接口端到端（78 条，需先 `pnpm dev:api`） |
| `pnpm test:admin:e2e` | 后台浏览器端到端（28 条，需先 `pnpm dev`；后台走 5173 的 `/admin/`） |
| `pnpm db:generate` / `db:migrate` / `db:reset` | Drizzle 迁移生成 / 应用 / 重置数据库 |
| `pnpm db:inspect` | 直接从 SQLite 文件侧核对落库情况 |
| `pnpm admin:create` | 幂等创建/提升管理员（凭据见脚本输出） |

---

## 数据层（云端为准）

账本数据存在云端 SQLite（`ledger_transactions` + `user_state`）。前端启动时 `GET /api/data` 拉全量，增删改实时回写 `/api/data/transactions` 与 `/api/data/state`；浏览器只保留主题镜像 `localStorage["daybook.theme"]`，用于首屏定色、避免深色用户闪白。

要点：

- **未登录也能进**：打开就是首页（空账本，可看界面），记账 / 导出等写操作会引导登录；浏览器不存任何账本副本。
- **写入幂等 + LWW**：复用同步协议的 UUID 幂等、Last-Write-Wins 与单调 `seq`，多端同时修改不会互相覆盖。
- **分类 / 账户 / 预算 / 偏好**：整包存 `user_state`，前端 300ms 防抖合并提交。
- **备份**：导入导出页的 JSON 备份走 `/api/data/replace` 整体替换；CSV 仍可随时导出。
- **旧同步端点保留**：`/api/sync/push|pull` 仍在，兼容旧客户端与调试，但前端不再使用。

---

## 旧同步协议（已弃用）

前端已改为实时读写 `/api/data`，`POST /api/sync/push` 与 `GET /api/sync/pull` 这套 push / pull 增量同步**前端不再调用**，仅为旧客户端与调试保留。协议细节（`seq` 游标、LWW、墓碑、首次全量上传）见 [`docs/API.md` §5–6](./docs/API.md)，新客户端不需要了解。

> 实时接口不存在「首次全量上传」「游标漏拉」这类问题：每次 `GET /api/data` 就是整本账，写入直接落云端。

---

## 鉴权（PRD v1.2 F0 账号体系）

- **用户名 + 密码**（better-auth 1.7 的 `username` + `emailAndPassword`），邮箱可选、**只用于找回密码**。
- 账号即门槛：账本存在云端，**记账 / 导出必须登录**（决策 D1 已改为「云端为准」）；未登录可浏览首页由首页提示卡进入登录。
- 注册规则：用户名 3–20 位（字母/数字/`_`/`-`，不区分大小写，禁纯数字与保留字）；密码 8–64 位且必须字母+数字，拒绝弱密码与近似用户名。
- 注册即发 **8 位恢复码**（`XXXX-XXXX`，只在注册响应里出现一次，库里只存 SHA-256）。
- 登录风控：同一用户名连续 5 次失败 → 锁定 15 分钟；同一 IP 每小时最多 20 次；失败文案统一为「用户名或密码不正确」防枚举。
- 会话 Cookie：`httpOnly`、`sameSite=lax`、生产环境自动 `secure`；30 天滑动续期（`updateAge` 1 天）。
- 已实现：注册 / 登录 / 登出 / 改密（撤销其他设备）/ 恢复码重置 / 邮箱一次性令牌重置 / 设备列表与远程下线 / 恢复码重新生成。
- `trustedOrigins` + CORS 双重白名单；better-auth 的 CSRF 校验要求 POST 带 `Origin`（浏览器会自动带）。
- 开发便利：`EXPOSE_DEV_AUTH=1` 时，`POST /api/auth/forgot-password` 会把重置令牌放在响应的 `devResetToken` 里（本地无 SMTP 也能跑通找回闭环）。
  生产环境 `assertProdConfig()` 会在启动时强制要求关掉它、并要求设置 `BETTER_AUTH_SECRET`。

**接口**（`apps/api/src/routes/account.ts`，比 better-auth 原生端点更贴近 PRD §9.8）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 → 会话 + 恢复码 |
| POST | `/api/auth/login` | 用户名 + 密码（含风控与锁定） |
| POST | `/api/auth/logout` | 销毁当前会话，云端账本不动 |
| GET | `/api/auth/session` | 当前用户（`email` 为内部占位邮箱时返回 `null`） |
| GET | `/api/auth/check-username` | 注册页失焦查重 |
| POST | `/api/auth/change-password` | 旧密码 + 新密码 → 撤销其他会话 |
| GET / DELETE | `/api/auth/sessions[/:id]` | 设备列表 / 远程下线 |
| POST | `/api/auth/forgot-password` `/reset-password` | 邮箱令牌或恢复码重置（撤销全部会话） |
| POST | `/api/auth/recovery-code` | 用当前密码重新生成恢复码 |

> 完整的请求/响应示例、错误码表、同步协议细节和 PowerShell 调试脚本见 **[`docs/API.md`](./docs/API.md)**；
> 后端启动后也可以直接打开在线文档 **<http://127.0.0.1:3001/api/docs>**（Swagger UI，可 Try it out 调试，数据源是 `apps/api/src/docs/openapi.ts` 的 OpenAPI 3.0 规范）。

---

## 管理后台（`apps/admin`，同域 `/admin/`）

面向运营的三个模块：**用户管理**、**流水审计**、**统计分析**（外加概览、操作日志、系统信息）。

- **独立 app，不进用户包**：`apps/admin` 单独构建到 `dist/`，生产放在同域的 `/admin/` 静态目录。
- **开发期只有一个入口**：`pnpm dev` 同时起 api(3001) + web(5173) + admin(5174)，但**只访问 `http://localhost:5173`**；`/` 是 App、`/admin/` 是后台，`/admin/*` 由 web 的 dev server 反向代理到 5174。这样两个应用共享同一个 origin，Cookie 天然可用，也不会出现「开过一次后台后刷新前台变成后台」的串台。
- **鉴权独立于前台**：后台使用**独立账号表** `admin_user` + `admin_session`（Cookie `daybook_admin_session`），与前台 `user` 完全分离。前台 App 注册的用户不能登录后台；旧版 `user.role='admin'` 会在启动时自动迁移成后台账号并降权。
- **后台登录风控**：连续 5 次失败锁 15 分钟；同一 IP 每小时最多 20 次尝试（与前台计数隔离）。
- **封禁立刻生效**：除写 `banned=true` 外，同时删除该用户全部 `session`，插件在创建会话时会拦下已封禁账号。
- **邮箱脱敏**：列表/详情只返回 `ab***@x.com`；内部占位邮箱（`*@daybook.local`）返回 `null`。
- **流水审计只读 + 软删/恢复**：绝不替用户创建/修改分类账户（会与云端真相源冲突）。软删/恢复都会**重新分配 `seq`**，否则设备按 `seq > cursor` 拉不到变更。
- **物化列**：`ledger_transactions` 新增 `amount` / `tx_type` / `category_id`（`payload` 的投影），后台按金额区间、类型、分类聚合全部走索引；写入集中在 `sync-service.pushChanges()` 一处，历史数据由迁移里的 `json_extract` 一次性回填。
- **审计日志**：`admin_audit_log` 只增不改不删；封禁/解封/强制下线/软删/恢复/管理员增删改密全部留痕（操作人、目标、变更摘要、IP、UA）。
- **统计口径**：只算未删除流水；`transfer` / `adjustment` 不计收支；分类统计按**分类名**合并（每个用户有自己一套分类 UUID，运营要看「房租」合计而不是 N 条房租）。

### 怎么进后台

后台账号是独立表，只能用 `admin:create` 脚本或后台「管理员账号」页创建；**不能**用前台 App 账号登录，也不能靠给前台用户提权进后台。

```powershell
pnpm dev                                   # api + web + admin 一起起（单一入口 5173）
pnpm admin:create                          # 不存在则建默认管理员；已存在只提示、不改密码
pnpm admin:create -- myadmin MyPass12345   # 指定用户名与密码
# 打开 http://localhost:5173/admin/ ，用该账号登录（前台是 http://localhost:5173/）
```

登录后可进「管理员账号」页：新建其他管理员、重置密码、停用/启用、删除（不能操作自己，至少保留一个可用管理员）。
`ADMIN_USERNAMES` 提权机制已废弃；旧库里的 `user.role='admin'` 会在服务启动时自动迁移到 `admin_user`（沿用原密码哈希）并把前台角色降回 `user`。

### 后台接口

`GET /api/admin/auth/{me,accounts}`、`POST /api/admin/auth/{login,logout,me/password}`、`POST /api/admin/auth/accounts/:id/{password,status}`、`DELETE /api/admin/auth/accounts/:id`
`GET /api/admin/{whoami,overview,users,users/:id,transactions,transactions/:id,stats/totals,stats/categories,stats/daily,devices,audit,system}`
`POST /api/admin/users/:id/{ban,unban,revoke-sessions}`、`POST /api/admin/transactions/:id/{delete,restore}`

完整参数与响应见 [`docs/API.md`](./docs/API.md) 与在线文档的「后台」分组。

---

## 数据库与迁移

- 驱动用 **`@libsql/client`**（SQLite 文件模式）而不是 `better-sqlite3`：
  后者的预编译二进制走 GitHub Releases，在部分网络环境下拉不下来还会退回本地 C++ 编译；
  libSQL 的平台二进制走 npm registry，装完即用。
- 表结构在 `apps/api/src/db/{schema,auth-schema}.ts`，迁移 SQL 由 `drizzle-kit generate` 输出到 `apps/api/drizzle/`。
- 服务启动时会自动跑一次迁移（幂等），所以 `pnpm dev` 即可，不用手动建表。
- 开发期数据库文件在 `apps/api/data/daybook.sqlite`（已 gitignore）；生产在服务器的 `/opt/daybook/data/daybook.sqlite`。

---

## 环境变量

见 `apps/api/.env.example`。全部有默认值，本地开发可以不配。

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `3001` | 后端监听 |
| `DATABASE_URL` | `file:./data/daybook.sqlite` | SQLite 文件 |
| `BETTER_AUTH_SECRET` | 开发占位值 | **生产必须改** |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3001` | 后端对外基址 |
| `WEB_ORIGINS` | localhost/127.0.0.1 的 5173、4173、5174 | CORS 与 trustedOrigins 白名单（5174 仅用于直连后台 dev server 调试） |
| `EXPOSE_DEV_AUTH` | 非生产为 `1` | **生产必须 `0`**（旧名 `EXPOSE_DEV_OTP` 兼容） |
| `MAX_PUSH_BATCH` | `2000` | 单次 push 上限 |
| `ADMIN_IP_ALLOWLIST` | 空 | 后台接口 IP 白名单（逗号分隔），空=不限制 |

---

## 测试

```powershell
pnpm test        # 共享层单元测试（13 条）
pnpm test:api    # 后端协议端到端（47 条，需先 pnpm dev:api）
pnpm test:e2e    # 浏览器端到端（26 条，需先 pnpm dev）
```

细节见 `tests/README.md`。三层覆盖的关键结论：

- **单元**：LWW（新版本胜出 / 同分墓碑优先）、金额「分」整数与键盘 9 位整数 + 2 位小数、CSV 引号转义往返、CSV 错误行定位、导入判重、Zod 拒绝非法流水。
- **后端**：未登录 401、注册并拿到恢复码、用户名大小写不敏感、错误密码统一文案、5 次失败锁定、改密后旧密码失效、恢复码重置后旧会话失效、设备列表含当前设备、**实时读写 `/api/data`（GET / upsert / state / replace / clear / reset）**、幂等重推被拒、旧版本被拒、新版本被接受、**就地更新能被增量拉到**、墓碑随增量下发、用户状态整包 LWW、非法 payload 400、分页 `hasMore`、退出后 401。
- **浏览器**：未登录直接进首页（不弹登录）、点「免费注册」注册后直接进入应用、首页为空账本、记一笔实时写入云端、整页刷新后从云端恢复、账号页显示用户名、退出后回首页、重新登录数据仍在、前端不建 IndexedDB、控制台零报错、零未捕获异常。

构建体积：前端约 444KB（gzip 139KB）。共享层刻意不导出 Zod schema（`@daybook/shared/schemas` 子路径），否则整个 Zod 会被打进客户端，白涨约 100KB。

---

## 与 PRD 的偏离（均已说明理由）

1. **底部导航用 4 项**（首页 / 明细 / 报表 / 我的）。PRD §5.1 写 3 项，但 §5.2 把「首页（今日概览）」列为 L1 页面，且 F1、F5 都引用它，去掉首页会丢失「今日概览」这个核心入口。
2. **明细的「左滑删除 / 右滑编辑」改为「点击编辑 + 多选批量」**（批量改分类 / 改账户 / 删除）。Web 上滑动手势与页面滚动、选中文本冲突严重，点击 + 多选更可靠，也更容易做无障碍。
3. **备份从本地快照改为云端 JSON 整体替换**（`/api/data/replace`）。
4. **PRD 写的是「本地优先、离线可用」**；现改为**云端为准、记账需登录**，账本实时读写后端（无本地库、无增量同步、浏览器不留副本）。这是本轮架构调整，PRD 原文尚未同步改写。

---

## 未做 / 下一步

- **F9 周期账单**：`#/recurring` 为占位页（v1.1 规划中）。
- **L3 月报详情页**：洞察卡片已内联在报表页，未单开详情页。
- **P2 规划**：对象存储备份、订阅/激活码、端到端加密、轻量埋点。
- **P3 规划**：数据量上来后把 SQLite 换成 Postgres（Drizzle 换 driver 即可，SQL 与业务代码基本不动）。

---

## 部署建议

- 本机 16GB 板载内存常年吃紧、C 盘可用空间有限 → **不要在本机常驻 Docker / Postgres**，Node + SQLite 单进程是最舒适的解。
- 生产推荐国内 2C2G 轻量云（约 ¥60–100/年）+ Caddy 自动 HTTPS；`pnpm build` 出前端静态文件，后端用 `pnpm -F @daybook/api start` 常驻。
- 备份：定期 `sqlite3 .backup` 或直接复制 `.sqlite` 文件到对象存储。
- 关闭 `EXPOSE_DEV_AUTH`（旧名 `EXPOSE_DEV_OTP`）、设置强 `BETTER_AUTH_SECRET`，并把 `WEB_ORIGINS` 收紧到真实域名。
- 找回密码的邮件发信需要接一个邮件服务（`apps/api/src/routes/account.ts` 里 `/forgot-password` 的 `console.log` 位置替换即可）。