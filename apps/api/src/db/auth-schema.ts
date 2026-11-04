/* better-auth 认证表（SQLite / Drizzle）
   与 better-auth 1.7 核心模型对应：user / session / account / verification。
   日期列用 integer(timestamp_ms)，符合 better-auth 对 SQLite 的期望。

   v1.2（F0 账号体系）新增：
   - user.username / display_username：username 插件使用（username 为小写归一化后的唯一值）
   - user.last_login_at：最近登录时间
   - user_recovery：恢复码哈希（单独存表，避免随 getSession 的 user 对象回传给前端）
   - login_attempt / login_ip：登录失败计数、锁定与 IP 限流
   - password_reset：邮箱找回密码的一次性令牌（只存 SHA-256） */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  /** 归一化后的用户名（小写），唯一；登录与查重都用它 */
  username: text("username").unique(),
  /** 用户注册时输入的原始大小写，仅用于展示 */
  displayUsername: text("display_username"),
  /** active / locked / disabled（本期只写 active） */
  status: text("status").notNull().default("active"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_ix").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_id_ix").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("verification_identifier_ix").on(t.identifier)],
);

/** 恢复码：注册时发放一次，只存 SHA-256 哈希 */
export const userRecovery = sqliteTable("user_recovery", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** 按用户名统计连续失败次数（锁定 15 分钟），与用户是否存在无关，避免枚举 */
export const loginAttempt = sqliteTable("login_attempt", {
  username: text("username").primaryKey(),
  failed: integer("failed").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  lastAt: integer("last_at", { mode: "timestamp_ms" }).notNull(),
});

/** 按 IP 的登录尝试限流（20 次 / 小时） */
export const loginIp = sqliteTable("login_ip", {
  ip: text("ip").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
});

/** 邮箱找回密码的一次性令牌（15 分钟有效） */
export const passwordReset = sqliteTable(
  "password_reset",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("password_reset_user_ix").on(t.userId)],
);

export const authSchema = {
  user,
  session,
  account,
  verification,
  userRecovery,
  loginAttempt,
  loginIp,
  passwordReset,
};

export type AuthUser = typeof user.$inferSelect;
export type AuthSession = typeof session.$inferSelect;
