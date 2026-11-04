/* 账号体系（PRD v1.2 §F0 / §9.8）
   在 better-auth 之上包一层业务接口，负责：
   - 用户名 / 密码规则校验（PRD 规则一）
   - 按用户名锁定 15 分钟、按 IP 每小时 20 次的登录风控
   - 统一失败文案「用户名或密码不正确」，防用户名枚举
   - 注册即发恢复码（只存 SHA-256，仅在注册响应里出现一次）
   - 邮箱找回（一次性令牌 15 分钟）+ 恢复码找回
   - 会话 / 设备列表、远程下线、改密后撤销其他会话
   挂载点：/api/auth/*（需注册在 better-auth 的 catch-all 之前） */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { auth } from "../auth.ts";
import { db } from "../db/client.ts";
import { passwordReset, session, user, userRecovery } from "../db/auth-schema.ts";
import { env } from "../env.ts";
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashToken,
  normalizeRecoveryCode,
  normalizeUsername,
  randomToken,
  validatePassword,
  validateUsername,
} from "../lib/account-rules.ts";
import {
  checkLoginAllowed,
  clearLoginFailures,
  deviceLabel,
  findUserByUsername,
  getClientIp,
  isSyntheticEmail,
  recordIpAttempt,
  recordLoginFailure,
  touchLastLogin,
} from "../lib/account-service.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const accountRoutes = new Hono();

function publicUser(u: Record<string, any>) {
  const email: string = u.email ?? "";
  const created = u.createdAt;
  return {
    id: u.id as string,
    username: (u.username as string | null) ?? "",
    displayUsername: (u.displayUsername as string | null) ?? (u.name as string) ?? "",
    email: isSyntheticEmail(email) ? null : email,
    emailVerified: Boolean(u.emailVerified),
    createdAt:
      created instanceof Date
        ? created.getTime()
        : typeof created === "number"
          ? created
          : typeof created === "string"
            ? Date.parse(created)
            : null,
  };
}

/** 保留 better-auth 的 Set-Cookie，同时往 JSON 里补充字段 */
async function withJson(res: Response, patch: Record<string, unknown>): Promise<Response> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ...data, ...patch }), { status: res.status, headers });
}

async function readUser(c: any) {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  return s;
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------
accountRoutes.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const usernameRaw = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const emailRaw = String(body?.email ?? "").trim().toLowerCase();
  const acceptedTerms = body?.acceptedTerms === true;

  const uCheck = validateUsername(usernameRaw);
  if (!uCheck.ok) return c.json({ message: uCheck.message, code: "INVALID_USERNAME" }, 400);

  const pCheck = validatePassword(password, usernameRaw);
  if (!pCheck.ok) return c.json({ message: pCheck.message, code: "WEAK_PASSWORD" }, 400);

  if (!acceptedTerms) {
    return c.json({ message: "请先阅读并同意用户协议与隐私政策", code: "TERMS_REQUIRED" }, 400);
  }
  if (emailRaw && !EMAIL_RE.test(emailRaw)) {
    return c.json({ message: "邮箱格式不正确", code: "INVALID_EMAIL" }, 400);
  }

  const username = normalizeUsername(usernameRaw);
  if (await findUserByUsername(username)) {
    return c.json({ message: "该用户名已被占用", code: "USERNAME_TAKEN" }, 409);
  }
  if (emailRaw) {
    const taken = (await db.select().from(user).where(eq(user.email, emailRaw)).limit(1))[0];
    if (taken) return c.json({ message: "该邮箱已被其他账号绑定", code: "EMAIL_TAKEN" }, 409);
  }

  // 未填邮箱时用内部占位邮箱（better-auth 的 user.email 必填且唯一；占位邮箱不等于登录凭据）
  const email = emailRaw || `${username}@daybook.local`;

  const res = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: usernameRaw,
      username,
      displayUsername: usernameRaw,
    } as any,
    headers: c.req.raw.headers,
    asResponse: true,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, any>;
    const msg = String(err?.message ?? "");
    if (/exist|unique|taken/i.test(msg)) {
      return c.json({ message: "该用户名已被占用", code: "USERNAME_TAKEN" }, 409);
    }
    return c.json({ message: msg || "注册失败，请稍后再试", code: err?.code ?? "REGISTER_FAILED" }, res.status as any);
  }

  const data = (await res.json()) as { user?: Record<string, any> };
  const created = data.user ?? {};

  // 恢复码：只展示一次，库里只存哈希
  const code = generateRecoveryCode();
  await db
    .insert(userRecovery)
    .values({ userId: created.id as string, codeHash: hashToken(code), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userRecovery.userId,
      set: { codeHash: hashToken(code), updatedAt: new Date() },
    });

  return withJson(res, {
    user: publicUser(created),
    recoveryCode: formatRecoveryCode(code),
  });
});

