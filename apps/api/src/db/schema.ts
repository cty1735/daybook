/* 数据库表结构（业务侧）
   认证相关表由 better-auth CLI 生成，见 ./auth-schema.ts */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 流水表：一行一条记录，payload 存完整 Transaction JSON。
 * - seq         每个用户一条单调递增的逻辑同步序号，每次被接受的写入都会重新分配，
 *               这样「就地更新」也能被其他设备拉到（不能只靠自增主键）
 * - user_id+id  唯一，保证客户端 UUID 幂等 upsert
 * - updated_at / deleted_at 用于 Last-Write-Wins 与墓碑判定
 * - amount / tx_type / category_id 是 payload 的物化列：运营后台要按金额区间、
 *   类型、分类做 SQL 聚合，json_extract 全表扫且无法走索引。只在 sync-service 写入。
 */
export const ledgerTransactions = sqliteTable(
  "ledger_transactions",
  {
    key: integer("key").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    payload: text("payload").notNull(),
    seq: integer("seq").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    occurredAt: integer("occurred_at").notNull(),
    /** 物化：金额（分），adjustment 为带符号差额 */
    amount: integer("amount").notNull().default(0),
    /** 物化：expense / income / transfer / adjustment */
    txType: text("tx_type").notNull().default("expense"),
    /** 物化：二级分类 id（无二级时为一级分类） */
    categoryId: text("category_id"),
  },
  (t) => [
    uniqueIndex("ledger_tx_user_id_uq").on(t.userId, t.id),
    index("ledger_tx_user_seq_ix").on(t.userId, t.seq),
    index("ledger_tx_occurred_ix").on(t.occurredAt),
    index("ledger_tx_type_ix").on(t.txType),
  ],
);

/**
 * 用户级状态：分类 / 账户 / 预算 / 偏好整包，按 updatedAt 做整包 LWW。
 * 数据量很小（几十 KB），整包覆盖比字段级合并简单且足够。
 */
export const userState = sqliteTable("user_state", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 设备列表：用于「我的设备」展示与冲突排查 */
export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    pushes: integer("pushes").notNull().default(0),
    pulls: integer("pulls").notNull().default(0),
  },
  (t) => [index("devices_user_ix").on(t.userId)],
);

/** 开发期便利表（历史遗留：v1.2 改用用户名+密码后不再写入，保留以兼容旧库迁移） */
export const devOtp = sqliteTable("dev_otp", {
  email: text("email").primaryKey(),
  otp: text("otp").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * 后台审计日志：只插不改不删。
 * 封禁 / 解封 / 授权 / 强制下线 / 流水软删与恢复 等写操作都必须留痕。
 */
export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").notNull(),
    /** 冗余管理员用户名：改名/注销后仍可追溯 */
    adminName: text("admin_name").notNull(),
    /** user.ban / user.unban / user.role / user.revoke-sessions / tx.soft-delete / tx.restore */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    /** JSON：变更前/后摘要（不含任何密钥、哈希、令牌） */
    detail: text("detail"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("admin_audit_created_ix").on(t.createdAt)],
);
