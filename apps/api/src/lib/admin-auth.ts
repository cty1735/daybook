/* 后台管理员认证（与前台用户体系完全分离）
   - 独立表 admin_user / admin_session，独立 Cookie daybook_admin_session
   - 密码用 scrypt（与 better-auth 同参数 N=16384 r=16 p=1，格式 salt:hash），
     这样从旧版前台管理员迁移时可以原样沿用密码哈希
   - 会话令牌只存 SHA-256，数据库泄露也拿不到可用 Cookie */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { adminSession, adminUser } from "../db/schema.ts";
import { normalizeUsername } from "./account-rules.ts";

export const ADMIN_COOKIE = "daybook_admin_session";
const SCRYPT = { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

export type AdminAccount = typeof adminUser.$inferSelect;
export type AdminSessionRow = typeof adminSession.$inferSelect;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, 64, SCRYPT).toString("hex");
  return `${salt}:${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(key, "hex");
  } catch {
    return false;
  }
  if (!expected.length) return false;
  const derived = scryptSync(password, salt, expected.length, SCRYPT);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeAdminUsername(raw: string): string {
  return normalizeUsername(raw);
}

export async function findAdminByUsername(raw: string): Promise<AdminAccount | null> {
  const username = normalizeAdminUsername(raw);
  if (!username) return null;
  const rows = await db.select().from(adminUser).where(eq(adminUser.username, username)).limit(1);
  return rows[0] ?? null;
}

/* ------------------------------ Cookie ------------------------------ */

function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function adminCookie(token: string, ttlMs: number): string {
  const attrs = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

export function clearAdminCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------ 会话 ------------------------------ */

export async function createAdminSession(
  adminId: string,
  opts: { ip?: string | null; userAgent?: string | null; remember?: boolean } = {},
): Promise<{ token: string; expiresAt: Date; ttlMs: number }> {
  const ttlMs = opts.remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_MS;
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(adminSession).values({
    tokenHash: hashToken(token),
    adminId,
    createdAt: now,
    expiresAt,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  });
  return { token, expiresAt, ttlMs };
}

export interface AdminSessionInfo {
  admin: AdminAccount;
  session: AdminSessionRow;
}

/** 从 Cookie 解析后台会话；未登录 / 过期 / 被停用都返回 null */
export async function readAdminSession(headers: Headers): Promise<AdminSessionInfo | null> {
  const token = readCookie(headers, ADMIN_COOKIE);
  if (!token) return null;
  const rows = await db
    .select({ session: adminSession, admin: adminUser })
    .from(adminSession)
    .innerJoin(adminUser, eq(adminUser.id, adminSession.adminId))
    .where(and(eq(adminSession.tokenHash, hashToken(token)), gt(adminSession.expiresAt, new Date())))
    .limit(1);
  const hit = rows[0];
  if (!hit || hit.admin.status !== "active") return null;
  return hit;
}

export async function destroyAdminSession(headers: Headers): Promise<void> {
  const token = readCookie(headers, ADMIN_COOKIE);
  if (!token) return;
  await db.delete(adminSession).where(eq(adminSession.tokenHash, hashToken(token)));
}

export async function revokeAdminSessions(adminId: string): Promise<void> {
  await db.delete(adminSession).where(eq(adminSession.adminId, adminId));
}

export async function touchAdminLogin(adminId: string, ip: string | null): Promise<void> {
  await db.update(adminUser).set({ lastLoginAt: new Date(), lastLoginIp: ip, updatedAt: new Date() }).where(eq(adminUser.id, adminId));
}

export async function cleanupExpiredAdminSessions(): Promise<number> {
  const res = await db.delete(adminSession).where(lt(adminSession.expiresAt, new Date()));
  return Number((res as unknown as { rowsAffected?: number })?.rowsAffected ?? 0);
}
