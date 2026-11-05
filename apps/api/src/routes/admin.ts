/* 管理后台接口（/api/admin/*）
   只做三块：用户管理、流水审计、统计概览。
   原则：
   - 业务数据只读 + 软删/恢复，绝不替用户创建/修改分类账户（会与服务端真相源冲突）
   - 所有写操作（封禁/解封/授权/强制下线/软删/恢复）必须写审计日志
   - 响应体永不出现 password / code_hash / token / session token
   - 软删与恢复必须重新分配 seq，否则设备按 seq>cursor 拉不到变更

   鉴权：requireAdmin（会话 + role=admin，可选 IP 白名单）
   挂载：app.route("/api/admin", adminRoutes) */

import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.ts";
import { session, user } from "../db/auth-schema.ts";
import { adminAuditLog, adminSession, adminUser, devices, ledgerTransactions, userState } from "../db/schema.ts";
import type { Transaction } from "@daybook/shared";
import { auditContext, isGuardOk, maskEmail, requireAdmin, writeAudit } from "../lib/admin-guard.ts";
import { deviceLabel } from "../lib/account-service.ts";

export const adminRoutes = new Hono();

/** 统一分页：cursor 编码为 `<数值>_<id>`，解码失败按第一页 */
function parseCursor(raw: string | undefined): { n: number; id: string } | null {
  if (!raw) return null;
  const i = raw.indexOf("_");
  if (i < 0) return null;
  const n = Number(raw.slice(0, i));
  if (!Number.isFinite(n)) return null;
  return { n, id: raw.slice(i + 1) };
}

function encodeCursor(n: number, id: string): string {
  return `${n}_${id}`;
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 把 ISO 字符串或毫秒数字转成毫秒；无效返回 null */
function parseTime(v: string | undefined): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** 每个用户一条单调递增的 seq，与 sync-service 口径一致 */
async function nextSeq(userId: string): Promise<number> {
  const rows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${ledgerTransactions.seq}), 0)` })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.userId, userId));
  return Number(rows[0]?.maxSeq ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// 当前管理员身份（前端守卫用）
// ---------------------------------------------------------------------------
adminRoutes.get("/whoami", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;
  return c.json({ data: g.user });
});

// ---------------------------------------------------------------------------
// 概览
// ---------------------------------------------------------------------------
adminRoutes.get("/overview", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const txAll = await db
    .select({ n: sql<number>`count(*)`, live: sql<number>`sum(case when deleted_at is null then 1 else 0 end)` })
    .from(ledgerTransactions);

  const today = await db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerTransactions)
    .where(and(gte(ledgerTransactions.occurredAt, dayStart.getTime()), sql`${ledgerTransactions.deletedAt} is null`));

  const activeUsers = await db
    .select({ n: sql<number>`count(*)` })
    .from(session)
    .where(gte(session.updatedAt, new Date(sevenDaysAgo)));

  const devCount = await db.select({ n: sql<number>`count(*)` }).from(devices);

  const trend = await db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${ledgerTransactions.occurredAt} / 1000, 'unixepoch')`,
      n: sql<number>`count(*)`,
    })
    .from(ledgerTransactions)
    .where(
      and(
        gte(ledgerTransactions.occurredAt, sevenDaysAgo),
        sql`${ledgerTransactions.deletedAt} is null`,
      ),
    )
    .groupBy(sql`strftime('%Y-%m-%d', ${ledgerTransactions.occurredAt} / 1000, 'unixepoch')`)
    .orderBy(asc(sql`strftime('%Y-%m-%d', ${ledgerTransactions.occurredAt} / 1000, 'unixepoch')`));

  const [totalUsers, totalBanned, totalAdmins] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(user).where(eq(user.banned, true)).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(adminUser).then((r) => Number(r[0]?.n ?? 0)),
  ]);

  return c.json({
    data: {
      users: totalUsers,
      admins: totalAdmins,
      banned: totalBanned,
      transactions: Number(txAll[0]?.n ?? 0),
      liveTransactions: Number(txAll[0]?.live ?? 0),
      todayTransactions: Number(today[0]?.n ?? 0),
      activeSessions7d: Number(activeUsers[0]?.n ?? 0),
      devices: Number(devCount[0]?.n ?? 0),
      trend: trend.map((t) => ({ day: t.day, count: Number(t.n) })),
    },
  });
});

