# 日账 DayBook

> 3 秒记一笔，30 秒看懂这个月钱花在哪。

本地优先的个人记账 Web App：**不登录也能完整使用**，数据默认只存在你自己的设备上；需要多设备或云备份时，可以登录你自己部署的轻量后端做增量同步。

需求来源：`../产品PRO/PRD-日账-个人财务管家.md`（PRD v1.1）。

---

## 交付形态

| 部分 | 技术 | 说明 |
|---|---|---|
| 前端 | Vite 8 + React 19 + TypeScript + Zustand + Dexie | 移动端优先，桌面自动套手机框 |
| 后端 | Node 22 + Hono 4 + Drizzle + SQLite(libSQL) + better-auth | 可选，单进程 ~100MB RSS |
| 共享层 | `packages/shared` | 类型 / Zod / 金额 / 日期 / 统计 / CSV / 同步协议，只写一份 |

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
│  │     ├─ store/store.ts     全局状态 + 动作（写入即落 IndexedDB）
│  │     ├─ lib/db.ts          Dexie 表结构、仓储层、outbox、同步游标
│  │     ├─ lib/sync.ts        客户端同步引擎
│  │     ├─ lib/api.ts         后端 API 客户端
│  │     ├─ lib/backup.ts      本地每日备份（存 IndexedDB）
│  │     ├─ lib/csv.ts         CSV 导出下载（浏览器专用）
│  │     ├─ lib/select.ts      图标/符号映射等展示层
│  │     ├─ styles/            tokens / base / components
│  │     └─ icons/Icon.tsx     ~60 个自绘线性 SVG 图标
│  └─ api/                     后端
│     ├─ src/auth.ts           better-auth（用户名 + 密码）
│     ├─ src/routes/account.ts 注册 / 登录 / 改密 / 设备 / 找回
│     ├─ src/db/               schema / 连接 / 迁移 / 重置
│     ├─ src/lib/sync-service.ts  push / pull 的服务端实现
│     ├─ src/routes/           sync 路由 + [[docs/API.md]] 对应实现
│     └─ drizzle/              由 drizzle-kit 生成的迁移 SQL
├─ packages/shared/            前后端共享领域层
├─ docs/API.md                 后端接口文档（请求/响应示例、错误码、调试脚本）
└─ tests/                      单元 + 后端端到端 + 浏览器端到端
```

---

## 快速开始

```powershell
pnpm install
pnpm dev            # 同时起 api(3001) 与 web(5173)
```

打开 <http://localhost:5173>。

- 首次启动会预置一份示例数据（十几条，具体条数见 `packages/shared/src/seed.ts`），方便直接看报表效果；可在「我的 → 数据」一键清空。
- 想试账号与同步：「我的」顶部「未登录」→ 注册（用户名 + 密码）→ 记住恢复码 → 回到「云同步」点「立即同步」。
  开发模式下没有 SMTP，找回密码的重置令牌会直接随接口返回（`EXPOSE_DEV_AUTH=1`）。

只需前端（不跑后端）：

```powershell
pnpm dev:web        # 不登录的话，前端完全自洽，同步页只会提示「后端未连接」
```

---

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 并行启动 api + web |
| `pnpm dev:web` / `pnpm dev:api` | 只启动其中一个 |
| `pnpm build` | 前端生产构建 + 后端类型检查 |
| `pnpm typecheck` | 三个包全量类型检查 |
| `pnpm lint` | oxlint（仅警告，无 error） |
| `pnpm test` | 共享层单元测试（12 条） |
| `pnpm test:api` | 后端协议端到端（33 条） |
| `pnpm test:e2e` | 浏览器端到端（28 条，自动拉起/清理无头 Chrome） |
| `pnpm db:generate` / `db:migrate` / `db:reset` | Drizzle 迁移生成 / 应用 / 重置本地库 |
| `pnpm db:inspect` | 直接从 SQLite 文件侧核对落库情况 |

---

## 数据层（P0：localStorage → IndexedDB）

PRD §11 要求「支持 10 年约 5 万条、库 < 50MB、列表 60fps」。5 万条 JSON ≈ 12MB+，早已超出 localStorage 的 5–10MB 配额；而且 `zustand/persist` 每次变更都要同步 `JSON.stringify` 全量落盘，会直接卡主线程。所以本地持久化改成了 **IndexedDB（Dexie）**：

| 表 | 主键/索引 | 用途 |
|---|---|---|
| `meta` | key | schemaVersion / budget / settings / lastUsed / categoryUsage / sync / deviceId |
| `categories` | id（parentId, kind, sortOrder） | 分类 |
| `accounts` | id（type, isArchived） | 账户 |
| `transactions` | id（occurredAt, type, parentCategoryId, accountId, updatedAt, deletedAt） | 流水 |
| `outbox` | ++seq（entity, entityId） | **待推送变更队列** |
| `snapshots` | date | 本地每日备份（保留 7 份） |

要点：

- **写入非阻塞**：所有写入走一个串行队列，异步落盘，主线程不再做全量序列化。
- **事务**：批量写入用 Dexie 事务，避免半截状态。
- **outbox**：每次增删改都追加一条变更记录，云同步时只推送这些增量（首次同步除外，见下）。
- **一次性迁移**：若检测到旧的 `localStorage["daybook.v1"]`，会自动搬进 IndexedDB。
- 主题额外镜像一份到 `localStorage["daybook.theme"]`，只为让 `index.html` 的首屏内联脚本在 hydration 之前就能定色，避免深色用户闪白。

---

## 同步协议（自建，push / pull + LWW + 单调游标）

服务端表 `ledger_transactions`：一行一条流水，`payload` 存完整 JSON。

```
key       INTEGER PK AUTOINCREMENT   -- 内部行号
id        TEXT                       -- 客户端生成的 UUID
user_id   TEXT
seq       INTEGER NOT NULL           -- 每个用户一条「逻辑同步序号」
updated_at / deleted_at / occurred_at INTEGER
UNIQUE(user_id, id)
```

设计取舍：

- **幂等**：客户端生成 UUID + `UNIQUE(user_id,id)`，重复推送不会产生重复数据。
- **冲突**：Last-Write-Wins，比 `updatedAt`；完全相等时「墓碑（已删除）」优先，避免记录被复活。
- **增量游标用 `seq` 而不是时间戳**：用户可能改设备时间，时间戳不可靠。
  注意 `seq` 不是自增主键 —— 每次 *被接受的写入* 都重新分配一个新的 `seq`，
  这样「就地更新一条老记录」也能被其他设备按增量拉到（只靠自增主键会漏掉更新）。
- **时间戳归一化**：服务端把客户端的 `updatedAt` 夹在 `[0, serverNow + 60s]` 之间后回写，
  保证多设备口径一致、也防止未来时间戳永远取胜。
- **删除用墓碑**：`deletedAt` 随记录一起同步，而不是真删。
- **用户级状态整包 LWW**：分类 / 账户 / 预算 / 偏好存在 `user_state`，数据量小（几十 KB），整包覆盖比字段级合并简单可靠。

接口：

```
POST /api/sync/push    { deviceId, cursor, transactions[], state? }  → { accepted, rejected, cursor, serverTime, stateAccepted }
GET  /api/sync/pull    ?cursor=&limit=                               → { cursor, hasMore, transactions[], state, serverTime }
```

**首次同步 = 全量上传**：从没同步过时（无游标且无时间戳），客户端会把本机全部记录与分类/账户设置一次性推上去。
否则预置/迁移进来的历史数据会因为「不在 outbox 里」而永远上不了云 —— 这是实现过程中发现并修掉的一个真实缺陷。

---

## 鉴权（PRD v1.2 F0 账号体系）

- **用户名 + 密码**（better-auth 1.7 的 `username` + `emailAndPassword`），邮箱可选、**只用于找回密码**。
- 账号是「解锁能力」不是门槛：不登录也能记账、导出、本地备份（决策 D1）。
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
| POST | `/api/auth/logout` | 销毁当前会话，本机数据不动 |
| GET | `/api/auth/session` | 当前用户（`email` 为内部占位邮箱时返回 `null`） |
| GET | `/api/auth/check-username` | 注册页失焦查重 |
| POST | `/api/auth/change-password` | 旧密码 + 新密码 → 撤销其他会话 |
| GET / DELETE | `/api/auth/sessions[/:id]` | 设备列表 / 远程下线 |
| POST | `/api/auth/forgot-password` `/reset-password` | 邮箱令牌或恢复码重置（撤销全部会话） |
| POST | `/api/auth/recovery-code` | 用当前密码重新生成恢复码 |

> 完整的请求/响应示例、错误码表、同步协议细节和 PowerShell 调试脚本见 **[`docs/API.md`](./docs/API.md)**。

---

## 数据库与迁移

- 驱动用 **`@libsql/client`**（SQLite 文件模式）而不是 `better-sqlite3`：
  后者的预编译二进制走 GitHub Releases，在部分网络环境下拉不下来还会退回本地 C++ 编译；
  libSQL 的平台二进制走 npm registry，装完即用。
- 表结构在 `apps/api/src/db/{schema,auth-schema}.ts`，迁移 SQL 由 `drizzle-kit generate` 输出到 `apps/api/drizzle/`。
- 服务启动时会自动跑一次迁移（幂等），所以 `pnpm dev` 即可，不用手动建表。
- 本机数据库文件在 `apps/api/data/daybook.sqlite`（已 gitignore）。

---

## 环境变量

见 `apps/api/.env.example`。全部有默认值，本地开发可以不配。

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `3001` | 后端监听 |
| `DATABASE_URL` | `file:./data/daybook.sqlite` | SQLite 文件 |
| `BETTER_AUTH_SECRET` | 开发占位值 | **生产必须改** |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3001` | 后端对外基址 |
| `WEB_ORIGINS` | localhost/127.0.0.1 的 5173、4173 | CORS 与 trustedOrigins 白名单 |
| `EXPOSE_DEV_AUTH` | 非生产为 `1` | **生产必须 `0`**（旧名 `EXPOSE_DEV_OTP` 兼容） |
| `MAX_PUSH_BATCH` | `2000` | 单次 push 上限 |

