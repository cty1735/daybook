/* 管理后台：独立登录 / 会话 / 管理员账号管理
   - 与前台 /api/auth/* 完全无关：前台账号不能登录后台
   - 登录接口自带 5 次失败锁 15 分钟 + 同 IP 20 次/小时（复用前台风控表，键加 admin: 前缀） */

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.ts";
import { adminUser } from "../db/schema.ts";
import { uid } from "@daybook/shared";
import { normalizeUsername, validatePassword, validateUsername } from "../lib/account-rules.ts";
import {
  clearLoginFailures,
  getClientIp,
  recordIpAttempt,
  recordLoginFailure,
  checkLoginAllowed,
} from "../lib/account-service.ts";
import {
  adminCookie,
  clearAdminCookie,
  createAdminSession,
  destroyAdminSession,
  findAdminByUsername,
  hashPassword,
  revokeAdminSessions,
  touchAdminLogin,
  verifyPassword,
} from "../lib/admin-auth.ts";
import { auditContext, isGuardOk, requireAdmin, writeAudit } from "../lib/admin-guard.ts";

export const adminAuthRoutes = new Hono();

const ATTEMPT_PREFIX = "admin:";
const USERNAME_MAX = 20;

function publicAdmin(a: {
  id: string;
  username: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
}) {
  return {
    id: a.id,
    username: a.username,
    displayUsername: a.name || a.username,
    name: a.name,
    status: a.status,
    createdAt: a.createdAt.getTime(),
    updatedAt: a.updatedAt.getTime(),
    lastLoginAt: a.lastLoginAt?.getTime() ?? null,
    lastLoginIp: a.lastLoginIp,
  };
}

/** 至少保留一个可用管理员，避免把自己锁在后台外面 */
async function activeAdminCount(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminUser)
    .where(eq(adminUser.status, "active"));
  return Number(rows[0]?.n ?? 0);
}

/* ------------------------------ 登录 / 会话 ------------------------------ */

adminAuthRoutes.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const usernameRaw = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const remember = body?.rememberMe !== false;

  if (!usernameRaw || !password) {
    return c.json({ message: "请输入用户名和密码", code: "MISSING_FIELDS" }, 400);
  }

  const ip = getClientIp(c.req.raw.headers);
  const attemptKey = `${ATTEMPT_PREFIX}${normalizeUsername(usernameRaw)}`;
  const ipScope = `${ATTEMPT_PREFIX}${ip}`;
  const blocked = await checkLoginAllowed(attemptKey, ip, ipScope);
  if (blocked) return c.json({ message: blocked, code: "RATE_LIMITED" }, 429);
  await recordIpAttempt(ip, ipScope);

  const admin = await findAdminByUsername(usernameRaw);
  const okPassword = admin ? verifyPassword(password, admin.passwordHash) : false;

  if (!admin || !okPassword || admin.status !== "active") {
    await recordLoginFailure(attemptKey);
    return c.json({ message: "用户名或密码不正确", code: "INVALID_CREDENTIALS" }, 401);
  }

  await clearLoginFailures(attemptKey);
  const { token, ttlMs } = await createAdminSession(admin.id, {
    ip,
    userAgent: c.req.raw.headers.get("user-agent"),
    remember,
  });
  await touchAdminLogin(admin.id, ip);

  c.header("Set-Cookie", adminCookie(token, ttlMs));
  return c.json({ data: publicAdmin({ ...admin, lastLoginAt: new Date(), lastLoginIp: ip }) });
});

adminAuthRoutes.post("/logout", async (c) => {
  await destroyAdminSession(c.req.raw.headers);
  c.header("Set-Cookie", clearAdminCookie());
  return c.json({ data: { ok: true } });
});

adminAuthRoutes.get("/me", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;
  const admin = await db.select().from(adminUser).where(eq(adminUser.id, g.user.id)).limit(1);
  const row = admin[0];
  if (!row) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);
  return c.json({ data: { ...publicAdmin(row), role: "admin" } });
});

/** 修改自己的密码：成功后重新签发会话，其它后台会话全部失效 */
adminAuthRoutes.post("/me/password", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");

  const rows = await db.select().from(adminUser).where(eq(adminUser.id, g.user.id)).limit(1);
  const me = rows[0];
  if (!me) return c.json({ message: "账号不存在", code: "NOT_FOUND" }, 404);
  if (!verifyPassword(currentPassword, me.passwordHash)) {
    return c.json({ message: "当前密码不正确", code: "INVALID_CREDENTIALS" }, 400);
  }
  const check = validatePassword(newPassword, me.username);
  if (!check.ok) return c.json({ message: check.message, code: "WEAK_PASSWORD" }, 400);

  await db
    .update(adminUser)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(adminUser.id, me.id));
  await revokeAdminSessions(me.id);

  const ip = getClientIp(c.req.raw.headers);
  const { token, ttlMs } = await createAdminSession(me.id, {
    ip,
    userAgent: c.req.raw.headers.get("user-agent"),
    remember: true,
  });
  c.header("Set-Cookie", adminCookie(token, ttlMs));

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "admin.change-own-password",
    targetType: "admin",
    targetId: me.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return c.json({ data: { ok: true } });
});

