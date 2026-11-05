/* 启动时把旧的「前台管理员」迁移成独立后台管理员
   - 旧版本用 user.role='admin' 兼作后台权限（与前台账号共用一张表）
   - 新版本后台账号独立存 admin_user，前台 user.role 不再参与后台鉴权
   - 迁移时沿用原来的密码哈希（同一套 scrypt），迁移完把 user.role 降回 user
   - 只做一次性搬运，不会覆盖已存在的同名后台管理员（可能已经改过密码） */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { account, user } from "../db/auth-schema.ts";
import { adminUser } from "../db/schema.ts";
import { uid } from "@daybook/shared";
import { normalizeAdminUsername } from "./admin-auth.ts";

export async function bootstrapAdmins(): Promise<void> {
  try {
    const rows = await db.select().from(user);
    const legacy = rows.filter((u) =>
      String(u.role ?? "")
        .split(",")
        .map((s) => s.trim())
        .includes("admin"),
    );

    let migrated = 0;
    for (const u of legacy) {
      const username = normalizeAdminUsername(u.username ?? "");
      if (!username) continue;

      const exists = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.username, username)).limit(1);
      if (!exists.length) {
        const acc = await db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")))
          .limit(1);
        const passwordHash = acc[0]?.password ?? null;
        if (!passwordHash) {
          console.warn(`[daybook] 旧管理员 ${username} 没有可用的密码记录，跳过迁移（请在后台重新创建）`);
        } else {
          const now = new Date();
          await db.insert(adminUser).values({
            id: uid("adm"),
            username,
            passwordHash,
            name: u.displayUsername || username,
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastLoginAt: null,
            lastLoginIp: null,
          });
          migrated++;
        }
      }

      // 前台账号不再保留管理员标记：后台权限只认 admin_user
      await db.update(user).set({ role: "user", updatedAt: new Date() }).where(eq(user.id, u.id));
    }

    if (migrated) {
      console.log(`[daybook] 已把 ${migrated} 个前台管理员迁移为独立后台账号（密码不变）`);
    }

    const count = await db.select({ n: sql<number>`count(*)` }).from(adminUser);
    if (Number(count[0]?.n ?? 0) === 0) {
      console.warn("[daybook] 还没有后台管理员：请运行 `pnpm admin:create -- <用户名> <密码>` 创建");
    }
  } catch (err) {
    console.error("[daybook] 初始化后台管理员失败:", err);
  }
}
