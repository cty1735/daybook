/* 实时读写接口（服务端为准）
   - GET  /api/data                 一次性拉取当前用户的完整账本
   - POST /api/data/transactions    幂等 upsert 一批流水（含墓碑）
   - PUT  /api/data/state           保存用户级状态（分类/账户/预算/偏好，整包）
   - DELETE /api/data/transactions  清空当前用户流水
   - POST /api/data/reset           恢复出厂（删流水 + 重建默认状态）
   - POST /api/data/replace         用备份整体替换
   写入复用 sync-service 的 LWW/幂等/seq 分配，避免两套写逻辑。 */

import { buildInitialData, SCHEMA_VERSION, type AppData, type UserState } from "@daybook/shared";
import { AppDataSchema, TransactionSchema, UserStateSchema } from "@daybook/shared/schemas";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.ts";
import { ledgerTransactions, userState } from "../db/schema.ts";
import { getSessionUser } from "../lib/session.ts";
import { pushChanges } from "../lib/sync-service.ts";

export const dataRoutes = new Hono();

const deviceOf = (c: { req: { header: (k: string) => string | undefined } }): string =>
  c.req.header("x-device-id") ?? "web";

const SaveTransactionsSchema = z.object({
  transactions: z.array(TransactionSchema).max(2000),
});

function defaultState(): UserState {
  const d = buildInitialData();
  return {
    categories: d.categories,
    accounts: d.accounts,
    budget: d.budget,
    settings: d.settings,
    categoryUsage: d.categoryUsage,
    lastUsedCategoryId: d.lastUsedCategoryId,
    lastUsedAccountId: d.lastUsedAccountId,
  };
}

/** 首次访问时写入默认分类/账户/预算（并发安全：PK 冲突时忽略） */
async function ensureState(userId: string): Promise<UserState> {
  await db
    .insert(userState)
    .values({ userId, payload: JSON.stringify(defaultState()), updatedAt: Date.now() })
    .onConflictDoNothing();
  const row = (await db.select().from(userState).where(eq(userState.userId, userId)).limit(1))[0];
  return JSON.parse(row.payload) as UserState;
}

async function loadData(userId: string): Promise<AppData> {
  const state = await ensureState(userId);
  const rows = await db
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.userId, userId))
    .orderBy(asc(ledgerTransactions.occurredAt));
  return {
    schemaVersion: SCHEMA_VERSION,
    ...state,
    transactions: rows.map((r) => JSON.parse(r.payload)),
  };
}

dataRoutes.get("/", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);
  return c.json(await loadData(user.id));
});

dataRoutes.post("/transactions", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);

  const parsed = SaveTransactionsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ message: "参数不合法", issues: parsed.error.issues.slice(0, 10) }, 400);
  }

  const result = await pushChanges({
    userId: user.id,
    deviceId: deviceOf(c),
    transactions: parsed.data.transactions,
  });
  return c.json({ accepted: result.accepted, rejected: result.rejected });
});

/** 直接覆盖接口必须保证时间戳单调递增，否则会被旧的「未来时间」状态挡住 */
async function nextStateTimestamp(userId: string): Promise<number> {
  const row = (
    await db.select({ updatedAt: userState.updatedAt }).from(userState).where(eq(userState.userId, userId)).limit(1)
  )[0];
  return Math.max(Date.now(), (row?.updatedAt ?? 0) + 1);
}

dataRoutes.put("/state", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);

  const parsed = UserStateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ message: "参数不合法", issues: parsed.error.issues.slice(0, 10) }, 400);
  }

  await pushChanges({
    userId: user.id,
    deviceId: deviceOf(c),
    transactions: [],
    state: { payload: parsed.data, updatedAt: await nextStateTimestamp(user.id) },
  });
  return c.json({ ok: true });
});

dataRoutes.delete("/transactions", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);
  await db.delete(ledgerTransactions).where(eq(ledgerTransactions.userId, user.id));
  return c.json({ ok: true });
});

dataRoutes.post("/reset", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);
  await db.delete(ledgerTransactions).where(eq(ledgerTransactions.userId, user.id));
  await db.delete(userState).where(eq(userState.userId, user.id));
  return c.json(await loadData(user.id));
});

dataRoutes.post("/replace", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);

  const parsed = AppDataSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ message: "备份格式不合法", issues: parsed.error.issues.slice(0, 10) }, 400);
  }
  const d = parsed.data;

  await db.delete(ledgerTransactions).where(eq(ledgerTransactions.userId, user.id));
  await db.delete(userState).where(eq(userState.userId, user.id));

  if (d.transactions.length) {
    await pushChanges({ userId: user.id, deviceId: deviceOf(c), transactions: d.transactions });
  }
  await pushChanges({
    userId: user.id,
    deviceId: deviceOf(c),
    transactions: [],
    state: {
      payload: {
        categories: d.categories,
        accounts: d.accounts,
        budget: d.budget,
        settings: d.settings,
        categoryUsage: d.categoryUsage,
        lastUsedCategoryId: d.lastUsedCategoryId,
        lastUsedAccountId: d.lastUsedAccountId,
      },
      updatedAt: Date.now(),
    },
  });

  return c.json(await loadData(user.id));
});
