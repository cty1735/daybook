# 日账 DayBook · 管理后台技术方案

> 目标：在不改动现有 App（`apps/web`）任何行为的前提下，为同一套数据加一个运营后台。
> 原则：**复用现有接口与数据模型，不新起服务、不换数据库、不引入重型 UI 框架。**

---

## 1. 结论（选型一览）

| 层 | 选型 | 理由 |
|---|---|---|
| 后台前端 | 新增 `apps/admin`：Vite 8 + React 19 + TS 7 + Zustand 5 | 与 `apps/web` 完全同栈，零学习成本；开发期由 web 的 dev server 代理 `/admin/` 到 5174，对外只有 5173 一个入口 |
| 共享领域层 | 复用 `packages/shared` | 金额/日期/统计/类型唯一真相源，后台算出来的数和 App 一致 |
| 后端 | 复用同一个 Hono 服务，新增 `apps/api/src/routes/admin/*`，前缀 `/api/admin` | 不新起服务；直接查同一个 libSQL 文件，事务一致 |
| 鉴权 | `better-auth` 官方 **admin 插件**（本机 1.7.15 已有） | 不自己造后台账号体系；`user.role` + `banned` 直接生效到现有登录路由 |
| 数据访问 | Drizzle ORM + 现有 `db` 客户端 | 与业务查询同一套类型 |
| UI | 复用 `apps/web/src/styles/tokens.css` + 自建表格/表单 | 不引入 Ant Design：包体积大、和 PRD 的薄荷绿视觉冲突、且后台只有 6 个页面 |
| 图表 | 纯 SVG（照抄 `apps/web/src/components/Charts.tsx` 的写法） | 不引入 echarts/recharts，省 300KB+ |
| 路由 | hash 路由（照抄 `apps/web/src/nav.tsx` 的极简实现） | 6 个页面，不值得引 react-router |

**唯一需要新增依赖**：无（`@daybook/shared`、`zod`、`drizzle-orm` 都已在 workspace 内）。可选加 `@tanstack/react-table`（headless、无样式），若你不想手写排序/分页逻辑。

---

## 2. 为什么是"新 app + 同服务新路由"，而不是塞进现有 web

| 方案 | 判断 |
|---|---|
| 塞进 `apps/web` 加一个 `/admin` 页面 | ❌ 移动端 App 会把整个后台 bundle 带给普通用户；且后台需要跨用户查数据，客户端没有任何理由持有 |
| 新起一个 admin 后端服务 | ❌ 要解决跨进程 SQLite 写锁、会话共享、CORS，收益为零 |
| **新增 `apps/admin` 静态站 + 同服务 `/api/admin` 路由** | ✅ 后台代码不进用户包；数据层零复制；部署只是多一个静态目录 |

---

## 3. 数据层改动（唯一需要动 schema 的地方）

新增迁移 `drizzle/0002_*.sql`，包含三部分：

### 3.1 admin 插件字段（`user` / `session`）

`better-auth` admin 插件要求：

```ts
// auth-schema.ts
user:      role text           // 'user' | 'admin'
           banned boolean default false
           ban_reason text
           ban_expires integer(timestamp_ms)
session:   impersonated_by text
```

> 注意：`user.status`（active/locked/disabled）已存在。**`banned` 是登录拦截的唯一真相源**（插件在建立会话时校验），`status` 继续只作业务标记展示，两者不要混用。
> `auth.ts` 里加：`plugins: [username({...}), admin({ defaultRole: "user", adminRoles: ["admin"] })]`。

### 3.2 流水表物化列（关键）

`ledger_transactions.payload` 是整条 JSON，`amount` / `type` / `category_id` 埋在 JSON 里。后台要做「按金额区间筛、按类型聚合、按分类统计」，`json_extract()` 全表扫且**无法走索引**。

```ts
// schema.ts
amount:      integer("amount").notNull().default(0),      // 分
txType:      text("tx_type").notNull().default("expense"), // expense/income/transfer/adjustment
categoryId:  text("category_id"),
// 索引
index("ledger_tx_user_occurred_ix").on(t.userId, t.occurredAt),
index("ledger_tx_occurred_ix").on(t.occurredAt),
index("ledger_tx_tx_type_ix").on(t.txType),
```

- 写入侧：`sync-service.ts` 的 `pushChanges()` 落库时顺手写这三列（一处改动）。
- 历史数据：迁移 SQL 里一次性回填
  `UPDATE ledger_transactions SET amount = json_extract(payload,'$.amount'), tx_type = json_extract(payload,'$.type'), category_id = json_extract(payload,'$.categoryId');`
- 好处：后台统计全部走 SQL 聚合，不再把几万条 JSON 拉到 Node 里算；App 端同步协议**完全不变**。

### 3.3 审计日志表

