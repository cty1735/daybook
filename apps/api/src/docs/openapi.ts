/* OpenAPI 3.0 描述（在线接口文档 /api/docs 的数据源）
   手写而非从代码生成：账号路由是 Hono 原生 handler，类型里拿不到结构化元数据，
   与其上 @hono/zod-openapi 重写一遍路由，不如直接维护这份与 docs/API.md 对齐的规范。
   改动接口时：这里、docs/API.md、tests/api-e2e.mjs 三处要一起改。 */

const jsonBody = (schema: unknown, example?: unknown) => ({
  required: true,
  content: {
    "application/json": {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});

const okJson = (description: string, schema: unknown, example?: unknown) => ({
  description,
  content: {
    "application/json": {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});

const fail = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const userRef = { $ref: "#/components/schemas/User" };
const errorRef = { $ref: "#/components/schemas/Error" };
const transactionRef = { $ref: "#/components/schemas/Transaction" };
const userStateRef = { $ref: "#/components/schemas/UserState" };

const EXAMPLE_USER = {
  id: "u_7Kd2mQ9xLp",
  username: "demo_user",
  displayUsername: "Demo_User",
  email: null,
  emailVerified: false,
  createdAt: 1793780000000,
};

const EXAMPLE_TX = {
  id: "t_9f8e7d6c",
  type: "expense",
  amount: 2350,
  currency: "CNY",
  categoryId: "c_food",
  parentCategoryId: null,
  accountId: "a_cash",
  toAccountId: null,
  occurredAt: 1793779200000,
  note: "午饭",
  createdAt: 1793779200000,
  updatedAt: 1793779300000,
  deletedAt: null,
  source: "manual",
};

const EXAMPLE_STATE = {
  categories: [],
  accounts: [],
  budget: { period: "monthly", startDay: 1, totalAmount: 0, categoryLimits: {}, rollover: false },
  settings: { theme: "system", usageStats: true },
  categoryUsage: {},
  lastUsedCategoryId: null,
  lastUsedAccountId: null,
};

/* ------------------------- 管理后台路径 -------------------------
   统一约定：
   - 全部需要 Cookie 会话且 user.role 含 admin，否则 401 / 403
   - 列表接口用游标分页，返回 { data, nextCursor }
   - 写操作（封禁/解封/授权/强制下线/软删/恢复）都会写 admin_audit_log */
const adminOk = (description: string, example?: unknown) =>
  okJson(description, { type: "object", properties: { data: { type: "object" } } }, example);

const adminFail = (description: string) => ({
  description,
  content: { "application/json": { schema: errorRef } },
});

const adminTag = ["后台"];

const adminPaths = {
  "/api/admin/whoami": {
    get: {
      tags: adminTag,
      operationId: "adminWhoami",
      summary: "当前管理员身份",
      description: "前端守卫用；非管理员返回 403。",
      security: [{ cookieAuth: [] }],
      responses: {
        200: adminOk("管理员身份", { data: { id: "u_x", username: "demo_admin", displayUsername: "Demo_Admin", role: "admin" } }),
        401: adminFail("未登录（UNAUTHORIZED）"),
        403: adminFail("无后台权限（FORBIDDEN / BANNED_USER / IP_FORBIDDEN）"),
      },
    },
  },
  "/api/admin/overview": {
    get: {
      tags: adminTag,
      operationId: "adminOverview",
      summary: "概览指标",
      description: "用户数、流水数、今日新增、7 日活跃会话、设备数、近 7 日流水趋势。",
      security: [{ cookieAuth: [] }],
      responses: {
        200: adminOk("指标", { data: { users: 27, admins: 1, banned: 0, transactions: 69, liveTransactions: 62, todayTransactions: 25, activeSessions7d: 25, devices: 7, trend: [{ day: "2026-11-04", count: 25 }] } }),
        401: adminFail("未登录"),
        403: adminFail("无后台权限"),
      },
    },
  },
  "/api/admin/users": {
    get: {
      tags: adminTag,
      operationId: "adminListUsers",
      summary: "用户列表",
      description:
        "支持 `q`（用户名/显示名/邮箱模糊搜）、`role`（admin/user）、`banned`（0/1）、`sort`（created/lastLogin）、`cursor`、`limit`。\n\n邮箱按 `ab***@x.com` 脱敏；内部占位邮箱（`*@daybook.local`）返回 null。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "role", in: "query", schema: { type: "string", enum: ["admin", "user"] } },
        { name: "banned", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["created", "lastLogin"] } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 100 } },
      ],
      responses: {
        200: okJson("用户分页", {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/AdminUser" } },
            nextCursor: { type: "string", nullable: true },
          },
        }),
        401: adminFail("未登录"),
        403: adminFail("无后台权限"),
      },
    },
  },
  "/api/admin/users/{id}": {
    get: {
      tags: adminTag,
      operationId: "adminGetUser",
      summary: "用户详情",
      description: "资料、会话、同步设备、流水统计、user_state 体积与最近 10 条流水。",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: adminOk("用户详情"),
        404: adminFail("用户不存在（NOT_FOUND）"),
        401: adminFail("未登录"),
        403: adminFail("无后台权限"),
      },
    },
  },
  "/api/admin/users/{id}/ban": {
    post: {
      tags: adminTag,
      operationId: "adminBanUser",
      summary: "封禁用户",
      description:
        "写 `banned=true` + 原因/到期时间，并**立即删除该用户全部会话**。\n\n封禁由 better-auth admin 插件在创建会话时拦截，因此封禁后无法登录。写操作会记入审计日志。",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: jsonBody(
        { type: "object", properties: { reason: { type: "string", maxLength: 200 }, expiresIn: { type: "integer", description: "秒" } } },
        { reason: "批量灌水", expiresIn: 86400 },
      ),
      responses: {
        200: adminOk("已封禁", { data: { ok: true } }),
        400: adminFail("不能封禁自己（SELF_TARGET）"),
        404: adminFail("用户不存在"),
      },
    },
  },
  "/api/admin/users/{id}/unban": {
    post: {
      tags: adminTag,
      operationId: "adminUnbanUser",
      summary: "解封用户",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: adminOk("已解封", { data: { ok: true } }),
        404: adminFail("用户不存在"),
      },
    },
  },
  "/api/admin/users/{id}/role": {
    post: {
      tags: adminTag,
      operationId: "adminSetRole",
      summary: "授予 / 撤销管理员",
      description: "只能设为 `admin` 或 `user`；不能撤销自己的管理员权限。",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: jsonBody(
        { type: "object", properties: { role: { type: "string", enum: ["admin", "user"] } }, required: ["role"] },
        { role: "admin" },
      ),
      responses: {
        200: adminOk("已变更", { data: { ok: true, role: "admin" } }),
        400: adminFail("非法角色（INVALID_ROLE）/ 不能撤销自己（SELF_TARGET）"),
        404: adminFail("用户不存在"),
      },
    },
  },
  "/api/admin/users/{id}/revoke-sessions": {
    post: {
      tags: adminTag,
      operationId: "adminRevokeSessions",
      summary: "强制下线",
      description: "删除该用户全部会话，用户需重新登录。",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: adminOk("已下线", { data: { ok: true } }),
        404: adminFail("用户不存在"),
      },
    },
  },
  "/api/admin/transactions": {
    get: {
      tags: adminTag,
      operationId: "adminListTransactions",
      summary: "流水审计列表",
      description:
        "按 `userId`、`from`/`to`（毫秒或 ISO）、`type`、`minAmount`/`maxAmount`（分）、`categoryId` 筛选；默认不含墓碑，`includeDeleted=1` 可含。\n\n金额/类型/分类是 `payload` 的物化列，聚合与筛选走索引。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "userId", in: "query", schema: { type: "string" } },
        { name: "from", in: "query", schema: { type: "string" } },
        { name: "to", in: "query", schema: { type: "string" } },
        { name: "type", in: "query", schema: { type: "string", enum: ["expense", "income", "transfer", "adjustment"] } },
        { name: "minAmount", in: "query", schema: { type: "integer" } },
        { name: "maxAmount", in: "query", schema: { type: "integer" } },
        { name: "categoryId", in: "query", schema: { type: "string" } },
        { name: "includeDeleted", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 200 } },
      ],
      responses: {
        200: okJson("流水分页", {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/AdminTransaction" } },
            nextCursor: { type: "string", nullable: true },
          },
        }),
      },
    },
  },
  "/api/admin/transactions/{id}": {
    get: {
      tags: adminTag,
      operationId: "adminGetTransaction",
      summary: "流水详情（含原始 payload）",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "userId", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: adminOk("流水详情"),
        404: adminFail("流水不存在（NOT_FOUND）"),
      },
    },
  },
  "/api/admin/transactions/{id}/delete": {
    post: {
      tags: adminTag,
      operationId: "adminSoftDeleteTransaction",
      summary: "软删流水",
      description:
        "写入墓碑 `deletedAt` 并**分配新的 seq**——直接 UPDATE 不会触发设备按 `seq>cursor` 拉取，这是必须新 seq 的原因。操作可恢复，会记入审计日志。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "userId", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: adminOk("已删除", { data: { ok: true, seq: 20 } }),
        400: adminFail("已是删除状态（ALREADY_DELETED）"),
        404: adminFail("流水不存在"),
        500: adminFail("payload 损坏（BAD_PAYLOAD）"),
      },
    },
  },
  "/api/admin/transactions/{id}/restore": {
    post: {
      tags: adminTag,
      operationId: "adminRestoreTransaction",
      summary: "恢复流水",
      description: "清除墓碑并分配新的 seq，设备下次同步会重新看到该记录。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "userId", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: adminOk("已恢复", { data: { ok: true, seq: 21 } }),
        400: adminFail("未被删除（NOT_DELETED）"),
        404: adminFail("流水不存在"),
      },
    },
  },
  "/api/admin/stats/totals": {
    get: {
      tags: adminTag,
      operationId: "adminStatsTotals",
      summary: "全站收支总额",
      description: "只统计未删除流水；transfer/adjustment 单独返回，不计入收支。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "from", in: "query", schema: { type: "string" } },
        { name: "to", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: adminOk("收支汇总", {
          data: {
            expense: { amount: 932800, count: 44 },
            income: { amount: 3840000, count: 3 },
            transfer: { amount: 0, count: 0 },
            adjustment: { amount: 0, count: 0 },
          },
        }),
      },
    },
  },
  "/api/admin/stats/categories": {
    get: {
      tags: adminTag,
      operationId: "adminStatsCategories",
      summary: "支出分类分布",
      description: "按分类名合并同名分类（不同用户各有自己的分类 UUID），返回金额、笔数与占比。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "from", in: "query", schema: { type: "string" } },
        { name: "to", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 15, maximum: 50 } },
      ],
      responses: {
        200: okJson("分类分布", {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/AdminCategoryStat" } },
            total: { type: "integer" },
          },
        }),
      },
    },
  },
  "/api/admin/stats/daily": {
    get: {
      tags: adminTag,
      operationId: "adminStatsDaily",
      summary: "日趋势",
      description: "默认最近 30 天；按日返回支出、收入与笔数。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "from", in: "query", schema: { type: "string" } },
        { name: "to", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: adminOk("日趋势", { data: [{ day: "2026-11-04", expense: 932800, income: 3840000, count: 25 }] }),
      },
    },
  },
  "/api/admin/devices": {
    get: {
      tags: adminTag,
      operationId: "adminListDevices",
      summary: "同步设备列表",
      description: "按最后同步时间倒序，附带用户名。",
      security: [{ cookieAuth: [] }],
      parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 100 } }],
      responses: { 200: adminOk("设备列表") },
    },
  },
  "/api/admin/audit": {
    get: {
      tags: adminTag,
      operationId: "adminListAudit",
      summary: "操作日志",
      description: "只增不改不删；可按 `action`、`adminId`、`from`/`to` 筛选。",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "action", in: "query", schema: { type: "string" } },
        { name: "adminId", in: "query", schema: { type: "string" } },
        { name: "from", in: "query", schema: { type: "string" } },
        { name: "to", in: "query", schema: { type: "string" } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 30, maximum: 100 } },
      ],
      responses: {
        200: okJson("操作日志分页", {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/AdminAuditLog" } },
            nextCursor: { type: "string", nullable: true },
          },
        }),
      },
    },
  },
  "/api/admin/system": {
    get: {
      tags: adminTag,
      operationId: "adminSystem",
      summary: "系统信息",
      description: "版本、环境、运行时长、各表行数与最近一次后台操作时间。",
      security: [{ cookieAuth: [] }],
      responses: { 200: adminOk("系统信息") },
    },
  },
};

