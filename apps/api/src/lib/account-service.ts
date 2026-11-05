/* 登录风控与设备识别（PRD v1.2 §F0 规则二.5）
   - 同一用户名连续 5 次失败 → 锁定 15 分钟
   - 同一 IP 每小时最多 20 次登录尝试
   - 失败计数按「归一化用户名」存，用户不存在也计数，避免通过锁定行为判断账号是否存在 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { loginAttempt, loginIp, user } from "../db/auth-schema.ts";
import { normalizeUsername } from "./account-rules.ts";

const LOCK_THRESHOLD = 5;
const LOCK_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const IP_WINDOW_MS = 60 * 60 * 1000;

export const LOCKED_MESSAGE = "尝试次数过多，请 15 分钟后再试";

export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "local";
}

export async function findUserByUsername(raw: string) {
  const username = normalizeUsername(raw);
  if (!username) return null;
  const rows = await db.select().from(user).where(eq(user.username, username)).limit(1);
  return rows[0] ?? null;
}

/** 登录前置检查；返回 null 表示放行
 *  ipScope：IP 限流计数用的键。后台登录传 `admin:<ip>`，与前台 App 的计数互不影响。 */
export async function checkLoginAllowed(rawUsername: string, ip: string, ipScope: string = ip): Promise<string | null> {
  const username = normalizeUsername(rawUsername);
  const now = Date.now();

  const attempt = (await db.select().from(loginAttempt).where(eq(loginAttempt.username, username)).limit(1))[0];
  if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > now) return LOCKED_MESSAGE;

  const ipRow = (await db.select().from(loginIp).where(eq(loginIp.ip, ipScope)).limit(1))[0];
  if (ipRow && now - ipRow.windowStart.getTime() < IP_WINDOW_MS && ipRow.count >= IP_LIMIT) {
    return "尝试次数过多，请稍后再试";
  }
  return null;
}

export async function recordIpAttempt(ip: string, ipScope: string = ip): Promise<void> {
  const now = new Date();
  const row = (await db.select().from(loginIp).where(eq(loginIp.ip, ipScope)).limit(1))[0];
  if (!row || now.getTime() - row.windowStart.getTime() >= IP_WINDOW_MS) {
    await db
      .insert(loginIp)
      .values({ ip: ipScope, count: 1, windowStart: now })
      .onConflictDoUpdate({ target: loginIp.ip, set: { count: 1, windowStart: now } });
    return;
  }
  await db.update(loginIp).set({ count: row.count + 1 }).where(eq(loginIp.ip, ipScope));
}

/** 记录一次失败；达到阈值时锁定 15 分钟 */
export async function recordLoginFailure(rawUsername: string): Promise<void> {
  const username = normalizeUsername(rawUsername);
  if (!username) return;
  const now = new Date();
  const row = (await db.select().from(loginAttempt).where(eq(loginAttempt.username, username)).limit(1))[0];
  const failed = (row?.failed ?? 0) + 1;

  if (failed >= LOCK_THRESHOLD) {
    const lockedUntil = new Date(now.getTime() + LOCK_MS);
    await db
      .insert(loginAttempt)
      .values({ username, failed: 0, lockedUntil, lastAt: now })
      .onConflictDoUpdate({ target: loginAttempt.username, set: { failed: 0, lockedUntil, lastAt: now } });
    return;
  }

  await db
    .insert(loginAttempt)
    .values({ username, failed, lockedUntil: null, lastAt: now })
    .onConflictDoUpdate({ target: loginAttempt.username, set: { failed, lastAt: now } });
}

/** 登录成功后清零 */
export async function clearLoginFailures(rawUsername: string): Promise<void> {
  const username = normalizeUsername(rawUsername);
  if (!username) return;
  await db.delete(loginAttempt).where(eq(loginAttempt.username, username));
}

export async function touchLastLogin(userId: string): Promise<void> {
  await db.update(user).set({ lastLoginAt: new Date() }).where(eq(user.id, userId));
}

/** 把 User-Agent 粗分成「系统 · 浏览器」，用于设备列表 */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "未知设备";
  const os = /Windows NT 10/i.test(ua)
    ? "Windows"
    : /Windows/i.test(ua)
      ? "Windows"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Android/i.test(ua)
          ? "Android"
          : /Mac OS X|Macintosh/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "未知系统";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "浏览器";
  return `${os} · ${browser}`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.endsWith("@daybook.local");
}