/* ------------------------------ 管理员账号管理 ------------------------------ */

adminAuthRoutes.get("/accounts", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const rows = await db.select().from(adminUser).orderBy(desc(adminUser.createdAt));
  return c.json({
    data: rows.map((r) => ({ ...publicAdmin(r), isSelf: r.id === g.user.id })),
  });
});

adminAuthRoutes.post("/accounts", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const usernameRaw = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const name = String(body?.name ?? "").trim().slice(0, 40);

  const nameCheck = validateUsername(usernameRaw);
  if (!nameCheck.ok) return c.json({ message: nameCheck.message, code: "INVALID_USERNAME" }, 400);
  const username = normalizeUsername(usernameRaw);
  if (username.length > USERNAME_MAX) {
    return c.json({ message: `用户名最多 ${USERNAME_MAX} 个字符`, code: "INVALID_USERNAME" }, 400);
  }
  const pwCheck = validatePassword(password, username);
  if (!pwCheck.ok) return c.json({ message: pwCheck.message, code: "WEAK_PASSWORD" }, 400);

  const exists = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.username, username)).limit(1);
  if (exists.length) return c.json({ message: "该管理员用户名已存在", code: "USERNAME_TAKEN" }, 409);

  const now = new Date();
  const row = {
    id: uid("adm"),
    username,
    passwordHash: hashPassword(password),
    name: name || username,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginIp: null,
  };
  await db.insert(adminUser).values(row);

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "admin.create",
    targetType: "admin",
    targetId: row.id,
    detail: { username, name: row.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return c.json({ data: publicAdmin(row) });
});

adminAuthRoutes.post("/accounts/:id/password", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const rows = await db.select().from(adminUser).where(eq(adminUser.id, id)).limit(1);
  const target = rows[0];
  if (!target) return c.json({ message: "管理员不存在", code: "NOT_FOUND" }, 404);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const password = String(body?.password ?? "");
  const pwCheck = validatePassword(password, target.username);
  if (!pwCheck.ok) return c.json({ message: pwCheck.message, code: "WEAK_PASSWORD" }, 400);

  await db
    .update(adminUser)
    .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
    .where(eq(adminUser.id, id));
  // 改密即踢下线；如果改的是自己，当前会话也会失效，前端会回到登录页
  await revokeAdminSessions(id);

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "admin.reset-password",
    targetType: "admin",
    targetId: id,
    detail: { username: target.username },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return c.json({ data: { ok: true, self: id === g.user.id } });
});

adminAuthRoutes.post("/accounts/:id/status", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const status = String(body?.status ?? "");
  if (status !== "active" && status !== "disabled") {
    return c.json({ message: "状态只能是 active 或 disabled", code: "INVALID_STATUS" }, 400);
  }
  if (id === g.user.id) {
    return c.json({ message: "不能停用自己的账号", code: "CANNOT_SELF_DISABLE" }, 409);
  }

  const rows = await db.select().from(adminUser).where(eq(adminUser.id, id)).limit(1);
  const target = rows[0];
  if (!target) return c.json({ message: "管理员不存在", code: "NOT_FOUND" }, 404);
  if (status === "disabled" && target.status === "active" && (await activeAdminCount()) <= 1) {
    return c.json({ message: "至少要保留一个可用的管理员", code: "LAST_ADMIN" }, 409);
  }

  await db.update(adminUser).set({ status, updatedAt: new Date() }).where(eq(adminUser.id, id));
  if (status === "disabled") await revokeAdminSessions(id);

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: status === "disabled" ? "admin.disable" : "admin.enable",
    targetType: "admin",
    targetId: id,
    detail: { username: target.username },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return c.json({ data: { ok: true, status } });
});

adminAuthRoutes.delete("/accounts/:id", async (c) => {
  const g = await requireAdmin(c);
  if (!isGuardOk(g)) return g.response;

  const id = c.req.param("id");
  if (id === g.user.id) {
    return c.json({ message: "不能删除自己的账号", code: "CANNOT_SELF_DELETE" }, 409);
  }
  const rows = await db.select().from(adminUser).where(eq(adminUser.id, id)).limit(1);
  const target = rows[0];
  if (!target) return c.json({ message: "管理员不存在", code: "NOT_FOUND" }, 404);

  const others = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminUser)
    .where(and(ne(adminUser.id, id), eq(adminUser.status, "active")));
  if (Number(others[0]?.n ?? 0) === 0) {
    return c.json({ message: "至少要保留一个可用的管理员", code: "LAST_ADMIN" }, 409);
  }

  await revokeAdminSessions(id);
  await db.delete(adminUser).where(eq(adminUser.id, id));

  const ctx = auditContext(c);
  await writeAudit({
    admin: g.user,
    action: "admin.delete",
    targetType: "admin",
    targetId: id,
    detail: { username: target.username },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return c.json({ data: { ok: true } });
});