```ts
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminId: text("admin_id").notNull(),
  adminName: text("admin_name").notNull(),   // 冗余，用户改名后仍可追溯
  action: text("action").notNull(),          // user.ban / tx.softDelete / role.grant ...
  targetType: text("target_type").notNull(), // user | transaction | system
  targetId: text("target_id"),
  detail: text("detail"),                    // JSON：变更前/后摘要
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("admin_audit_created_ix").on(t.createdAt)]);
```

**只插不改不删**，页面上只提供"导出 CSV"。

---

## 4. 接口设计（`/api/admin/*`）

全部挂在一个 `adminRoutes` 下，`app.route("/api/admin", adminRoutes)`，**注册在 `better-auth` catch-all 之前无所谓**（不同前缀），但要在 CORS 之后。

| 方法 | 路径 | 说明 | 复用的现有能力 |
|---|---|---|---|
| GET | `/overview` | 概览卡片：用户数/今日活跃/流水总数/今日新增流水/同步设备数/7 日趋势 | 直接 SQL 聚合 |
| GET | `/users?q=&role=&banned=&sort=&cursor=` | 用户列表（用户名/邮箱模糊搜、注册时间排序） | `user` 表 |
| GET | `/users/:id` | 用户详情：资料、会话数、设备、流水数、最后同步、user_state 体积 | `session`/`devices`/`ledger_transactions`/`user_state` |
| POST | `/users/:id/ban` | 封禁（body: `reason`, `expiresIn?`）+ 踢掉全部会话 | 插件 `banUser`；`session` 删除 |
| POST | `/users/:id/unban` | 解封 | 插件 `unbanUser` |
| POST | `/users/:id/role` | 授予/收回 admin（body: `role`） | `user.role` |
| POST | `/users/:id/revoke-sessions` | 强制下线 | 复用 `auth.api.revokeUserSessions` 或直接删 `session` |
| GET | `/transactions?userId=&from=&to=&type=&minAmount=&maxAmount=&categoryId=&includeDeleted=&cursor=` | 流水审计（分页，游标 = key） | `ledger_transactions` 物化列 |
| GET | `/transactions/:id` | 单条完整 payload（原始 JSON 可折叠展示） | `ledger_transactions` |
| POST | `/transactions/:id/delete` | 软删：写墓碑 `deletedAt` + **重新分配 seq**（保证下发到所有设备） | 复用 `pushChanges` 的 seq 逻辑 |
| POST | `/transactions/:id/restore` | 恢复（清墓碑 + 新 seq） | 同上 |
| GET | `/stats/totals?from=&to=` | 全站收支总额/笔数 | `json`→物化列 |
| GET | `/stats/categories?from=&to=` | 分类消费分布（Top N） | `categoryId` 聚合 |
| GET | `/stats/daily?from=&to=` | 日趋势 | `occurredAt` 聚合 |
| GET | `/devices` | 设备列表（按最后活跃倒序，可跳用户） | `devices` |
| GET | `/audit?adminId=&action=&from=&to=&cursor=` | 审计日志 | `admin_audit_log` |
| GET | `/system` | `/api/health` 的加强版：版本、迁移版本、DB 文件大小、各表行数、运行时长 | 新增 |

**返回统一格式**：`{ data, nextCursor? }`；错误沿用现有 `{ message, code }`（前端 `ApiError` 可直接复用）。

**不做的事（明确划界）**：不提供"替用户改分类/建账户"这类写业务数据的接口（多端同步 + 本地 IndexedDB 会成为真相源冲突），后台对业务数据**只读 + 软删/恢复**。

---

## 5. 鉴权与安全

### 5.1 中间件

```ts
// src/lib/admin-guard.ts
export async function requireAdmin(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const u = session?.user as Record<string, unknown> | undefined;
  if (!u) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);
  const roles = String(u.role ?? "user").split(",");
  if (!roles.includes("admin")) return c.json({ message: "无权限", code: "FORBIDDEN" }, 403);
  return null; // 放行
}
```

所有 `/api/admin/*` 在路由内第一行调用；写操作额外校验 `Origin ∈ env.webOrigins`（沿用现有 CSRF 口径：SameSite=Lax + CORS 白名单）。

### 5.2 首批 admin 账号怎么来

启动时读 `ADMIN_USERNAMES=cty1735`（逗号分隔），把对应用户 `role='admin'` 一次；之后用后台页面互相授权。**不做**"注册即管理员"。

### 5.3 硬性红线

- 响应体永不出现：`account.password`、`user_recovery.code_hash`、`session.token`、`password_reset.token_hash`。
- 封禁/软删/授权三类操作**必须**写审计日志（`detail` 存 before/after 摘要）。
- 后台登录复用 `/api/auth/login`，因此现有的 **5 次失败锁 15 分钟 + 20 次/IP/小时** 自动生效，不用另写。
- 可选加固：`ADMIN_IP_ALLOWLIST` 环境变量，非白名单 IP 直接 403。
- `GET /api/admin/*` 一律不返回跨用户 PII 全量；邮箱按需脱敏（`ab***@x.com`）——是否脱敏你定。