// ---------------------------------------------------------------------------
// 用户列表
// ---------------------------------------------------------------------------
adminRoutes.get("/users", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const role = (c.req.query("role") ?? "").trim();
  const bannedParam = c.req.query("banned");
  const sort = c.req.query("sort") === "lastLogin" ? "lastLogin" : "created";
  const limit = clampInt(c.req.query("limit"), 30, 1, 100);
  const cur = parseCursor(c.req.query("cursor"));

  const where: unknown[] = [];
  if (q) {
    where.push(
      or(
        sql`lower(coalesce(${user.username}, '')) like ${"%" + q + "%"}`,
        sql`lower(coalesce(${user.displayUsername}, '')) like ${"%" + q + "%"}`,
        sql`lower(${user.email}) like ${"%" + q + "%"}`,
      ),
    );
  }
  if (role === "admin") where.push(sql`instr(coalesce(${user.role}, ''), 'admin') > 0`);
  if (role === "user") where.push(sql`instr(coalesce(${user.role}, ''), 'admin') = 0`);
  if (bannedParam === "1") where.push(eq(user.banned, true));
  if (bannedParam === "0") where.push(eq(user.banned, false));

  const sortCol = sort === "lastLogin" ? "last_login_at" : "created_at";
  const sortExpr = sql`coalesce(${sql.raw(sortCol)}, 0)`;
  if (cur) {
    where.push(
      or(
        sql`${sortExpr} < ${cur.n}`,
        and(sql`${sortExpr} = ${cur.n}`, sql`${user.id} < ${cur.id}`),
      ),
    );
  }

  const rows = await db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      status: user.status,
    })
    .from(user)
    .where(where.length ? and(...(where as any[])) : undefined)
    .orderBy(desc(sortExpr), desc(user.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return c.json({
    data: page.map((u) => ({
      id: u.id,
      username: u.username ?? "",
      displayUsername: u.displayUsername ?? "",
      email: maskEmail(u.email),
      role: u.role ?? "user",
      banned: Boolean(u.banned),
      banReason: u.banReason,
      banExpires: u.banExpires ? u.banExpires.getTime() : null,
      status: u.status,
      createdAt: u.createdAt ? u.createdAt.getTime() : null,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.getTime() : null,
    })),
    nextCursor: hasMore && last
      ? encodeCursor(
          (sort === "lastLogin" ? last.lastLoginAt?.getTime() : last.createdAt?.getTime()) ?? 0,
          last.id,
        )
      : null,
  });
});