// ---------------------------------------------------------------------------
// 用户名可用性（注册页失焦时查询）
// ---------------------------------------------------------------------------
accountRoutes.get("/check-username", async (c) => {
  const raw = c.req.query("username") ?? "";
  const check = validateUsername(raw);
  if (!check.ok) return c.json({ available: false, message: check.message });
  const exists = await findUserByUsername(raw);
  return c.json({ available: !exists, message: exists ? "该用户名已被占用" : "用户名可用" });
});

// ---------------------------------------------------------------------------
// 登录
// ---------------------------------------------------------------------------
accountRoutes.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const usernameRaw = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const rememberMe = body?.rememberMe !== false;

  if (!usernameRaw || !password) {
    return c.json({ message: "请输入用户名和密码", code: "MISSING_FIELDS" }, 400);
  }

  const ip = getClientIp(c.req.raw.headers);
  const blocked = await checkLoginAllowed(usernameRaw, ip);
  if (blocked) return c.json({ message: blocked, code: "RATE_LIMITED" }, 429);
  await recordIpAttempt(ip);

  const res = await auth.api.signInUsername({
    body: { username: normalizeUsername(usernameRaw), password, rememberMe } as any,
    headers: c.req.raw.headers,
    asResponse: true,
  });

  if (!res.ok) {
    await recordLoginFailure(usernameRaw);
    // 统一文案，不区分「用户名不存在」与「密码错误」
    return c.json({ message: "用户名或密码不正确", code: "INVALID_CREDENTIALS" }, 401);
  }

  const data = (await res.json().catch(() => ({}))) as { user?: Record<string, any> };
  await clearLoginFailures(usernameRaw);
  if (data.user?.id) await touchLastLogin(data.user.id as string);

  return withJson(res, {
    user: data.user ? publicUser(data.user) : null,
    token: undefined,
  });
});

