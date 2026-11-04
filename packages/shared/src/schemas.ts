/* Zod 校验：前后端共用同一份 schema（PRD §11 可维护性） */

import { z } from "zod";
import type { UserState } from "./types.ts";

export const TxTypeSchema = z.enum(["expense", "income", "transfer", "adjustment"]);
export const TxSourceSchema = z.enum(["manual", "recurring", "import", "adjustment"]);
export const CategoryKindSchema = z.enum(["expense", "income"]);
export const AccountTypeSchema = z.enum(["cash", "debit", "credit", "huabei", "wallet", "other"]);
export const ThemeModeSchema = z.enum(["light", "dark", "system"]);

/** 金额一律以「分」为整数；时间一律为 epoch 毫秒 */
const epochMs = z.number().int().nonnegative();
const epochMsOrNull = z.number().int().nonnegative().nullable();

export const TransactionSchema = z.object({
  id: z.string().min(1).max(64),
  type: TxTypeSchema,
  amount: z.number().int(),
  currency: z.string().min(1).max(8),
  categoryId: z.string().max(64).nullable(),
  parentCategoryId: z.string().max(64).nullable(),
  accountId: z.string().min(1).max(64),
  toAccountId: z.string().max(64).nullable(),
  occurredAt: epochMs,
  note: z.string().max(200),
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMsOrNull,
  source: TxSourceSchema,
});

export const CategorySchema = z.object({
  id: z.string().min(1).max(64),
  parentId: z.string().max(64).nullable(),
  name: z.string().min(1).max(32),
  kind: CategoryKindSchema,
  icon: z.string().max(32),
  color: z.string().max(16),
  sortOrder: z.number().int(),
  isHidden: z.boolean(),
  noteTemplate: z.string().max(64),
});

export const AccountSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  type: AccountTypeSchema,
  initialBalance: z.number().int(),
  includeInAssets: z.boolean(),
  isArchived: z.boolean(),
  creditLimit: z.number().int(),
});

export const BudgetSchema = z.object({
  period: z.literal("monthly"),
  startDay: z.number().int().min(1).max(28),
  totalAmount: z.number().int().nonnegative(),
  categoryLimits: z.record(z.string(), z.number().int()),
  rollover: z.boolean(),
});

export const SettingsSchema = z.object({
  theme: ThemeModeSchema,
  usageStats: z.boolean(),
});

export const AppDataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  accounts: z.array(AccountSchema),
  categories: z.array(CategorySchema),
  transactions: z.array(TransactionSchema),
  budget: BudgetSchema,
  settings: SettingsSchema,
  lastUsedCategoryId: z.string().max(64).nullable(),
  lastUsedAccountId: z.string().max(64).nullable(),
  categoryUsage: z.record(z.string(), z.number().int()),
});

/* --------------------------- 同步协议 --------------------------- */

/** 可整包同步的用户级状态（分类 / 账户 / 预算 / 偏好） */
export const UserStateSchema = z.object({
  categories: z.array(CategorySchema),
  accounts: z.array(AccountSchema),
  budget: BudgetSchema,
  settings: SettingsSchema,
  categoryUsage: z.record(z.string(), z.number().int()),
  lastUsedCategoryId: z.string().max(64).nullable(),
  lastUsedAccountId: z.string().max(64).nullable(),
});

export const SyncPushRequestSchema = z.object({
  deviceId: z.string().min(1).max(64),
  /** 客户端最后一次成功 pull 到的服务端游标 */
  cursor: z.number().int().nonnegative().default(0),
  transactions: z.array(TransactionSchema).max(2000).default([]),
  state: z
    .object({
      payload: UserStateSchema,
      updatedAt: epochMs,
    })
    .optional(),
});

export const SyncPullQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  limitState: z.coerce.number().int().min(0).max(1).default(1),
});

export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

/** 编译期断言：校验 schema 推导出的结构与领域类型 UserState 保持一致 */
type MustExtend<A, B extends A> = B;
export type _UserStateSchemaMatchesDomain = MustExtend<UserState, z.infer<typeof UserStateSchema>>;