export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "日账 DayBook · 后端 API",
    version: "1.0.0",
    summary: "本地优先记账应用的账号与增量同步服务",
    description: [
      "## 这是什么",
      "DayBook 后端只做两件事：**账号体系**（注册/登录/登出/改密/找回/设备管理）与 **增量同步**（push/pull）。",
      "账目数据默认存在浏览器 IndexedDB 里，服务端只保存原样 JSON payload 与同步游标，不做业务计算。",
      "",
      "## 约定",
      "- 鉴权：**HttpOnly Cookie 会话**（`better-auth.session_token`），不传 Bearer Token。",
      "- 金额：整数「分」；时间：epoch 毫秒。",
      "- 错误：`{ message, code? }`；同步接口的参数错误额外带 `issues`。",
      "",
      "## 在线调试",
      "本页与 API 同源（`/api/docs` → `/api/*`），先调 `POST /api/auth/register` 或 `POST /api/auth/login` 建立 Cookie，后续请求会自动带上。",
      "若浏览器策略导致 Cookie 未携带，请改用 `docs/API.md` 里的 PowerShell 脚本。",
    ].join("\n"),
  },
  servers: [
    { url: "http://127.0.0.1:3001", description: "本地开发" },
    { url: "http://localhost:3001", description: "本地开发（localhost）" },
  ],
  tags: [
    { name: "系统", description: "健康检查" },
    { name: "账号", description: "注册 / 登录 / 会话 / 设备 / 找回密码" },
    { name: "同步", description: "增量推送与拉取（需登录）" },
    { name: "后台", description: "管理后台（需 admin 角色）" },
  ],
  security: [],
  paths: {
    "/api/health": {
      get: {
        tags: ["系统"],
        operationId: "getHealth",
        summary: "健康检查",
        description: "无需登录。前端「云同步」页用它显示后端连通性。",
        responses: {
          200: okJson("服务正常", { $ref: "#/components/schemas/Health" }, { ok: true, version: "1.0.0", time: 1793780000000 }),
        },
      },
    },

    "/api/auth/register": {
      post: {
        tags: ["账号"],
        operationId: "register",
        summary: "注册",
        description:
          "注册成功即登录（`Set-Cookie`），并返回**只出现一次**的 8 位恢复码。\n\n" +
          "用户名 3–20 位，仅字母/数字/`_`/`-`，不区分大小写，禁纯数字与保留字；" +
          "密码 8–64 位且必须字母+数字，不得与用户名相同或编辑距离 ≤2，拦截常见弱密码。\n\n" +
          "未填邮箱时服务端会写入内部占位邮箱（`xxx@daybook.local`），不会出现在响应里。",
        requestBody: jsonBody(
          { $ref: "#/components/schemas/RegisterRequest" },
          { username: "demo_user", password: "Demo2026Pass", email: "demo@example.com", acceptedTerms: true },
        ),
        responses: {
          200: okJson(
            "注册成功",
            {
              type: "object",
              properties: { user: userRef, recoveryCode: { type: "string", example: "K7QM-3XPZ" } },
              required: ["user", "recoveryCode"],
            },
            { user: EXAMPLE_USER, recoveryCode: "K7QM-3XPZ" },
          ),
          400: fail("参数不合法（INVALID_USERNAME / WEAK_PASSWORD / TERMS_REQUIRED / INVALID_EMAIL）"),
          409: fail("冲突（USERNAME_TAKEN / EMAIL_TAKEN）"),
        },
      },
    },

    "/api/auth/check-username": {
      get: {
        tags: ["账号"],
        operationId: "checkUsername",
        summary: "用户名可用性",
        description: "注册页失焦时调用。不合规或已占用都返回 200，用 `available` 判断。",
        parameters: [
          { name: "username", in: "query", required: true, schema: { type: "string" }, example: "demo_user" },
        ],
        responses: {
          200: okJson(
            "查询结果",
            {
              type: "object",
              properties: { available: { type: "boolean" }, message: { type: "string" } },
              required: ["available", "message"],
            },
            { available: true, message: "用户名可用" },
          ),
        },
      },
    },

    "/api/auth/login": {
      post: {
        tags: ["账号"],
        operationId: "login",
        summary: "登录",
        description:
          "用户名大小写不敏感。\n\n" +
          "风控：同一用户名连续 5 次失败锁定 15 分钟；同一 IP 每小时最多 20 次。\n" +
          "失败文案统一为「用户名或密码不正确」，不区分账号是否存在。",
        requestBody: jsonBody(
          { $ref: "#/components/schemas/LoginRequest" },
          { username: "demo_user", password: "Demo2026Pass", rememberMe: true },
        ),
        responses: {
          200: okJson("登录成功", { type: "object", properties: { user: userRef } }, { user: EXAMPLE_USER }),
          400: fail("用户名或密码为空（MISSING_FIELDS）"),
          401: fail("凭据错误（INVALID_CREDENTIALS）"),
          429: fail("账号锁定或 IP 限流（RATE_LIMITED）"),
        },
      },
    },

    "/api/auth/logout": {
      post: {
        tags: ["账号"],
        operationId: "logout",
        summary: "登出",
        description: "只销毁当前会话并清 Cookie，本机账目数据不受影响。",
        security: [{ cookieAuth: [] }],
        responses: {
          200: okJson("已登出", { type: "object", properties: { ok: { type: "boolean" } } }, { ok: true }),
        },
      },
    },

    "/api/auth/session": {
      get: {
        tags: ["账号"],
        operationId: "getSession",
        summary: "当前会话",
        description: "判断登录态的唯一入口。**未登录也返回 200**，此时 `user` 与 `session` 均为 `null`。",
        responses: {
          200: okJson(
            "会话信息（可能为 null）",
            {
              type: "object",
              properties: {
                user: { nullable: true, allOf: [userRef] } as unknown,
                session: {
                  type: "object",
                  nullable: true,
                  properties: { id: { type: "string" }, expiresAt: { type: "integer" } },
                },
              },
            },
            { user: EXAMPLE_USER, session: { id: "s_9Jd2Kx", expiresAt: 1796372000000 } },
          ),
        },
      },
    },

    "/api/auth/change-password": {
      post: {
        tags: ["账号"],
        operationId: "changePassword",
        summary: "修改密码",
        description: "需要旧密码。成功后**撤销其他设备的全部会话**，当前设备保留。",
        security: [{ cookieAuth: [] }],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["currentPassword", "newPassword"],
            properties: {
              currentPassword: { type: "string", format: "password" },
              newPassword: { type: "string", format: "password", minLength: 8, maxLength: 64 },
            },
          },
          { currentPassword: "Demo2026Pass", newPassword: "Fresh2026Start" },
        ),
        responses: {
          200: okJson("修改成功", { type: "object", properties: { ok: { type: "boolean" } } }, { ok: true }),
          400: fail("MISSING_FIELDS / SAME_PASSWORD / WEAK_PASSWORD / INVALID_PASSWORD"),
          401: fail("未登录（UNAUTHORIZED）"),
        },
      },
    },

    "/api/auth/sessions": {
      get: {
        tags: ["账号"],
        operationId: "listSessions",
        summary: "已登录设备",
        description: "返回当前账号的全部会话，`current: true` 表示当前设备。",
        security: [{ cookieAuth: [] }],
        responses: {
          200: okJson(
            "设备列表",
            {
              type: "object",
              properties: { sessions: { type: "array", items: { $ref: "#/components/schemas/DeviceSession" } } },
              required: ["sessions"],
            },
            {
              sessions: [
                {
                  id: "s_9Jd2Kx",
                  device: "Windows · Chrome",
                  ip: "127.0.0.1",
                  lastActive: 1793780000000,
                  createdAt: 1793770000000,
                  expiresAt: 1796372000000,
                  current: true,
                },
              ],
            },
          ),
          401: fail("未登录（UNAUTHORIZED）"),
        },
      },
    },

    "/api/auth/sessions/{id}": {
      delete: {
        tags: ["账号"],
        operationId: "revokeSession",
        summary: "远程下线设备",
        description: "当前设备不能通过此接口下线（请用登出）。",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: okJson("已下线", { type: "object", properties: { ok: { type: "boolean" } } }, { ok: true }),
          400: fail("目标是当前设备（CURRENT_DEVICE）"),
          401: fail("未登录（UNAUTHORIZED）"),
          404: fail("会话不存在或已下线（NOT_FOUND）"),
        },
      },
    },

    "/api/auth/forgot-password": {
      post: {
        tags: ["账号"],
        operationId: "forgotPassword",
        summary: "发起找回密码",
        description:
          "无论账号是否存在都返回同样的文案，防止枚举。\n\n" +
          "已绑邮箱 → 生成 15 分钟一次性令牌（生产环境应发邮件）；未绑邮箱 → 客户端应引导用恢复码。\n\n" +
          "开发环境（`EXPOSE_DEV_AUTH=1`）会把令牌直接放在 `devResetToken` 里。",
        requestBody: jsonBody(
          { type: "object", required: ["username"], properties: { username: { type: "string" } } },
          { username: "demo_user" },
        ),
        responses: {
          200: okJson(
            "已受理",
            {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                message: { type: "string" },
                hasEmail: { type: "boolean", description: "账号是否绑定邮箱" },
                devResetToken: { type: "string", description: "仅开发环境返回" },
              },
              required: ["ok", "message"],
            },
            { ok: true, message: "如果该账号存在，重置方式已发送", hasEmail: true, devResetToken: "9f2c4a7e1b8d3c6a5e0f7b2d4c8a1e3f" },
          ),
        },
      },
    },

    "/api/auth/reset-password": {
      post: {
        tags: ["账号"],
        operationId: "resetPassword",
        summary: "重置密码",
        description:
          "两种方式二选一，`token` 优先：\n\n" +
          "- 邮件令牌：`{ token, newPassword }`\n" +
          "- 恢复码：`{ username, code, newPassword }`（恢复码大小写、分隔符不敏感）\n\n" +
          "成功后**撤销该用户全部会话**。",
        requestBody: jsonBody({ $ref: "#/components/schemas/ResetPasswordRequest" }),
        responses: {
          200: okJson("重置成功", { type: "object", properties: { ok: { type: "boolean" } } }, { ok: true }),
          400: fail("INVALID_TOKEN / INVALID_CODE / MISSING_FIELDS / WEAK_PASSWORD"),
          404: fail("账号不存在（NOT_FOUND）"),
        },
      },
    },

    "/api/auth/recovery-code": {
      post: {
        tags: ["账号"],
        operationId: "regenerateRecoveryCode",
        summary: "重新生成恢复码",
        description: "需登录 + 旧密码校验。新码替换旧码，同样只返回这一次。",
        security: [{ cookieAuth: [] }],
        requestBody: jsonBody(
          { type: "object", required: ["password"], properties: { password: { type: "string", format: "password" } } },
          { password: "Demo2026Pass" },
        ),
        responses: {
          200: okJson(
            "新恢复码",
            {
              type: "object",
              properties: { ok: { type: "boolean" }, recoveryCode: { type: "string" } },
              required: ["ok", "recoveryCode"],
            },
            { ok: true, recoveryCode: "N4RT-8WQK" },
          ),
          400: fail("MISSING_FIELDS / INVALID_PASSWORD"),
          401: fail("未登录（UNAUTHORIZED）"),
        },
      },
    },

    "/api/sync/push": {
      post: {
        tags: ["同步"],
        operationId: "syncPush",
        summary: "推送增量变更",
        description:
          "按 `updatedAt` 做 Last-Write-Wins；时间相等时**墓碑（deletedAt 非空）方胜**，防止已删记录复活。\n\n" +
          "服务端会把 `updatedAt` 夹到 `[0, serverNow + 60s]` 再落库，防止客户端改系统时间。\n\n" +
          "**首次同步**（客户端 `lastSyncedAt === null && cursor === 0`）必须把本机全部记录 + `state` 一次性推上来，" +
          "否则预置/迁移进来的历史数据永远上不了云。",
        security: [{ cookieAuth: [] }],
        requestBody: jsonBody({ $ref: "#/components/schemas/SyncPushRequest" }, {
          deviceId: "dev-1a2b3c",
          cursor: 42,
          transactions: [EXAMPLE_TX],
          state: { payload: EXAMPLE_STATE, updatedAt: 1793779300000 },
        }),
        responses: {
          200: okJson("推送结果", { $ref: "#/components/schemas/SyncPushResult" }, {
            accepted: 1,
            rejected: 0,
            cursor: 43,
            serverTime: 1793779400000,
            stateAccepted: false,
          }),
          400: okJson("参数不合法（Zod issues）", {
            type: "object",
            properties: {
              message: { type: "string" },
              issues: { type: "array", items: { type: "object" }, description: "最多 10 条" },
            },
          }),
          401: okJson("未登录", { type: "object", properties: { message: { type: "string" } } }, { message: "未登录" }),
          413: okJson("单次超过上限", { type: "object", properties: { message: { type: "string" } } }, { message: "单次推送最多 2000 条" }),
        },
      },
    },

    "/api/sync/pull": {
      get: {
        tags: ["同步"],
        operationId: "syncPull",
        summary: "按游标拉取变更",
        description:
          "只返回 `seq > cursor` 的记录，按 `seq` 升序。`hasMore: true` 表示还有下一页，用返回的 `cursor` 继续拉。\n\n" +
          "`seq` 是「每用户逻辑序号」：任何被接受的写入（含就地更新）都会拿到更大的 seq，所以游标只能是这个数字，不能用时间戳。\n\n" +
          "删除以墓碑返回（`deletedAt` 非 null），客户端据此删除本地数据。",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 500 } },
          {
            name: "limitState",
            in: "query",
            description: "是否同时返回用户级状态整包",
            schema: { type: "integer", enum: [0, 1], default: 1 },
          },
        ],
        responses: {
          200: okJson("拉取结果", { $ref: "#/components/schemas/SyncPullResult" }, {
            cursor: 43,
            hasMore: false,
            transactions: [EXAMPLE_TX],
            state: null,
            serverTime: 1793779400000,
          }),
          400: okJson("参数不合法", { type: "object", properties: { message: { type: "string" }, issues: { type: "array", items: { type: "object" } } } }),
          401: okJson("未登录", { type: "object", properties: { message: { type: "string" } } }, { message: "未登录" }),
        },
      },
    },

    /* ------------------------- 管理后台 ------------------------- */
    ...adminPaths,
  },

  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description: "登录后由服务端下发的 HttpOnly Cookie，前端只需 `credentials: 'include'`。",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          message: { type: "string", description: "可直接展示给用户的中文提示" },
          code: { type: "string", description: "机器可读错误码，见 docs/API.md 错误码总表" },
        },
        required: ["message"],
        additionalProperties: true,
      },
      Health: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          version: { type: "string" },
          time: { type: "integer", description: "epoch 毫秒" },
        },
        required: ["ok", "version", "time"],
      },
      User: {
        type: "object",
        description: "对外暴露的用户对象；未绑邮箱时 `email` 为 null（内部占位邮箱不外泄）。",
        properties: {
          id: { type: "string" },
          username: { type: "string", description: "规范化后的用户名（小写），登录用" },
          displayUsername: { type: "string", description: "用户输入的原始大小写，仅展示" },
          email: { type: "string", format: "email", nullable: true },
          emailVerified: { type: "boolean", description: "当前不做邮箱验证，恒为 false" },
          createdAt: { type: "integer", nullable: true, description: "epoch 毫秒" },
        },
        required: ["id", "username", "displayUsername", "email", "emailVerified"],
      },
      RegisterRequest: {
        type: "object",
        required: ["username", "password", "acceptedTerms"],
        properties: {
          username: { type: "string", minLength: 3, maxLength: 20, pattern: "^[A-Za-z0-9_-]+$", example: "demo_user" },
          password: { type: "string", format: "password", minLength: 8, maxLength: 64, example: "Demo2026Pass" },
          email: { type: "string", format: "email", nullable: true, description: "可选，仅用于找回密码" },
          acceptedTerms: { type: "boolean", description: "必须为 true" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", example: "demo_user" },
          password: { type: "string", format: "password", example: "Demo2026Pass" },
          rememberMe: { type: "boolean", default: true },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["newPassword"],
        properties: {
          token: { type: "string", description: "邮件重置令牌（15 分钟有效、一次性）" },
          username: { type: "string", description: "用恢复码重置时必填" },
          code: { type: "string", description: "恢复码，形如 K7QM-3XPZ，大小写与分隔符不敏感" },
          newPassword: { type: "string", format: "password", minLength: 8, maxLength: 64 },
        },
      },
      DeviceSession: {
        type: "object",
        properties: {
          id: { type: "string" },
          device: { type: "string", description: "由 User-Agent 粗解析，如「Windows · Chrome」" },
          ip: { type: "string" },
          lastActive: { type: "integer", nullable: true },
          createdAt: { type: "integer", nullable: true },
          expiresAt: { type: "integer", nullable: true },
          current: { type: "boolean" },
        },
        required: ["id", "device", "current"],
      },
      Transaction: {
        type: "object",
        description: "账目流水。金额为整数「分」；`deletedAt` 非 null 即墓碑。",
        required: [
          "id",
          "type",
          "amount",
          "currency",
          "categoryId",
          "parentCategoryId",
          "accountId",
          "toAccountId",
          "occurredAt",
          "note",
          "createdAt",
          "updatedAt",
          "deletedAt",
          "source",
        ],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64, description: "客户端生成的 UUID，天然幂等" },
          type: { type: "string", enum: ["expense", "income", "transfer", "adjustment"], description: "只有 expense/income 计入收支统计" },
          amount: { type: "integer", description: "「分」，正数；方向由 type 决定" },
          currency: { type: "string", minLength: 1, maxLength: 8, example: "CNY" },
          categoryId: { type: "string", maxLength: 64, nullable: true },
          parentCategoryId: { type: "string", maxLength: 64, nullable: true },
          accountId: { type: "string", minLength: 1, maxLength: 64 },
          toAccountId: { type: "string", maxLength: 64, nullable: true },
          occurredAt: { type: "integer", description: "记账发生时间（epoch ms）" },
          note: { type: "string", maxLength: 200 },
          createdAt: { type: "integer" },
          updatedAt: { type: "integer", description: "LWW 依据" },
          deletedAt: { type: "integer", nullable: true, description: "非 null 即已删除（墓碑）" },
          source: { type: "string", enum: ["manual", "recurring", "import", "adjustment"] },
        },
      },
      Category: {
        type: "object",
        required: ["id", "parentId", "name", "kind", "icon", "color", "sortOrder", "isHidden", "noteTemplate"],
        properties: {
          id: { type: "string", maxLength: 64 },
          parentId: { type: "string", maxLength: 64, nullable: true },
          name: { type: "string", maxLength: 32 },
          kind: { type: "string", enum: ["expense", "income"] },
          icon: { type: "string", maxLength: 32 },
          color: { type: "string", maxLength: 16 },
          sortOrder: { type: "integer" },
          isHidden: { type: "boolean" },
          noteTemplate: { type: "string", maxLength: 64 },
        },
      },
      Account: {
        type: "object",
        required: ["id", "name", "type", "initialBalance", "includeInAssets", "isArchived", "creditLimit"],
        properties: {
          id: { type: "string", maxLength: 64 },
          name: { type: "string", maxLength: 32 },
          type: { type: "string", enum: ["cash", "debit", "credit", "huabei", "wallet", "other"] },
          initialBalance: { type: "integer", description: "「分」" },
          includeInAssets: { type: "boolean" },
          isArchived: { type: "boolean" },
          creditLimit: { type: "integer", description: "「分」" },
        },
      },
      Budget: {
        type: "object",
        required: ["period", "startDay", "totalAmount", "categoryLimits", "rollover"],
        properties: {
          period: { type: "string", enum: ["monthly"] },
          startDay: { type: "integer", minimum: 1, maximum: 28 },
          totalAmount: { type: "integer", description: "「分」" },
          categoryLimits: { type: "object", additionalProperties: { type: "integer" } },
          rollover: { type: "boolean" },
        },
      },
      Settings: {
        type: "object",
        required: ["theme", "usageStats"],
        properties: {
          theme: { type: "string", enum: ["light", "dark", "system"] },
          usageStats: { type: "boolean" },
        },
      },
      UserState: {
        type: "object",
        description: "用户级状态整包（分类 / 账户 / 预算 / 偏好），按 updatedAt 整体 LWW。",
        required: ["categories", "accounts", "budget", "settings", "categoryUsage", "lastUsedCategoryId", "lastUsedAccountId"],
        properties: {
          categories: { type: "array", items: { $ref: "#/components/schemas/Category" } },
          accounts: { type: "array", items: { $ref: "#/components/schemas/Account" } },
          budget: { $ref: "#/components/schemas/Budget" },
          settings: { $ref: "#/components/schemas/Settings" },
          categoryUsage: { type: "object", additionalProperties: { type: "integer" } },
          lastUsedCategoryId: { type: "string", nullable: true },
          lastUsedAccountId: { type: "string", nullable: true },
        },
      },
      SyncPushRequest: {
        type: "object",
        required: ["deviceId"],
        properties: {
          deviceId: { type: "string", minLength: 1, maxLength: 64, description: "设备标识，服务端记录活跃时间与推拉次数" },
          cursor: { type: "integer", minimum: 0, default: 0, description: "保留字段，服务端当前不使用" },
          transactions: { type: "array", items: transactionRef, default: [], maxItems: 2000 },
          state: {
            type: "object",
            properties: { payload: userStateRef, updatedAt: { type: "integer" } },
            required: ["payload", "updatedAt"],
          },
        },
      },
      SyncPushResult: {
        type: "object",
        required: ["accepted", "rejected", "cursor", "serverTime", "stateAccepted"],
        properties: {
          accepted: { type: "integer", description: "被接受写入的条数（LWW 胜出）" },
          rejected: { type: "integer", description: "因本地版本落后被丢弃的条数" },
          cursor: { type: "integer", description: "推送后该用户可见的最大 seq" },
          serverTime: { type: "integer" },
          stateAccepted: { type: "boolean" },
        },
      },
      SyncPullResult: {
        type: "object",
        required: ["cursor", "hasMore", "transactions", "state", "serverTime"],
        properties: {
          cursor: { type: "integer", description: "下一页起点" },
          hasMore: { type: "boolean" },
          transactions: { type: "array", items: transactionRef },
          state: {
            type: "object",
            nullable: true,
            properties: { payload: userStateRef, updatedAt: { type: "integer" } },
          },
          serverTime: { type: "integer" },
        },
      },
      AdminUser: {
        type: "object",
        required: ["id", "username", "role", "banned"],
        properties: {
          id: { type: "string" },
          username: { type: "string" },
          displayUsername: { type: "string" },
          email: { type: "string", nullable: true, description: "脱敏后的邮箱；占位邮箱返回 null" },
          role: { type: "string", enum: ["admin", "user"] },
          banned: { type: "boolean" },
          banReason: { type: "string", nullable: true },
          banExpires: { type: "integer", nullable: true, description: "epoch 毫秒" },
          status: { type: "string" },
          createdAt: { type: "integer", nullable: true },
          lastLoginAt: { type: "integer", nullable: true },
        },
      },
      AdminTransaction: {
        type: "object",
        required: ["id", "userId", "username", "amount", "type", "occurredAt", "deleted", "seq"],
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          username: { type: "string" },
          amount: { type: "integer", description: "金额（分），物化列" },
          type: { type: "string", enum: ["expense", "income", "transfer", "adjustment"] },
          categoryId: { type: "string", nullable: true },
          occurredAt: { type: "integer" },
          updatedAt: { type: "integer" },
          deleted: { type: "boolean" },
          seq: { type: "integer", description: "每用户单调递增同步序号" },
        },
      },
      AdminCategoryStat: {
        type: "object",
        required: ["amount", "count", "share"],
        properties: {
          categoryId: { type: "string", nullable: true },
          categoryName: { type: "string", nullable: true },
          amount: { type: "integer", description: "金额（分）" },
          count: { type: "integer" },
          share: { type: "number", description: "占总支出的比例 0–1" },
        },
      },
      AdminAuditLog: {
        type: "object",
        required: ["id", "adminId", "adminName", "action", "targetType", "createdAt"],
        properties: {
          id: { type: "string" },
          adminId: { type: "string" },
          adminName: { type: "string" },
          action: {
            type: "string",
            enum: ["user.ban", "user.unban", "user.role", "user.revoke-sessions", "tx.soft-delete", "tx.restore"],
          },
          targetType: { type: "string", enum: ["user", "transaction"] },
          targetId: { type: "string", nullable: true },
          detail: { type: "object", nullable: true, description: "变更前/后摘要，不含密钥" },
          ip: { type: "string", nullable: true },
          userAgent: { type: "string", nullable: true },
          createdAt: { type: "integer" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "未登录",
        content: { "application/json": { schema: errorRef } },
      },
    },
  },
} as const;