// ---------------------------------------------------------------------------
// 用户详情
// ---------------------------------------------------------------------------
adminRoutes.get("/users/:id", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const u = (await db.select().from(user).where(eq(user.id, id)).limit(1))[0];
  if (!u) return c.json({ message: "用户不存在", code: "NOT_FOUND" }, 404);

  const [sessions, deviceRows, txStat, stateRow, recentTx] = await Promise.all([
    db
      .select({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.userId, id))
      .orderBy(desc(session.updatedAt))
      .limit(20),
    db.select().from(devices).where(eq(devices.userId, id)).orderBy(desc(devices.lastSeenAt)).limit(20),
    db
      .select({
        total: sql<number>`count(*)`,
        live: sql<number>`sum(case when deleted_at is null then 1 else 0 end)`,
        lastOccurred: sql<number>`max(${ledgerTransactions.occurredAt})`,
        lastSeq: sql<number>`coalesce(max(${ledgerTransactions.seq}), 0)`,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.userId, id)),
    db.select().from(userState).where(eq(userState.userId, id)).limit(1),
    db
      .select({
        id: ledgerTransactions.id,
        amount: ledgerTransactions.amount,
        txType: ledgerTransactions.txType,
        occurredAt: ledgerTransactions.occurredAt,
        deletedAt: ledgerTransactions.deletedAt,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.userId, id))
      .orderBy(desc(ledgerTransactions.occurredAt))
      .limit(10),
  ]);

  return c.json({
    data: {
      user: {
        id: u.id,
        username: u.username ?? "",
        displayUsername: u.displayUsername ?? "",
        email: maskEmail(u.email),
        emailVerified: Boolean(u.emailVerified),
        role: u.role ?? "user",
        banned: Boolean(u.banned),
        banReason: u.banReason,
        banExpires: u.banExpires ? u.banExpires.getTime() : null,
        status: u.status,
        createdAt: u.createdAt ? u.createdAt.getTime() : null,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.getTime() : null,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        device: deviceLabel(s.userAgent),
        ip: s.ipAddress,
        createdAt: s.createdAt ? s.createdAt.getTime() : null,
        lastActive: s.updatedAt ? s.updatedAt.getTime() : null,
        expiresAt: s.expiresAt ? s.expiresAt.getTime() : null,
      })),
      devices: deviceRows.map((d) => ({
        id: d.id,
        lastSeenAt: d.lastSeenAt,
        pushes: d.pushes,
        pulls: d.pulls,
      })),
      transactions: {
        total: Number(txStat[0]?.total ?? 0),
        live: Number(txStat[0]?.live ?? 0),
        lastOccurredAt: Number(txStat[0]?.lastOccurred ?? 0) || null,
        lastSeq: Number(txStat[0]?.lastSeq ?? 0),
      },
      state: stateRow[0]
        ? { updatedAt: stateRow[0].updatedAt, bytes: Buffer.byteLength(stateRow[0].payload, "utf8") }
        : null,
      recentTransactions: recentTx.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.txType,
        occurredAt: t.occurredAt,
        deleted: t.deletedAt !== null,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// 封禁 / 解封 / 授权 / 强制下线
// ---------------------------------------------------------------------------
adminRoutes.post("/users/:id/ban", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = String(body?.reason ?? "").trim().slice(0, 200) || "违反用户协议";
  const expiresIn = Number(body?.expiresIn);
  const banExpires = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

  const target = (await db.select().from(user).where(eq(user.id, id)).limit(1))[0];
  if (!target) return c.json({ message: "用户不存在", code: "NOT_FOUND" }, 404);
  if (id === g.user.id) return c.json({ message: "不能封禁自己", code: "SELF_TARGET" }, 400);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ banned: true, banReason: reason, banExpires, status: "disabled", updatedAt: new Date() })
      .where(eq(user.id, id));
    // 立刻踢掉全部会话，避免已登录设备继续使用
    await tx.delete(session).where(eq(session.userId, id));
  });

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "user.ban",
    targetType: "user",
    targetId: id,
    detail: { reason, banExpires: banExpires?.toISOString() ?? null, before: { banned: Boolean(target.banned) } },
    ...ctx,
  });

  return c.json({ data: { ok: true } });
});

adminRoutes.post("/users/:id/unban", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const target = (await db.select().from(user).where(eq(user.id, id)).limit(1))[0];
  if (!target) return c.json({ message: "用户不存在", code: "NOT_FOUND" }, 404);

  await db
    .update(user)
    .set({ banned: false, banReason: null, banExpires: null, status: "active", updatedAt: new Date() })
    .where(eq(user.id, id));

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "user.unban",
    targetType: "user",
    targetId: id,
    detail: { before: { banned: Boolean(target.banned), reason: target.banReason } },
    ...ctx,
  });

  return c.json({ data: { ok: true } });
});

adminRoutes.post("/users/:id/revoke-sessions", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const target = (await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1))[0];
  if (!target) return c.json({ message: "用户不存在", code: "NOT_FOUND" }, 404);

  const deleted = await db.delete(session).where(eq(session.userId, id));

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "user.revoke-sessions",
    targetType: "user",
    targetId: id,
    detail: { deleted },
    ...ctx,
  });

  return c.json({ data: { ok: true } });
});

