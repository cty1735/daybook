/* better-auth 配置：用户名 + 密码（PRD v1.2 F0）
   - 邮箱只作为可选的找回方式，不是登录凭据
   - 登录/注册/风控/恢复码等业务逻辑在 routes/account.ts 里封装
   - 会话：30 天滑动续期（rememberMe=false 时由 better-auth 写会话 Cookie） */

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import * as appSchema from "./db/schema.ts";
import { authSchema } from "./db/auth-schema.ts";
import { db } from "./db/client.ts";
import { env } from "./env.ts";
import { validateUsername } from "./lib/account-rules.ts";

export const auth = betterAuth({
  appName: "日账 DayBook",
  baseURL: env.baseUrl,
  basePath: "/api/auth",
  secret: env.authSecret,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { ...appSchema, ...authSchema },
  }),
  // 用户名 + 密码；邮箱仅用于找回密码
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 64,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  trustedOrigins: env.webOrigins,
  session: {
    // 30 天滑动续期：每 1 天用一次就自动续期
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  // 应用层已按用户名（5 次/15 分钟）与 IP（20 次/小时）做风控，这里关掉库自带限流避免双重误伤
  rateLimit: { enabled: false },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 20,
      immutableUsername: true,
      usernameValidator: (value: string) => validateUsername(value).ok,
    }),
    // 管理后台：user.role 判权 + user.banned 在「创建会话」时拦截（封禁即无法登录）
    // 注意：后台的封禁/授权走 routes/admin.ts 里的直连 DB 实现，插件只负责登录拦截与字段定义
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      bannedUserMessage: "账号已被停用，如有疑问请联系管理员",
    }),
  ],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: env.isProd,
      httpOnly: true,
    },
  },
});

export type Auth = typeof auth;