---

## 测试

```powershell
pnpm test        # 共享层单元测试（12 条）
pnpm test:api    # 后端协议端到端（33 条，需先 pnpm dev:api）
pnpm test:e2e    # 浏览器端到端（28 条，需先 pnpm dev）
```

细节见 `tests/README.md`。三层覆盖的关键结论：

- **单元**：LWW（新版本胜出 / 同分墓碑优先）、只让更新的远端覆盖本地、金额「分」整数与键盘 9 位整数 + 2 位小数、CSV 引号转义往返、CSV 错误行定位、导入判重、Zod 拒绝非法流水。
- **后端**：未登录 401、注册并拿到恢复码、用户名大小写不敏感、错误密码统一文案、5 次失败锁定、改密后旧密码失效、恢复码重置后旧会话失效、设备列表含当前设备、幂等重推被拒、旧版本被拒、新版本被接受、**就地更新能被增量拉到**、墓碑随增量下发、用户状态整包 LWW、非法 payload 400、分页 `hasMore`、退出后 401。
- **浏览器**：应用从 IndexedDB 正常引导、首启预置 16 条、记一笔落库并在整页刷新后仍在、outbox 记录待推送、旧 localStorage 自动迁移、页面内完成**注册 → 展示恢复码 → 首次全量上传（推送 18 / 拉取 18）**、账号页显示设备、退出登录后本机 18 条仍在、控制台零报错、零未捕获异常。

构建体积：前端约 444KB（gzip 139KB）。共享层刻意不导出 Zod schema（`@daybook/shared/schemas` 子路径），否则整个 Zod 会被打进客户端，白涨约 100KB。

---

## 与 PRD 的偏离（均已说明理由）

1. **底部导航用 4 项**（首页 / 明细 / 报表 / 我的）。PRD §5.1 写 3 项，但 §5.2 把「首页（今日概览）」列为 L1 页面，且 F1、F5 都引用它，去掉首页会丢失「今日概览」这个核心入口。
2. **明细的「左滑删除 / 右滑编辑」改为「点击编辑 + 多选批量」**（批量改分类 / 改账户 / 删除）。Web 上滑动手势与页面滚动、选中文本冲突严重，点击 + 多选更可靠，也更容易做无障碍。
3. **本地备份从 localStorage 移到 IndexedDB**，原因同 P0。
4. **PRD 未写云同步**（F8 是「本地优先、离线可用」）。云同步作为**可选**能力实现，不登录完全不影响使用。

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