// ---------------------------------------------------------------------------
// 流水审计
// ---------------------------------------------------------------------------
adminRoutes.get("/transactions", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const userId = c.req.query("userId")?.trim() || null;
  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const txType = c.req.query("type")?.trim() || null;
  const minAmount = c.req.query("minAmount") ? Number(c.req.query("minAmount")) : null;
  const maxAmount = c.req.query("maxAmount") ? Number(c.req.query("maxAmount")) : null;
  const categoryId = c.req.query("categoryId")?.trim() || null;
  const includeDeleted = c.req.query("includeDeleted") === "1";
  const limit = clampInt(c.req.query("limit"), 30, 1, 200);
  const cur = parseCursor(c.req.query("cursor"));

  const where: any[] = [];
  if (userId) where.push(eq(ledgerTransactions.userId, userId));
  if (from !== null) where.push(gte(ledgerTransactions.occurredAt, from));
  if (to !== null) where.push(lte(ledgerTransactions.occurredAt, to));
  if (txType) where.push(eq(ledgerTransactions.txType, txType));
  if (Number.isFinite(minAmount as number)) where.push(gte(ledgerTransactions.amount, Math.trunc(minAmount as number)));
  if (Number.isFinite(maxAmount as number)) where.push(lte(ledgerTransactions.amount, Math.trunc(maxAmount as number)));
  if (categoryId) where.push(eq(ledgerTransactions.categoryId, categoryId));
  if (!includeDeleted) where.push(sql`${ledgerTransactions.deletedAt} is null`);
  if (cur) where.push(sql`${ledgerTransactions.key} < ${cur.n}`);

  const rows = await db
    .select({
      key: ledgerTransactions.key,
      id: ledgerTransactions.id,
      userId: ledgerTransactions.userId,
      amount: ledgerTransactions.amount,
      txType: ledgerTransactions.txType,
      categoryId: ledgerTransactions.categoryId,
      occurredAt: ledgerTransactions.occurredAt,
      updatedAt: ledgerTransactions.updatedAt,
      deletedAt: ledgerTransactions.deletedAt,
      seq: ledgerTransactions.seq,
    })
    .from(ledgerTransactions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(ledgerTransactions.key))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  // 用户名冗余返回，避免前端逐条查
  const uids = [...new Set(page.map((r) => r.userId))];
  const names = uids.length
    ? await db
        .select({ id: user.id, username: user.username, displayUsername: user.displayUsername })
        .from(user)
        .where(inArray(user.id, uids))
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.displayUsername || n.username || n.id]));

  return c.json({
    data: page.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: nameMap.get(r.userId) ?? r.userId,
      amount: r.amount,
      type: r.txType,
      categoryId: r.categoryId,
      occurredAt: r.occurredAt,
      updatedAt: r.updatedAt,
      deleted: r.deletedAt !== null,
      seq: r.seq,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.key, last.id) : null,
  });
});

adminRoutes.get("/transactions/:id", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const userId = c.req.query("userId")?.trim();
  const where = userId
    ? and(eq(ledgerTransactions.id, id), eq(ledgerTransactions.userId, userId))
    : eq(ledgerTransactions.id, id);

  const row = (await db.select().from(ledgerTransactions).where(where).limit(1))[0];
  if (!row) return c.json({ message: "流水不存在", code: "NOT_FOUND" }, 404);

  const owner = (await db.select({ id: user.id, username: user.username }).from(user).where(eq(user.id, row.userId)).limit(1))[0];

  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null;
  }

  return c.json({
    data: {
      id: row.id,
      userId: row.userId,
      username: owner?.username ?? row.userId,
      amount: row.amount,
      type: row.txType,
      categoryId: row.categoryId,
      occurredAt: row.occurredAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      seq: row.seq,
      payload,
    },
  });
});

/** 软删：写墓碑 + 分配新 seq（否则其它设备按 seq>cursor 拉不到） */
adminRoutes.post("/transactions/:id/delete", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const userId = c.req.query("userId")?.trim();
  const where = userId
    ? and(eq(ledgerTransactions.id, id), eq(ledgerTransactions.userId, userId))
    : eq(ledgerTransactions.id, id);

  const row = (await db.select().from(ledgerTransactions).where(where).limit(1))[0];
  if (!row) return c.json({ message: "流水不存在", code: "NOT_FOUND" }, 404);
  if (row.deletedAt !== null) return c.json({ message: "该流水已是删除状态", code: "ALREADY_DELETED" }, 400);

  const now = Date.now();
  let payload: Transaction;
  try {
    payload = JSON.parse(row.payload) as Transaction;
  } catch {
    return c.json({ message: "流水数据损坏，无法操作", code: "BAD_PAYLOAD" }, 500);
  }
  const next = { ...payload, deletedAt: now, updatedAt: now };

  const seq = await nextSeq(row.userId);
  await db
    .update(ledgerTransactions)
    .set({ payload: JSON.stringify(next), deletedAt: now, updatedAt: now, seq })
    .where(where);

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "tx.soft-delete",
    targetType: "transaction",
    targetId: row.id,
    detail: { userId: row.userId, amount: row.amount, type: row.txType, occurredAt: row.occurredAt },
    ...ctx,
  });

  return c.json({ data: { ok: true, seq } });
});

