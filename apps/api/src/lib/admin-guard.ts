/* 管理后台鉴权与审计
   - requireAdmin：会话 + role 校验（多角色用逗号分隔），可选 IP 白名单
   - writeAudit：写操作留痕，只插不改不删
   - maskEmail：列表页邮箱脱敏（PRD 后台约定）
   - isSyntheticEmail：未绑定邮箱的内部占位邮箱不外露 */

import type { Context } from "hono";
import { auth } from "../auth.ts";
import { db } from "../db/client.ts";
import { adminAuditLog } from "../db/schema.ts";
import { env } from "../env.ts";
import { getClientIp, isSyntheticEmail } from "./account-service.ts";
import { uid } from "@daybook/shared";

export interface AdminUser {
  id: string;
  username: string;
  displayUsername: string;
  role: string;
}

export type GuardResult = { user: AdminUser } | { response: Response };

/** 后台接口统一守卫：返回 user 或直接返回错误响应 */
export async function requireAdmin(c: Context): Promise<GuardResult> {
  if (env.adminIpAllowlist.length) {
    const ip = getClientIp(c.req.raw.headers);
    if (!env.adminIpAllowlist.includes(ip)) {
      return { response: c.json({ message: "来源 IP 不在白名单", code: "IP_FORBIDDEN" }, 403) };
    }
  }

  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s?.user) {
    return { response: c.json({ message: "未登录", code: "UNAUTHORIZED" }, 401) };
  }

  const u = s.user as Record<string, unknown>;
  const roles = String(u.role ?? "user")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (!roles.includes("admin")) {
    return { response: c.json({ message: "无后台权限", code: "FORBIDDEN" }, 403) };
  }
  if (u.banned === true) {
    return { response: c.json({ message: "账号已被停用", code: "BANNED_USER" }, 403) };
  }

  return {
    user: {
      id: String(u.id),
      username: String(u.username ?? ""),
      displayUsername: String(u.displayUsername ?? u.name ?? ""),
      role: roles.join(","),
    },
  };
}

export function isGuardOk(g: GuardResult): g is { user: AdminUser } {
  return "user" in g;
}

/** 邮箱脱敏：ab***@x.com；占位邮箱（*@daybook.local）一律返回 null */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  if (isSyntheticEmail(email)) return null;
  const [name, domain] = email.split("@");
  if (!domain) return null;
  const head = name.slice(0, 2);
  return `${head}${name.length > 2 ? "***" : "*"}@${domain}`;
}

export interface AuditInput {
  admin: AdminUser;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** 写审计日志。失败不阻断主流程（后台可用性优先），但要打日志 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      id: uid("aud"),
      adminId: input.admin.id,
      adminName: input.admin.displayUsername || input.admin.username || input.admin.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      detail: input.detail === undefined ? null : JSON.stringify(input.detail),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[daybook] 写审计日志失败:", err);
  }
}

/** 从请求里取审计用的上下文 */
export function auditContext(c: Context): { ip: string; userAgent: string | null } {
  return {
    ip: getClientIp(c.req.raw.headers),
    userAgent: c.req.raw.headers.get("user-agent"),
  };
}