// ---------------------------------------------------------------------------
// 登出（只销毁会话，本机数据保留）
// ---------------------------------------------------------------------------
accountRoutes.post("/logout", async (c) => {
  const res = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

// ---------------------------------------------------------------------------
// 当前会话
// ---------------------------------------------------------------------------
accountRoutes.get("/session", async (c) => {
  const s = await readUser(c);
  if (!s) return c.json({ user: null, session: null });
  return c.json({
    user: publicUser(s.user as Record<string, any>),
    session: {
      id: s.session.id,
      expiresAt: s.session.expiresAt instanceof Date ? s.session.expiresAt.getTime() : s.session.expiresAt,
    },
  });
});

// ---------------------------------------------------------------------------
// 修改密码（撤销其他设备会话）
// ---------------------------------------------------------------------------
accountRoutes.post("/change-password", async (c) => {
  const s = await readUser(c);
  if (!s) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  const username = (s.user as Record<string, any>).username ?? (s.user as Record<string, any>).name ?? "";

  if (!currentPassword) return c.json({ message: "请输入当前密码", code: "MISSING_FIELDS" }, 400);
  if (currentPassword === newPassword) {
    return c.json({ message: "新密码不能与当前密码相同", code: "SAME_PASSWORD" }, 400);
  }
  const check = validatePassword(newPassword, String(username));
  if (!check.ok) return c.json({ message: check.message, code: "WEAK_PASSWORD" }, 400);

  const res = await auth.api.changePassword({
    body: { currentPassword, newPassword, revokeOtherSessions: true },
    headers: c.req.raw.headers,
    asResponse: true,
  });
  if (!res.ok) {
    return c.json({ message: "当前密码不正确", code: "INVALID_PASSWORD" }, 400);
  }
  return withJson(res, { ok: true, token: undefined, user: undefined });
});

// ---------------------------------------------------------------------------
// 已登录设备
// ---------------------------------------------------------------------------
accountRoutes.get("/sessions", async (c) => {
  const s = await readUser(c);
  if (!s) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);

  const list = await auth.api.listSessions({ headers: c.req.raw.headers });
  const currentId = s.session.id;
  return c.json({
    sessions: (list as any[]).map((it) => ({
      id: it.id as string,
      device: deviceLabel(it.userAgent ?? null),
      ip: it.ipAddress ?? "—",
      lastActive: it.updatedAt instanceof Date ? it.updatedAt.getTime() : (it.updatedAt ?? null),
      createdAt: it.createdAt instanceof Date ? it.createdAt.getTime() : (it.createdAt ?? null),
      expiresAt: it.expiresAt instanceof Date ? it.expiresAt.getTime() : (it.expiresAt ?? null),
      current: it.id === currentId,
    })),
  });
});

accountRoutes.delete("/sessions/:id", async (c) => {
  const s = await readUser(c);
  if (!s) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);

  const id = c.req.param("id");
  const me = s.user.id;
  const row = (
    await db
      .select()
      .from(session)
      .where(and(eq(session.id, id), eq(session.userId, me)))
      .limit(1)
  )[0];
  if (!row) return c.json({ message: "设备不存在或已下线", code: "NOT_FOUND" }, 404);
  if (row.id === s.session.id) {
    return c.json({ message: "当前设备请使用「退出登录」", code: "CURRENT_DEVICE" }, 400);
  }

  await auth.api.revokeSession({ body: { token: row.token }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 忘记密码：绑定邮箱 → 一次性令牌（开发环境直接返回链接）；未绑邮箱 → 用恢复码
// ---------------------------------------------------------------------------
accountRoutes.post("/forgot-password", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const usernameRaw = String(body?.username ?? "").trim();
  const u = await findUserByUsername(usernameRaw);

  // 统一响应，避免泄露账号是否存在
  const generic = { message: "如果该账号存在，重置方式已发送" };
  if (!u) return c.json({ ok: true, ...generic });

  let resetToken: string | undefined;
  if (!isSyntheticEmail(u.email)) {
    const token = randomToken(32);
    resetToken = token;
    await db.insert(passwordReset).values({
      id: crypto.randomUUID(),
      userId: u.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      createdAt: new Date(),
    });
    // 真实部署时在这里发邮件；本地无 SMTP，只打日志
    console.log(`[daybook] 重置密码链接（15 分钟有效）：${env.baseUrl}/#/reset?token=${token}`);
  }

  return c.json({
    ok: true,
    ...generic,
    // 仅开发环境返回，方便本地跑通「邮箱重置」闭环
    ...(env.exposeDevAuth && resetToken ? { devResetToken: resetToken } : {}),
    hasEmail: !isSyntheticEmail(u.email),
  });
});

// ---------------------------------------------------------------------------
// 重置密码：恢复码 或 邮件令牌；成功后撤销全部会话
// ---------------------------------------------------------------------------
accountRoutes.post("/reset-password", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const code = normalizeRecoveryCode(String(body?.code ?? ""));
  const token = String(body?.token ?? "").trim();
  const newPassword = String(body?.newPassword ?? "");
  const usernameRaw = String(body?.username ?? "").trim();

  let userId: string | null = null;
  let resetId: string | null = null;

  if (token) {
    const row = (await db.select().from(passwordReset).where(eq(passwordReset.tokenHash, hashToken(token))).limit(1))[0];
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return c.json({ message: "重置链接已失效，请重新获取", code: "INVALID_TOKEN" }, 400);
    }
    userId = row.userId;
    resetId = row.id;
  } else if (code) {
    const u = await findUserByUsername(usernameRaw);
    if (!u) return c.json({ message: "恢复码不正确", code: "INVALID_CODE" }, 400);
    const rec = (await db.select().from(userRecovery).where(eq(userRecovery.userId, u.id)).limit(1))[0];
    if (!rec || rec.codeHash !== hashToken(code)) {
      return c.json({ message: "恢复码不正确", code: "INVALID_CODE" }, 400);
    }
    userId = u.id;
  } else {
    return c.json({ message: "请输入恢复码或使用重置链接", code: "MISSING_FIELDS" }, 400);
  }

  const target = (await db.select().from(user).where(eq(user.id, userId)).limit(1))[0];
  if (!target) return c.json({ message: "账号不存在", code: "NOT_FOUND" }, 404);

  const check = validatePassword(newPassword, target.username ?? target.name);
  if (!check.ok) return c.json({ message: check.message, code: "WEAK_PASSWORD" }, 400);

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  await ctx.internalAdapter.updatePassword(userId, hash);

  // 撤销全部会话（PRD AC-F0-13）
  await db.delete(session).where(eq(session.userId, userId));
  if (resetId) {
    await db.update(passwordReset).set({ usedAt: new Date() }).where(eq(passwordReset.id, resetId));
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 恢复码重新生成（需已登录，旧密码校验）
// ---------------------------------------------------------------------------
accountRoutes.post("/recovery-code", async (c) => {
  const s = await readUser(c);
  if (!s) return c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const password = String(body?.password ?? "");
  if (!password) return c.json({ message: "请输入当前密码", code: "MISSING_FIELDS" }, 400);

  // 用登录接口校验密码（不改变当前会话）
  const verify = await auth.api.signInUsername({
    body: { username: (s.user as Record<string, any>).username as string, password, rememberMe: true } as any,
    headers: c.req.raw.headers,
    asResponse: true,
  });
  if (!verify.ok) return c.json({ message: "密码不正确", code: "INVALID_PASSWORD" }, 400);

  const code = generateRecoveryCode();
  await db
    .insert(userRecovery)
    .values({ userId: s.user.id, codeHash: hashToken(code), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userRecovery.userId,
      set: { codeHash: hashToken(code), updatedAt: new Date() },
    });

  return c.json({ ok: true, recoveryCode: formatRecoveryCode(code) });
});