### 5.4 模拟登录（impersonate）

插件自带，但**第一期不做**。它会在 `session.impersonated_by` 留痕，但对本地优先 App 来说"以用户身份写数据"风险太高，等有真实客服需求再开。

---

## 6. 前端结构（`apps/admin`）

```
apps/admin/
├─ index.html
├─ vite.config.ts        # port 5174（经 5173 的 /admin/ 代理访问），proxy /api → 127.0.0.1:3001，base: '/admin/'
├─ tsconfig.json
└─ src/
   ├─ main.tsx
   ├─ App.tsx            # 登录守卫 + 侧栏布局
   ├─ lib/api.ts         # 照抄 apps/web/src/lib/api.ts 的 request/ApiError，加 admin 方法
   ├─ lib/router.ts      # hash 路由：#/overview #/users #/users/:id #/transactions #/stats #/audit #/system
   ├─ components/{Table,Pagination,FilterBar,StatCard,Drawer,ConfirmDialog,Charts}.tsx
   ├─ screens/{Login,Overview,Users,UserDetail,Transactions,Stats,Audit,System}.tsx
   └─ styles/{tokens.css,admin.css}   # tokens.css 直接从 web 复制，保证同色系
```

- **不复用** `apps/web` 的 Dexie / Zustand store：后台是纯服务端数据，不需要本地库。
- 桌面优先布局（左侧 200px 侧栏 + 内容区），但仍做 1280/1024 两档自适应。
- 表格交互：列头排序 → 服务端 `sort`；筛选变化 → 重置游标；「更多」按钮加载下一页（游标分页，避免 COUNT 全表）。
- 时间一律显示 `Asia/Shanghai` + 相对时间（`3 分钟前`），前端不做时区换算猜测。

---

## 7. 部署与工程配套

1. `apps/admin` 构建产物走现有静态托管：`base: '/admin/'`，与 web 同域 → Cookie 天然可用，**不需要额外 CORS 配置**；若独立子域，则把域名加进 `WEB_ORIGINS`。
2. `package.json` 脚本：
   - `dev:admin` → `pnpm -F @daybook/admin dev`
   - `build` 里追加 admin 构建
3. 文档同步（现有约定，漏了会被测试打回）：
   - `apps/api/src/docs/openapi.ts` 增加 admin 路径
   - `docs/API.md` 增加后台章节
   - `tests/api-e2e.mjs` 里 **`paths` 数量断言 14 → 14+N** 必须同步改
4. 新增 `tests/admin-e2e.mjs`：非管理员访问 403 / 管理员列表 200 / 封禁后登录 403 / 软删后 pull 能拉到墓碑。

---

## 8. 实施阶段与工作量

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | 迁移 0002 + admin 插件 + `requireAdmin` + `/overview` `/users` | 0.5 天 |
| P1 | 用户详情 / 封禁解封 / 授权 / 强制下线 + 审计写入 | 0.5 天 |
| P2 | 流水审计（列表/详情/软删/恢复）+ 物化列回填验证 | 0.5 天 |
| P3 | 统计页 + 系统页 + 审计页 + 导出 CSV | 0.5 天 |
| P4 | admin 前端壳 + 6 个页面联调 | 1 天 |
| P5 | 测试、openapi/API.md 同步、README | 0.5 天 |

合计约 **3.5 人天**。P0–P2 只碰后端，可以先用 `/api/docs` 的 Swagger UI 验证，前端最后做。

---

## 9. 风险与坑（提前说清楚）

1. **`paths` 数量断言**：`tests/api-e2e.mjs` 硬断言 14，加接口必须同步改，否则 `pnpm test:api` 红。
2. **seq 重新分配**：后台软删/恢复必须走"分配新 seq"的路径，直接 UPDATE `deleted_at` 不会下发到设备——这是最容易踩的坑。
3. **SQLite 写锁**：后台批量操作要包在 `db.transaction()` 里，别在循环里逐条 await（libSQL 文件模式并发写会排队）。
4. **物化列与 payload 不一致**：只在 `pushChanges` 一处写，别在别处补写；迁移回填后跑一次校验脚本对比 `json_extract` 与物化列。
5. **插件迁移顺序**：`db:generate` 会一起生成 admin 插件字段，务必先确认生成的 SQL 没有 drop/rename 现有列（`user` 表有历史数据）。
6. **`user.status` vs `banned` 双轨**：只在封禁/解封时同步写一次，读取以 `banned` 为准，避免两处真相。

---

## 10. 待确认（影响实现顺序）

1. 后台部署形态：同域 `/admin/`（推荐）还是独立子域？
2. 用户邮箱在列表里是否脱敏（`ab***@x.com`）？
3. 是否需要「导出用户/流水 CSV」作为 P3 的必做项？
