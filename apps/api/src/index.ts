/* 服务入口：Hono + @hono/node-server
   启动顺序：跑迁移（幂等）→ 挂载路由 → 监听 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { fileURLToPath } from "node:url";
import { auth } from "./auth.ts";
import { runMigrations } from "./db/migrate.ts";
import { bootstrapAdmins } from "./lib/admin-bootstrap.ts";
import { openapiDocument } from "./docs/openapi.ts";
import { assertProdConfig, env } from "./env.ts";
import { accountRoutes } from "./routes/account.ts";
import { adminAuthRoutes } from "./routes/admin-auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { syncRoutes } from "./routes/sync.ts";

const VERSION = "1.0.0";
/** 静态资源目录（在线接口文档的 HTML 与自托管渲染器） */
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

assertProdConfig();
await runMigrations();
await bootstrapAdmins();

const app = new Hono();

app.use("*", logger());

// CORS：只放行已知前端来源；带 Cookie 必须显式返回来源而不能用 *
app.use(
  "/api/*",
  cors({
    origin: (origin) => (env.webOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ["Content-Type", "X-Device-Id"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, version: VERSION, time: Date.now() }));

// 在线接口文档：/api/docs 渲染 OpenAPI，/api/openapi.json 给工具消费
app.get("/api/openapi.json", (c) => c.json(openapiDocument as unknown as Record<string, unknown>));
app.get("/api/docs", (c) => c.redirect("/api/docs/"));
app.use(
  "/api/docs/*",
  serveStatic({
    root: PUBLIC_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/api\/docs/, "/docs"),
  }),
);

// 账号体系（注册/登录/登出/改密/设备/找回）——必须注册在 better-auth 的 catch-all 之前
app.route("/api/auth", accountRoutes);

// better-auth 其余端点挂在 /api/auth/*
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/sync", syncRoutes);

// 管理后台（/api/admin/*）：独立后台会话校验在每条路由内做
// 注意：/api/admin/auth/* 必须先挂载，它自身负责登录/会话/管理员账号管理
app.route("/api/admin/auth", adminAuthRoutes);
app.route("/api/admin", adminRoutes);

app.notFound((c) => c.json({ message: "接口不存在" }, 404));
app.onError((err, c) => {
  console.error("[daybook] 未捕获错误:", err);
  return c.json({ message: "服务器内部错误" }, 500);
});

const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
  console.log(`[daybook] API 已启动 http://${env.host}:${info.port}（${env.nodeEnv}）`);
  console.log(`[daybook] 接口文档 http://${env.host}:${info.port}/api/docs`);
  if (env.exposeDevAuth) {
    console.log("[daybook] 开发模式：找回密码的令牌会随 /api/auth/forgot-password 响应返回");
  }
});

const shutdown = (signal: string) => {
  console.log(`[daybook] 收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));