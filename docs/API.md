# 日账 DayBook · 后端接口文档

> 对应代码：`apps/api`（Hono 4 + Drizzle + SQLite/libSQL + better-auth）
> 最近更新：2026-11-04 · 版本 `1.0.0`

## 在线阅读

后端启动后打开 **<http://127.0.0.1:3001/api/docs>**（Swagger UI，可直接 Try it out 调试）。数据源是 `apps/api/src/docs/openapi.ts` 里的 OpenAPI 3.0 规范，原始 JSON 在 `/api/openapi.json`，可直接导入 Postman / Insomnia / Apifox。
本 Markdown 是同一份内容的离线版（含 PowerShell 脚本与排错清单）。

## 目录

- [1. 快速了解](#1-快速了解)
- [2. 通用约定](#2-通用约定)
- [3. 系统接口](#3-系统接口)
- [4. 账号接口](#4-账号接口)
- [实时数据接口（/api/data，前端主路径）](#实时数据接口api数据前端主路径)
- [5. 旧同步接口（已弃用）](#5-旧同步接口已弃用)
- [6. 旧同步协议细节](#6-旧同步协议细节)
- [7. 数据模型](#7-数据模型)
- [8. 错误码总表](#8-错误码总表)
- [9. 调试与排错](#9-调试与排错)
- [10. 管理后台接口（/api/admin/*）](#10-管理后台接口apiadmin)

---

## 1. 快速了解

| 项 | 值 |
|---|---|
| Base URL（开发） | `http://127.0.0.1:3001` |
| 路由前缀 | `/api` |
| 请求/响应格式 | JSON（`Content-Type: application/json`） |
| 鉴权方式 | **HttpOnly Cookie 会话**（better-auth 管理），不传 Bearer Token |
| 时间单位 | **epoch 毫秒**（number） |
| 金额单位 | **整数「分」**（number，`12.34 元` → `1234`） |
| 自定义请求头 | `X-Device-Id`（可选，仅旧同步接口记录设备） |

后端只有两类职责：

1. **账号**：注册 / 登录 / 登出 / 改密 / 设备管理 / 找回密码。
2. **数据**：账本以云端为准，前端实时读写 `/api/data`；旧同步端点 `push/pull` 保留兼容。

> 云端**不做**记账业务计算：账目以 JSON payload 原样存储，谁更新更晚谁赢（LWW）。

---

## 2. 通用约定

### 2.1 Origin 与 Cookie（最容易踩的坑）

- **CORS 白名单**：来源不在 `WEB_ORIGINS` 里的跨域请求会被浏览器拦掉（`credentials: true` 时后端只能回具体来源，不能回 `*`）。
  浏览器会自动带 `Origin`；用 PowerShell / curl / Node 脚本手测时建议手动加 `Origin: http://localhost:5173`，保证路径与浏览器一致。
- **原生端点会校验 Origin**：better-auth 自带的 `/api/auth/*`（如 `sign-out`）缺 `Origin` 时返回 **403** `MISSING_OR_NULL_ORIGIN`。
  本项目的自研路由（`register` / `login` / …）不强制，但脚本手测仍请带上。
- **CSRF 防线**：会话 Cookie 为 `SameSite=Lax`，跨站 POST 不会携带 Cookie；跨站 GET 只能读、不能改。
- 会话存在 **HttpOnly Cookie** 里（`httpOnly` + `sameSite=lax`，生产环境自动 `secure`）。
  客户端只需 `credentials: 'include'`，**不要**自己存 token。
- 允许的来源由 `WEB_ORIGINS` 决定，默认：

```
http://localhost:5173, http://127.0.0.1:5173,
http://localhost:4173, http://127.0.0.1:4173
```

- 跨域允许的方法：`GET / POST / DELETE / OPTIONS`；允许的请求头：`Content-Type`、`X-Device-Id`。

### 2.2 错误格式

业务错误统一为 JSON，至少包含 `message`，多数带机器可读的 `code`：

```json
{ "message": "用户名或密码不正确", "code": "INVALID_CREDENTIALS" }
```

参数校验失败（同步接口）会额外带 `issues`（最多 10 条 Zod 错误）：

```json
{ "message": "参数不合法", "issues": [{ "path": ["transactions", 0, "amount"], "message": "Expected number, received string" }] }
```

未匹配路由 → `404 { "message": "接口不存在" }`；未捕获异常 → `500 { "message": "服务器内部错误" }`。

### 2.3 登录风控

| 维度 | 限制 | 触发后 |
|---|---|---|
| 同一用户名 | 连续 5 次失败 | 锁定 15 分钟，期间正确密码也返回 **429** |
| 同一 IP | 每小时 20 次登录尝试 | 返回 **429**，窗口滚动后恢复 |
| 失败文案 | 一律「用户名或密码不正确」 | 防用户名枚举（账号不存在也计数） |

IP 取值顺序：`X-Forwarded-For` → `X-Real-IP` → `CF-Connecting-IP` → `local`。

### 2.4 会话

- 有效期 **30 天**，滑动续期（`updateAge` 1 天）。
- `GET /api/auth/session` 是判断登录态的唯一入口（`user: null` 即未登录）。
- 登出只销毁会话，**账本数据不受影响**。

---

## 3. 系统接口

### GET /api/health

健康检查，无需登录。部署脚本 `deploy.sh` 用它做发布后的存活校验（`GET /api/health` 200 才算部署成功）。

**响应 200**

```json
{ "ok": true, "version": "1.0.0", "time": 1793780000000 }
```

---

## 4. 账号接口

> 全部挂在 `/api/auth` 下，实现见 `apps/api/src/routes/account.ts`。
> 这些是业务接口；better-auth 自带的端点（如 `/api/auth/get-session`）仍然存在，但客户端不应直接使用。

### 4.0 用户对象（`user`）

多数账号接口都会返回它：

```json
{
  "id": "u_abc123",
  "username": "demo_user",
  "displayUsername": "Demo_User",
  "email": "demo@example.com",
  "emailVerified": false,
  "createdAt": 1793780000000
}
```

| 字段 | 说明 |
|---|---|
| `username` | 规范化后的用户名（小写），登录用 |
| `displayUsername` | 用户输入的原始大小写，仅展示 |
| `email` | **未绑邮箱时为 `null`**（内部占位邮箱 `xxx@daybook.local` 不会外泄） |
| `emailVerified` | 当前不做邮箱验证，恒为 `false` |
| `createdAt` | epoch 毫秒 |

---

### POST /api/auth/register — 注册

**请求**

```json
{
  "username": "demo_user",
  "password": "Daybook2026",
  "email": "demo@example.com",
  "acceptedTerms": true
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `username` | ✅ | 3–20 位，仅字母/数字/`_`/`-`，不区分大小写，禁纯数字、禁保留字（admin/root/system/…） |
| `password` | ✅ | 8–64 位，必须同时含字母和数字；不得与用户名相同或编辑距离 ≤2；拦截常见弱密码、纯重复字符、连续字符 |
| `email` | ❌ | 可选，**只用于找回密码**，不是登录凭据；留空则内部生成占位邮箱 |
| `acceptedTerms` | ✅ | 必须为 `true`，否则 400 |

**响应 200**

```json
{
  "user": { "id": "u_abc123", "username": "demo_user", "displayUsername": "demo_user", "email": "demo@example.com", "emailVerified": false, "createdAt": 1793780000000 },
  "recoveryCode": "K7QM-3XPZ"
}
```

- 同时通过 `Set-Cookie` 建立会话（注册即登录）。
- **`recoveryCode` 只出现这一次**，云端只存 SHA-256。丢了只能用邮箱找回或登录后重新生成。
- 响应里可能带 better-auth 的 `token` 字段，客户端请忽略，鉴权一律靠 Cookie。

**错误**

| 状态 | code | 场景 |
|---|---|---|
| 400 | `INVALID_USERNAME` | 用户名不合规 |
| 400 | `WEAK_PASSWORD` | 密码不合规 |
| 400 | `TERMS_REQUIRED` | 未勾选协议 |
| 400 | `INVALID_EMAIL` | 邮箱格式错误 |
| 409 | `USERNAME_TAKEN` | 用户名已占用 |
| 409 | `EMAIL_TAKEN` | 邮箱已绑定其他账号 |

---

### GET /api/auth/check-username — 用户名查重

注册页失焦时调用。无需登录。

**参数**：`?username=demo_user`

**响应 200**

```json
{ "available": true, "message": "用户名可用" }
```

不合规或已占用时 `available: false`，`message` 给出具体原因。

---

### POST /api/auth/login — 登录

**请求**

```json
{ "username": "demo_user", "password": "Daybook2026", "rememberMe": true }
```

`rememberMe` 缺省为 `true`（仅影响 Cookie 是否持久化）。

**响应 200**

```json
{
  "user": { "id": "u_abc123", "username": "demo_user", "displayUsername": "demo_user", "email": null, "emailVerified": false, "createdAt": 1793780000000 }
}
```

用户名大小写不敏感（`Demo_User` 与 `demo_user` 等价）。

**错误**

| 状态 | code | 场景 |
|---|---|---|
| 400 | `MISSING_FIELDS` | 用户名或密码为空 |
| 401 | `INVALID_CREDENTIALS` | 用户名不存在或密码错误（统一文案） |
| 429 | `RATE_LIMITED` | 账号锁定 / IP 超限 |

---

### POST /api/auth/logout — 登出

无请求体。销毁当前会话，`Set-Cookie` 清空。

**响应 200**

```json
{ "ok": true }
```

---

### GET /api/auth/session — 当前会话

**响应 200（已登录）**

```json
{
  "user": { "id": "u_abc123", "username": "demo_user", "displayUsername": "demo_user", "email": null, "emailVerified": false, "createdAt": 1793780000000 },
  "session": { "id": "s_xyz", "expiresAt": 1796372000000 }
}
```

**响应 200（未登录）**

```json
{ "user": null, "session": null }
```

> 未登录也返回 **200** 而不是 401，方便前端直接判断。

---

### POST /api/auth/change-password — 修改密码

**请求**

```json
{ "currentPassword": "Daybook2026", "newPassword": "NewPass2026" }
```

**响应 200**：`{ "ok": true }`

- 成功后**撤销其他设备的所有会话**，当前设备会话保留（前端 Toast：「密码已更新，其他设备需要重新登录」）。
- 须已登录，否则 401 `UNAUTHORIZED`。

**错误**

| 状态 | code | 场景 |
|---|---|---|
| 400 | `MISSING_FIELDS` | 未传旧密码 |
| 400 | `SAME_PASSWORD` | 新旧密码相同 |
| 400 | `WEAK_PASSWORD` | 新密码不符合规则 |
| 400 | `INVALID_PASSWORD` | 旧密码错误 |

---

### GET /api/auth/sessions — 已登录设备

**响应 200**

```json
{
  "sessions": [
    {
      "id": "s_xyz",
      "device": "Windows · Chrome",
      "ip": "127.0.0.1",
      "lastActive": 1793780000000,
      "createdAt": 1793770000000,
      "expiresAt": 1796372000000,
      "current": true
    }
  ]
}
```

`device` 由 User-Agent 粗解析为「系统 · 浏览器」，解析不出时为「未知设备」。

---

### DELETE /api/auth/sessions/:id — 远程下线

**响应 200**：`{ "ok": true }`

| 状态 | code | 场景 |
|---|---|---|
| 401 | `UNAUTHORIZED` | 未登录 |
| 404 | `NOT_FOUND` | 会话不存在或已下线 |
| 400 | `CURRENT_DEVICE` | 目标是当前设备（请用「退出登录」） |

---

### POST /api/auth/forgot-password — 发起找回

**请求**：`{ "username": "demo_user" }`

**响应 200**（无论账号是否存在，文案一致，防枚举）

```json
{
  "ok": true,
  "message": "如果该账号存在，重置方式已发送",
  "hasEmail": true,
  "devResetToken": "3f9c1a7e8b2d4c6f9a0e5d3b1c7f2e4a"
}
```

| 字段 | 说明 |
|---|---|
| `hasEmail` | 该账号是否绑定了邮箱（未绑定时客户端应引导用恢复码） |
| `devResetToken` | **仅开发环境**（`EXPOSE_DEV_AUTH=1`）返回，用于无 SMTP 时跑通邮箱重置；生产环境不出现 |

- 令牌 **15 分钟**有效、一次性，库中只存哈希。
- 真实部署时这里应发邮件，链接形如 `{BETTER_AUTH_URL}/#/reset?token=...`。

---

### POST /api/auth/reset-password — 重置密码

两种方式二选一，`token` 优先：

**A. 邮件令牌**

```json
{ "token": "3f9c1a7e8b2d4c6f9a0e5d3b1c7f2e4a", "newPassword": "NewPass2026" }
```

**B. 恢复码**

```json
{ "username": "demo_user", "code": "K7QM-3XPZ", "newPassword": "NewPass2026" }
```

**响应 200**：`{ "ok": true }`

- 成功后**撤销该用户全部会话**（包括当前设备），需要重新登录。
- 恢复码输入不区分大小写与分隔符（`k7qm3xpz` 也可）。

| 状态 | code |
|---|---|
| 400 | `INVALID_TOKEN`（令牌失效/已用/过期） |
| 400 | `INVALID_CODE`（恢复码错误） |
| 400 | `MISSING_FIELDS`（两者都没传） |
| 400 | `WEAK_PASSWORD` |
| 404 | `NOT_FOUND` |

---

### POST /api/auth/recovery-code — 重新生成恢复码

需登录 + 旧密码校验。

**请求**：`{ "password": "Daybook2026" }`

**响应 200**

```json
{ "ok": true, "recoveryCode": "N4RT-8WQK" }
```

新码替换旧码，同样只展示这一次。

---

## 实时数据接口（`/api/data`，前端主路径）

> 代码：`apps/api/src/routes/data.ts`。前端启动即 `GET /api/data` 拉全量，增删改实时回写；必须登录，浏览器不保存账本。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data` | 返回完整 `AppData`（流水 + 分类/账户/预算/偏好）。新用户首次访问自动写入默认分类与账户。 |
| POST | `/api/data/transactions` | `{ transactions: Transaction[] }`，幂等 upsert（含墓碑），返回 `{ accepted, rejected }`。 |
| PUT | `/api/data/state` | `UserState` 整包覆盖；云端保证时间戳单调递增，不会被旧的「未来时间」挡住。 |
| DELETE | `/api/data/transactions` | 物理删除当前用户全部流水。 |
| POST | `/api/data/reset` | 恢复出厂：删流水 + 重建默认状态，返回新的 `AppData`。 |
| POST | `/api/data/replace` | 用 `AppData` 备份整体替换，返回替换后的 `AppData`。 |

写入复用 `sync-service.ts` 的 LWW / 幂等 / 单调 `seq`，因此实时接口与旧同步接口看到的是同一份数据。

---

## 5. 旧同步接口（已弃用）

> 前端已改为实时读写 `/api/data`，**下面这套 push / pull 前端不再调用**，仅为旧客户端与调试保留。
>
> 实现见 `apps/api/src/routes/sync.ts` + `src/lib/sync-service.ts`。
> **都需要登录**，未登录返回 `401 { "message": "未登录" }`（无 `code` 字段）。

### POST /api/sync/push — 推送变更

**请求**

```json
{
  "deviceId": "dev-1a2b3c",
  "cursor": 42,
  "transactions": [
    {
      "id": "t_9f8e7d",
      "type": "expense",
      "amount": 2350,
      "currency": "CNY",
      "categoryId": "c_food",
      "parentCategoryId": null,
      "accountId": "a_cash",
      "toAccountId": null,
      "occurredAt": 1793779200000,
      "note": "午饭",
      "createdAt": 1793779200000,
      "updatedAt": 1793779300000,
      "deletedAt": null,
      "source": "manual"
    }
  ],
  "state": {
    "payload": { "categories": [], "accounts": [], "budget": { "period": "monthly", "startDay": 1, "totalAmount": 0, "categoryLimits": {}, "rollover": false }, "settings": { "theme": "system", "usageStats": true }, "categoryUsage": {}, "lastUsedCategoryId": null, "lastUsedAccountId": null },
    "updatedAt": 1793779300000
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `deviceId` | ✅ | 设备标识，1–64 字符，云端记录活跃时间与推拉次数 |
| `cursor` | ❌ | 保留字段，云端当前**不使用**（客户端记录进度用） |
| `transactions` | ❌ | 账目变更数组，默认 `[]`，单次上限 `MAX_PUSH_BATCH`（默认 2000） |
| `state` | ❌ | 用户级状态整包（分类/账户/预算/设置），LWW 覆盖 |

**响应 200**

```json
{ "accepted": 1, "rejected": 0, "cursor": 43, "serverTime": 1793779400000, "stateAccepted": false }
```

| 字段 | 说明 |
|---|---|
| `accepted` | 本次被接受写入的流水条数（LWW 胜出） |
| `rejected` | 因版本落后被丢弃的条数 |
| `cursor` | 推送后该用户可见的最大 seq，可作为下次 pull 的起点 |
| `serverTime` | 云端当前时间（用于校正设备时钟） |
| `stateAccepted` | 用户级状态是否被接受 |

**错误**

| 状态 | 说明 |
|---|---|
| 401 | 未登录 |
| 400 | 参数不合法（附 `issues`） |
| 413 | 单次超过上限：`{ "message": "单次推送最多 2000 条" }` |

---

### GET /api/sync/pull — 拉取变更

**参数**

| 参数 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `cursor` | `0` | ≥0 | 上次拉到的 `seq`，只返回 `seq > cursor` 的记录 |
| `limit` | `500` | 1–1000 | 单页条数 |
| `limitState` | `1` | 0/1 | 是否同时返回用户级状态整包 |

**示例**：`GET /api/sync/pull?cursor=42&limit=500&limitState=1`

**响应 200**

```json
{
  "cursor": 43,
  "hasMore": false,
  "transactions": [ { "id": "t_9f8e7d", "type": "expense", "amount": 2350, "currency": "CNY", "categoryId": "c_food", "parentCategoryId": null, "accountId": "a_cash", "toAccountId": null, "occurredAt": 1793779200000, "note": "午饭", "createdAt": 1793779200000, "updatedAt": 1793779300000, "deletedAt": null, "source": "manual" } ],
  "state": null,
  "serverTime": 1793779400000
}
```

- `hasMore: true` 表示还有下一页，客户端用返回的 `cursor` 继续拉，直到 `false`。
- `state` 为 `{ "payload": {...}, "updatedAt": 1793779300000 }` 或 `null`（`limitState=0` 或云端无状态）。
- 删除的记录以**墓碑**返回（`deletedAt` 非 null），客户端据此丢弃该记录。

---

## 6. 旧同步协议细节

理解这 4 条就能解释所有旧同步行为（新客户端不需要了解，实时接口直接读写整本账）：

### 6.1 `seq` 是「每用户逻辑序号」，不是主键

- 每个用户有自己的 seq 序列（1、2、3…），由云端在**每次被接受的写入**时重新分配，包括**就地更新**。
- 所以同一 `id` 的记录改一次就会拿到更大的 seq，其他设备用 `seq > cursor` 才能拉到这次修改。
- 客户端游标只存这个数字，别用时间戳（用户可能改系统时间）。

### 6.2 冲突用 LWW，同分时墓碑胜

1. 比较 `updatedAt`，大者胜。
2. `updatedAt` 完全相等时：若一方 `deletedAt` 非空（墓碑），墓碑方胜 —— 防止已删记录被旧设备「复活」。
3. 完全相等且都不是墓碑 → 视为相同，丢弃入站变更。

### 6.3 云端会夹取客户端时间

`updatedAt` 在落库前被夹到 `[0, serverNow + 60s]`：

- 客户端时间为 0/负数/非法 → 用云端当前时间。
- 客户端时间超前 60 秒以上 → 截断为 `serverNow + 60s`。
- 目的：一台设备把时间改到 2099 年，不能永久压制其他设备。

### 6.4 首次同步必须全量上传（仅旧客户端）

客户端满足 `lastSyncedAt === null && cursor === 0` 时视为首次同步：
要把**全部记录 + 用户状态**一次性 push，而不是只推增量。
因为预置数据、旧版本迁移进来的数据都不在增量集合里，否则永远上不了云。

> 实时接口 `/api/data` 不存在这个问题：每次 GET 就是整本账，写入直接落云端。

### 6.5 推荐客户端流程（仅旧客户端）

```
1. GET  /api/auth/session           → 未登录则跳过同步
2. POST /api/sync/push              → 先推（首次则全量）
3. GET  /api/sync/pull?cursor=...   → 循环直到 hasMore=false
4. 按 LWW 归并（@daybook/shared 的 mergeTransactions）
5. 记住返回的 cursor 与 serverTime
```

先推后拉是为了让云端先拿到客户端较新的版本，减少被覆盖的条数。

---

## 7. 数据模型

### Transaction（账目流水）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string(1–64) | 客户端生成的 UUID，天然幂等 |
| `type` | `expense` \| `income` \| `transfer` \| `adjustment` | 只有前两种计入收支统计 |
| `amount` | int | **分**，正数；方向由 `type` 决定 |
| `currency` | string(1–8) | 如 `CNY` |
| `categoryId` | string \| null | 分类 id |
| `parentCategoryId` | string \| null | 二级分类的父 id |
| `accountId` | string | 账户 id |
| `toAccountId` | string \| null | 转账目标账户 |
| `occurredAt` | int | 记账发生时间（epoch ms） |
| `note` | string(≤200) | 备注 |
| `createdAt` | int | 创建时间 |
| `updatedAt` | int | 最后修改时间，**LWW 依据** |
| `deletedAt` | int \| null | 非 null 即墓碑 |
| `source` | `manual` \| `recurring` \| `import` \| `adjustment` | 来源 |

### UserState（用户级状态，整包同步）

```ts
{
  categories: Category[]      // { id, parentId, name, kind, icon, color, sortOrder, isHidden, noteTemplate }
  accounts: Account[]         // { id, name, type, initialBalance, includeInAssets, isArchived, creditLimit }
  budget: { period: "monthly", startDay, totalAmount, categoryLimits, rollover }
  settings: { theme: "light"|"dark"|"system", usageStats: boolean }
  categoryUsage: Record<string, number>
  lastUsedCategoryId: string | null
  lastUsedAccountId: string | null
}
```

账户类型：`cash` | `debit` | `credit` | `huabei` | `wallet` | `other`。
完整 Zod 定义在 `packages/shared/src/schemas.ts`。

### 云端表

| 表 | 用途 |
|---|---|
| `ledger_transactions` | 账目（`payload` 存整条 JSON，`user_id + id` 唯一，`seq` 索引） |
| `user_state` | 用户级状态整包（每用户一行） |
| `devices` | 设备活跃记录（`last_seen_at` / `pushes` / `pulls`） |
| `user` / `session` / `account` / `verification` | better-auth 认证表 |
| `user_recovery` | 恢复码哈希（每用户一行） |
| `login_attempt` | 按用户名的失败计数与锁定时间 |
| `login_ip` | 按 IP 的登录次数窗口 |
| `password_reset` | 邮箱重置令牌（哈希 + 过期 + 已用标记） |

---

## 8. 错误码总表

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_USERNAME` | 用户名不合规 |
| 400 | `WEAK_PASSWORD` | 密码不合规 |
| 400 | `TERMS_REQUIRED` | 未同意协议 |
| 400 | `INVALID_EMAIL` | 邮箱格式错误 |
| 400 | `MISSING_FIELDS` | 必填字段缺失 |
| 400 | `SAME_PASSWORD` | 新旧密码相同 |
| 400 | `INVALID_PASSWORD` | 旧密码错误 |
| 400 | `INVALID_TOKEN` | 重置令牌失效/已用 |
| 400 | `INVALID_CODE` | 恢复码错误 |
| 400 | `CURRENT_DEVICE` | 不能下线当前设备 |
| 400 | —（无 code） | 同步参数不合法（带 `issues`） |
| 401 | `INVALID_CREDENTIALS` | 登录失败（统一文案） |
| 401 | `UNAUTHORIZED` | 未登录（账号接口） |
| 401 | —（无 code） | 未登录（同步接口，`message: "未登录"`） |
| 403 | `MISSING_OR_NULL_ORIGIN` | 访问 better-auth 原生端点时缺 `Origin` |
| 404 | `NOT_FOUND` | 资源不存在 |
| 404 | —（无 code） | 路由不存在 |
| 409 | `USERNAME_TAKEN` / `EMAIL_TAKEN` | 注册冲突 |
| 413 | —（无 code） | 单次推送超上限 |
| 429 | `RATE_LIMITED` | 账号锁定或 IP 限流 |
| 500 | —（无 code） | 服务器内部错误 |

---

## 9. 调试与排错

### 9.1 PowerShell 跑通完整流程

```powershell
$base   = "http://127.0.0.1:3001"
$origin = "http://localhost:5173"

# 注册（-SessionVariable 自动保存 Cookie）
$reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" `
  -Headers @{ Origin = $origin } -ContentType "application/json" `
  -Body (@{ username = "demo_user"; password = "Daybook2026"; acceptedTerms = $true } | ConvertTo-Json) `
  -SessionVariable sess
$reg.recoveryCode           # 形如 K7QM-3XPZ，只出现这一次

# 会话
Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $sess | ConvertTo-Json -Depth 5

# 推送一条支出（23.50 元 = 2350 分）
$body = @{
  deviceId = "dev-test"
  transactions = @(@{
    id = "t_" + [guid]::NewGuid().ToString("N").Substring(0,8)
    type = "expense"; amount = 2350; currency = "CNY"
    categoryId = "c_food"; parentCategoryId = $null
    accountId = "a_cash"; toAccountId = $null
    occurredAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    note = "午饭"
    createdAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    updatedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    deletedAt = $null; source = "manual"
  })
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri "$base/api/sync/push" `
  -Headers @{ Origin = $origin; "X-Device-Id" = "dev-test" } `
  -ContentType "application/json" -Body $body -WebSession $sess

# 拉取
Invoke-RestMethod -Uri "$base/api/sync/pull?cursor=0&limit=10" -WebSession $sess | ConvertTo-Json -Depth 6
```

> 注意：`Invoke-RestMethod` 遇到 4xx 会抛异常，要看响应体请用 `-SkipHttpErrorCheck`（PS 7+）或 `try/catch { $_.ErrorDetails.Message }`。

### 9.2 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 403 `MISSING_OR_NULL_ORIGIN` | 调了 better-auth 原生端点且没带 `Origin` | 手测时加 `Origin: http://localhost:5173` |
| 浏览器报 CORS 错误 | 前端来源不在 `WEB_ORIGINS` | 改 `.env` 的 `WEB_ORIGINS` 并重启 |
| 401 一直不消失 | Cookie 没带 | 前端 `credentials: 'include'`；手测用 `-WebSession` |
| 登录总是 429 | 触发了用户名锁定/IP 限流 | 等 15 分钟，或换 `X-Forwarded-For`（仅本地调试） |
| 同步后别的设备看不到 | 客户端游标用了时间戳，或云端 seq 未重新分配 | 游标必须是 `/pull` 返回的 `cursor` |
| 改了记录另一台没更新 | 服务器判定旧版本 | 检查 `updatedAt` 是否随修改递增 |
| 已删的记录又出现 | 客户端未实现「同分墓碑胜」 | 用 `@daybook/shared` 的 `resolveLWW` / `mergeTransactions` |
| 启动报 `table xxx already exists` | 手改过迁移文件但 `_journal.json` 的 `when` 未同步 | 把 `when` 改成库中 `__drizzle_migrations.created_at` |
| 想看云端到底存了什么 | — | `pnpm db:inspect`，或 `pnpm db:studio` 起 Drizzle Studio |

### 9.3 环境变量（影响接口行为的部分）

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` / `HOST` | `3001` / `127.0.0.1` | 监听地址 |
| `DATABASE_URL` | `file:./data/daybook.sqlite` | SQLite 文件 |
| `BETTER_AUTH_SECRET` | 以 `dev-only` 开头的开发密钥 | 会话签名，**生产必须改** |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3001` | 对外基址（生成重置链接） |
| `WEB_ORIGINS` | 本地 5173/4173 | CORS + trustedOrigins 白名单，逗号分隔 |
| `EXPOSE_DEV_AUTH` | 非生产 `true` | 是否在响应里返回 `devResetToken`，**生产必须为 0** |
| `MAX_PUSH_BATCH` | `2000` | 单次 push 条数上限 |

完整清单见 `apps/api/.env.example`。

---

## 附：接口速查

| 方法 | 路径 | 鉴权 | 一句话 |
|---|---|---|---|
| GET | `/api/health` | — | 健康检查 |
| POST | `/api/auth/register` | — | 注册，返回恢复码 |
| GET | `/api/auth/check-username` | — | 用户名查重 |
| POST | `/api/auth/login` | — | 登录（含风控） |
| POST | `/api/auth/logout` | ✅ | 登出 |
| GET | `/api/auth/session` | — | 当前会话 |
| POST | `/api/auth/change-password` | ✅ | 改密并踢掉其他设备 |
| GET | `/api/auth/sessions` | ✅ | 设备列表 |
| DELETE | `/api/auth/sessions/:id` | ✅ | 下线指定设备 |
| POST | `/api/auth/forgot-password` | — | 发起找回 |
| POST | `/api/auth/reset-password` | — | 用令牌/恢复码重置 |
| POST | `/api/auth/recovery-code` | ✅ | 重新生成恢复码 |
| GET | `/api/data` | ✅ | 拉完整账本（前端主路径） |
| POST | `/api/data/transactions` | ✅ | 实时 upsert 流水 |
| PUT | `/api/data/state` | ✅ | 保存分类/账户/预算/偏好 |
| DELETE | `/api/data/transactions` | ✅ | 清空流水 |
| POST | `/api/data/reset` | ✅ | 恢复出厂 |
| POST | `/api/data/replace` | ✅ | 用备份整体替换 |
| POST | `/api/sync/push` | ✅ | 推送变更（旧协议） |
| GET | `/api/sync/pull` | ✅ | 按游标拉取（旧协议） |

---

## 10. 管理后台接口（`/api/admin/*`）

> 代码：`apps/api/src/routes/admin.ts`；鉴权中间件：`apps/api/src/lib/admin-guard.ts`；前端：`apps/admin`（同域 `/admin/`）。

### 10.1 前提与约定

- 后台使用**独立账号体系**：`admin_user` / `admin_session` 表 + HttpOnly Cookie `daybook_admin_session`。
  前台 App 注册的 `user` 账号**不能**登录后台；`user.role` 不再参与后台鉴权（服务启动时会把旧的 `role=admin` 迁移成独立后台账号并降权）。
  - 未登录 / 会话过期 / 账号被停用 → `401 { code:"UNAUTHORIZED" }`
  - 配了 `ADMIN_IP_ALLOWLIST` 且 IP 不在白名单 → `403 { code:"IP_FORBIDDEN" }`
- 管理员账号由 `pnpm admin:create` 或后台「管理员账号」页创建，与前台用户名互不影响（可以同名）。
- 后台登录同样有风控：连续 5 次失败锁 15 分钟；同一 IP 每小时最多 20 次尝试。
- 列表统一游标分页：`{ data: [...], nextCursor: string | null }`；`nextCursor` 为 `null` 表示到底。
- **邮箱脱敏**：`ab***@x.com`；内部占位邮箱（`*@daybook.local`）返回 `null`。
- **敏感字段红线**：响应里永远不会出现 `account.password`、`admin_user.password_hash`、`admin_session.token_hash`、`user_recovery.code_hash`、`session.token`、`password_reset.token_hash`。
- **写操作必留痕**：封禁、解封、强制下线、流水软删/恢复、管理员新建/改密/停用/删除都会写 `admin_audit_log`。

### 10.2 后台登录与管理员账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/auth/login` | body `{ username, password, rememberMe? }`。**独立登录**，不经过 better-auth；成功写 `daybook_admin_session` |
| POST | `/api/admin/auth/logout` | 销毁当前后台会话并清 Cookie |
| GET | `/api/admin/auth/me` | 当前后台管理员；未登录 401（前端守卫用） |
| POST | `/api/admin/auth/me/password` | body `{ currentPassword, newPassword }`；成功后吊销本人全部会话并重新签发 |
| GET | `/api/admin/auth/accounts` | 管理员列表（不含前台用户），带 `isSelf` |
| POST | `/api/admin/auth/accounts` | 新建管理员 `{ username, password, name? }` |
| POST | `/api/admin/auth/accounts/:id/password` | 重置某管理员密码；其全部会话立即失效 |
| POST | `/api/admin/auth/accounts/:id/status` | body `{ status: "active" \| "disabled" }`；不能停用自己，至少保留一个可用管理员 |
| DELETE | `/api/admin/auth/accounts/:id` | 删除管理员；不能删自己，至少保留一个可用管理员 |
| GET | `/api/admin/whoami` | 兼容保留，等价于 `/api/admin/auth/me` |

账号规则：用户名 3–20 位字母/数字/`_`/`-`；密码至少 8 位且同时含字母和数字。

### 10.3 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/overview` | 前台用户数 / 后台管理员数 / 封禁数 / 流水数 / 今日新增（含今日收支金额）/ 7 日活跃会话 / 设备数 / 最近写入时间 / 近 7 日趋势 |

`overview` 响应示例：

```json
{
  "data": {
    "users": 27, "admins": 2, "banned": 1,
    "transactions": 69, "liveTransactions": 62,
    "todayTransactions": 25, "todayExpense": 12800, "todayIncome": 0,
    "lastWriteAt": 1793862629821,
    "activeSessions7d": 25, "devices": 7,
    "trend": [{ "day": "2026-11-04", "count": 25 }]
  }
}
```

> 后台所有数字都直接读云端的 `ledger_transactions` / `user_state`——也就是前台 `/api/data` 写入的同一份数据。
> 前台一改动，后台刷新（概览页默认 15 秒自动刷新）即可看到，不再存在「前台记了账、后台还是 0」的两套库。

### 10.4 用户管理（前台用户）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 列表。参数：`q`（用户名/显示名/邮箱模糊搜，不区分大小写）、`banned=0\|1`、`sort=created\|lastLogin`、`cursor`、`limit`(≤100)。每条附带该用户的流水概况 `transactions: { total, live, lastOccurredAt }` |
| GET | `/api/admin/users/:id` | 详情：资料、会话、同步设备、流水统计、`user_state` 体积、**账本结构 `ledger`（分类 / 账户 / 预算 / 偏好）**、最近 10 条流水（含分类名 / 账户名 / 备注） |
| POST | `/api/admin/users/:id/ban` | 封禁。body `{ reason?, expiresIn? }`（`expiresIn` 单位秒）。**同时删除该用户全部会话** |
| POST | `/api/admin/users/:id/unban` | 解封（清 `banned` / `banReason` / `banExpires`，`status` 回 `active`） |
| POST | `/api/admin/users/:id/revoke-sessions` | 强制下线（删除全部会话，账本数据不动） |

> 账本结构来自该用户的 `user_state.payload`，与前台的分类管理 / 账户管理 / 预算设置完全同源；后台只读展示，不替用户改账本。

> 后台管理员在「管理员账号」页单独管理，**不再**通过给前台用户提权来获得后台权限；原 `/api/admin/users/:id/role` 已移除。

封禁为什么能拦住登录：better-auth 的 `admin` 插件在**创建会话**时检查 `user.banned`，命中即抛 `BANNED_USER`；已登录设备则靠删除 `session` 立即失效。

### 10.5 流水审计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/transactions` | 参数：`userId`、`from`/`to`（毫秒或 ISO 字符串）、`type`、`minAmount`/`maxAmount`（**分**）、`categoryId`、`includeDeleted=1`、`cursor`、`limit`(≤200)。返回 `categoryName` / `parentCategoryName` / `accountName` / `note`，与前台展示一致 |
| GET | `/api/admin/transactions/:id` | 详情，含原始 `payload` 与解析后的分类名 / 账户名 / 备注；建议带 `?userId=` 一起定位 |
| POST | `/api/admin/transactions/:id/delete` | 软删：写墓碑 + **重新分配 `seq`** |
| POST | `/api/admin/transactions/:id/restore` | 恢复：清墓碑 + 重新分配 `seq` |

> **为什么必须重新分配 `seq`**：客户端按 `seq > cursor` 拉增量。直接 `UPDATE deleted_at` 不改变 `seq`，其他设备永远拉不到这次变更。
> 重复删除返回 `400 ALREADY_DELETED`，重复恢复返回 `400 NOT_DELETED`，`payload` 损坏返回 `500 BAD_PAYLOAD`。

### 10.6 统计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/stats/totals` | `?from=&to=` → 支出/收入/转账/调整的金额与笔数（只算未删除；转账与调整不计收支） |
| GET | `/api/admin/stats/categories` | `?from=&to=&limit=` → 支出分类 Top，按**分类名合并**（不同用户各有自己的分类 UUID），返回 `amount` / `count` / `share` |
| GET | `/api/admin/stats/daily` | `?from=&to=`（默认最近 30 天）→ 每日 `expense` / `income` / `count` |

统计全部基于 `ledger_transactions` 的**物化列** `amount` / `tx_type` / `category_id`：

```sql
-- 迁移 0002 里已回填历史数据
UPDATE ledger_transactions
SET amount = coalesce(json_extract(payload,'$.amount'), 0),
    tx_type = coalesce(json_extract(payload,'$.type'), 'expense'),
    category_id = json_extract(payload,'$.categoryId');
```

### 10.7 设备 / 审计 / 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/devices` | 同步设备列表（按最后同步倒序，附用户名） |
| GET | `/api/admin/audit` | 操作日志。参数：`action`、`adminId`、`from`/`to`、`cursor`、`limit` |
| GET | `/api/admin/system` | 版本、环境、运行时长、各表行数、最近一次后台操作时间 |

审计 `action` 取值：`user.ban` / `user.unban` / `user.revoke-sessions` / `tx.soft-delete` / `tx.restore` / `admin.create` / `admin.reset-password` / `admin.disable` / `admin.enable` / `admin.delete` / `admin.change-own-password`。

### 10.8 进后台的最小步骤

后台账号是**独立表**，与前台 App 账号无关。首次部署或忘记密码时在服务器/本地执行：

```powershell
# 从仓库根目录（脚本会自动跑迁移；已存在则只提示、不改密码）
pnpm admin:create -- <用户名> <密码>

# 等价：进入 apps/api 后直接跑
pnpm -F @daybook/api admin:create -- <用户名> <密码>
```

> 服务器的 `.env` 不会被自动读取。生产环境要带上环境变量：
> `cd /opt/daybook/daybook/apps/api && set -a && . ./.env && set +a && npx tsx src/scripts/create-admin.ts <用户名> <密码>`
>
> 已登录的后台管理员也可以直接在「管理员账号」页新建其他管理员，无需登录服务器。

开发期只从 5173 进入：`/admin/*` 由 web 的 dev server 反向代理到 admin 的 5174，两个应用同源，
Cookie 与 `WEB_ORIGINS` 都按 5173 一套口径，不需要为后台单独配置。

### 10.9 PowerShell 调试

```powershell
# 后台独立登录（注意：不是 /api/auth/login）
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/admin/auth/login -Method Post -WebSession $s `
  -ContentType application/json -Headers @{ Origin = "http://localhost:5173" } `
  -Body '{"username":"admin","password":"<你的后台密码>"}'

# 当前管理员
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/admin/auth/me -WebSession $s

# 新建管理员
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/admin/auth/accounts -Method Post -WebSession $s `
  -ContentType application/json -Headers @{ Origin = "http://localhost:5173" } `
  -Body '{"username":"ops","password":"OpsPass12345","name":"运营"}'

# 概览
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/admin/overview -WebSession $s

# 封禁（写操作会记审计日志）
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/admin/users/<userId>/ban -Method Post -WebSession $s `
  -ContentType application/json -Headers @{ Origin = "http://localhost:5173" } `
  -Body '{"reason":"测试封禁"}'
```