/** 恢复：清墓碑 + 分配新 seq */
adminRoutes.post("/transactions/:id/restore", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const userId = c.req.query("userId")?.trim();
  const where = userId
    ? and(eq(ledgerTransactions.id, id), eq(ledgerTransactions.userId, userId))
    : eq(ledgerTransactions.id, id);

  const row = (await db.select().from(ledgerTransactions).where(where).limit(1))[0];
  if (!row) return c.json({ message: "流水不存在", code: "NOT_FOUND" }, 404);
  if (row.deletedAt === null) return c.json({ message: "该流水未被删除", code: "NOT_DELETED" }, 400);

  const now = Date.now();
  let payload: Transaction;
  try {
    payload = JSON.parse(row.payload) as Transaction;
  } catch {
    return c.json({ message: "流水数据损坏，无法操作", code: "BAD_PAYLOAD" }, 500);
  }
  const next = { ...payload, deletedAt: null, updatedAt: now };

  const seq = await nextSeq(row.userId);
  await db
    .update(ledgerTransactions)
    .set({ payload: JSON.stringify(next), deletedAt: null, updatedAt: now, seq })
    .where(where);

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "tx.restore",
    targetType: "transaction",
    targetId: row.id,
    detail: { userId: row.userId, amount: row.amount, type: row.txType },
    ...ctx,
  });

  return c.json({ data: { ok: true, seq } });
});

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------
adminRoutes.get("/stats/totals", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const where: any[] = [sql`${ledgerTransactions.deletedAt} is null`];
  if (from !== null) where.push(gte(ledgerTransactions.occurredAt, from));
  if (to !== null) where.push(lte(ledgerTransactions.occurredAt, to));

  const rows = await db
    .select({
      type: ledgerTransactions.txType,
      total: sql<number>`coalesce(sum(${ledgerTransactions.amount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(ledgerTransactions)
    .where(and(...where))
    .groupBy(ledgerTransactions.txType);

  const byType: Record<string, { amount: number; count: number }> = {};
  for (const r of rows) byType[r.type] = { amount: Number(r.total), count: Number(r.count) };

  return c.json({
    data: {
      from,
      to,
      expense: byType.expense ?? { amount: 0, count: 0 },
      income: byType.income ?? { amount: 0, count: 0 },
      transfer: byType.transfer ?? { amount: 0, count: 0 },
      adjustment: byType.adjustment ?? { amount: 0, count: 0 },
    },
  });
});

adminRoutes.get("/stats/categories", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const limit = clampInt(c.req.query("limit"), 15, 1, 50);
  const where: any[] = [
    sql`${ledgerTransactions.deletedAt} is null`,
    eq(ledgerTransactions.txType, "expense"),
  ];
  if (from !== null) where.push(gte(ledgerTransactions.occurredAt, from));
  if (to !== null) where.push(lte(ledgerTransactions.occurredAt, to));

  // 先按 categoryId 聚合（SQL 有索引），再在内存里按「分类名」合并同名分类
  const rows = await db
    .select({
      categoryId: ledgerTransactions.categoryId,
      amount: sql<number>`coalesce(sum(${ledgerTransactions.amount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(ledgerTransactions)
    .where(and(...where))
    .groupBy(ledgerTransactions.categoryId)
    .orderBy(desc(sql`coalesce(sum(${ledgerTransactions.amount}), 0)`))
    .limit(200);

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  // 分类名存在各用户的 user_state 里（整包 JSON）。这里汇总一份 id → 名称映射给前端展示用。
  const names = await categoryNameMap();

  // 同名列合并：每个用户有自己的一套分类 UUID（都叫「房租」），
  // 运营要看到的是「房租」合计，而不是 N 条房租。
  const merged = new Map<string, { categoryId: string | null; categoryName: string | null; amount: number; count: number }>();
  for (const r of rows) {
    const name = r.categoryId ? (names.get(r.categoryId) ?? null) : null;
    const key = name ?? `#${r.categoryId ?? "none"}`;
    const cur = merged.get(key) ?? {
      categoryId: r.categoryId,
      categoryName: name ?? (r.categoryId ? null : "未分类"),
      amount: 0,
      count: 0,
    };
    cur.amount += Number(r.amount);
    cur.count += Number(r.count);
    merged.set(key, cur);
  }

  const list = [...merged.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 }));

  return c.json({ data: list, total });
});

/** 扫描所有 user_state，汇总分类 id → 名称（同名不同 id 不合并，取首个出现的名字） */
async function categoryNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await db.select({ payload: userState.payload }).from(userState);
  for (const row of rows) {
    try {
      const st = JSON.parse(row.payload) as { categories?: { id: string; name: string }[] };
      for (const c of st.categories ?? []) {
        if (c?.id && c?.name && !map.has(c.id)) map.set(c.id, c.name);
      }
    } catch {
      /* 单条损坏不影响整体统计 */
    }
  }
  return map;
}

adminRoutes.get("/stats/daily", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const from = parseTime(c.req.query("from")) ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const to = parseTime(c.req.query("to")) ?? Date.now();

  const dayExpr = sql<string>`strftime('%Y-%m-%d', ${ledgerTransactions.occurredAt} / 1000, 'unixepoch')`;

  const rows = await db
    .select({
      day: dayExpr,
      type: ledgerTransactions.txType,
      amount: sql<number>`coalesce(sum(${ledgerTransactions.amount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(ledgerTransactions)
    .where(
      and(
        sql`${ledgerTransactions.deletedAt} is null`,
        gte(ledgerTransactions.occurredAt, from),
        lte(ledgerTransactions.occurredAt, to),
      ),
    )
    .groupBy(dayExpr, ledgerTransactions.txType)
    .orderBy(asc(dayExpr));

  const map = new Map<string, { expense: number; income: number; count: number }>();
  for (const r of rows) {
    const cur = map.get(r.day) ?? { expense: 0, income: 0, count: 0 };
    if (r.type === "expense") cur.expense += Number(r.amount);
    if (r.type === "income") cur.income += Number(r.amount);
    cur.count += Number(r.count);
    map.set(r.day, cur);
  }

  return c.json({
    data: [...map.entries()].map(([day, v]) => ({ day, ...v })),
    from,
    to,
  });
});

// ---------------------------------------------------------------------------
// 设备 / 审计 / 系统
// ---------------------------------------------------------------------------
adminRoutes.get("/devices", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const limit = clampInt(c.req.query("limit"), 30, 1, 100);
  const rows = await db
    .select({
      id: devices.id,
      userId: devices.userId,
      lastSeenAt: devices.lastSeenAt,
      pushes: devices.pushes,
      pulls: devices.pulls,
    })
    .from(devices)
    .orderBy(desc(devices.lastSeenAt))
    .limit(limit);

  const uids = [...new Set(rows.map((r) => r.userId))];
  const names = uids.length
    ? await db.select({ id: user.id, username: user.username }).from(user).where(inArray(user.id, uids))
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.username ?? n.id]));

  return c.json({
    data: rows.map((r) => ({ ...r, username: nameMap.get(r.userId) ?? r.userId })),
  });
});

adminRoutes.get("/audit", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const action = c.req.query("action")?.trim() || null;
  const adminId = c.req.query("adminId")?.trim() || null;
  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const limit = clampInt(c.req.query("limit"), 30, 1, 100);
  const cur = parseCursor(c.req.query("cursor"));

  const where: any[] = [];
  if (action) where.push(eq(adminAuditLog.action, action));
  if (adminId) where.push(eq(adminAuditLog.adminId, adminId));
  if (from !== null) where.push(gte(adminAuditLog.createdAt, new Date(from)));
  if (to !== null) where.push(lte(adminAuditLog.createdAt, new Date(to)));
  if (cur) where.push(sql`${adminAuditLog.createdAt} < ${new Date(cur.n)}`);

  const rows = await db
    .select()
    .from(adminAuditLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return c.json({
    data: page.map((r) => ({
      id: r.id,
      adminId: r.adminId,
      adminName: r.adminName,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail ? safeJson(r.detail) : null,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.getTime(),
    })),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt.getTime(), last.id) : null,
  });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

adminRoutes.get("/system", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const [u, s, tx, st, dev, audit, adminCount, adminSessionCount, lastAudit] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(session).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(ledgerTransactions).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(userState).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(devices).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(adminAuditLog).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(adminUser).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(adminSession).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ t: sql<number>`max(${adminAuditLog.createdAt})` }).from(adminAuditLog).then((r) => r[0]?.t ?? null),
  ]);

  return c.json({
    data: {
      version: "1.0.0",
      nodeEnv: process.env.NODE_ENV ?? "development",
      uptimeSec: Math.round(process.uptime()),
      tables: {
        user: u,
        session: s,
        adminUser: adminCount,
        adminSession: adminSessionCount,
        ledgerTransactions: tx,
        userState: st,
        devices: dev,
        adminAuditLog: audit,
      },
      lastAuditAt: lastAudit ? new Date(lastAudit).getTime() : null,
    },
  });
});
