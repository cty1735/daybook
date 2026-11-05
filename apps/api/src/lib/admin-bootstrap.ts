/* 启动时把 ADMIN_USERNAMES 里的用户置为 admin
   只做「提权」，不做降权：把某人从 ADMIN_USERNAMES 移除不会自动收回权限，
   避免一次配置失误把所有人锁在后台外面。收回权限请走后台页面。 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { user } from "../db/auth-schema.ts";
import { env } from "../env.ts";

export async function bootstrapAdmins(): Promise<void> {
  const names = env.adminUsernames;
  if (!names.length) return;

  try {
    const rows = await db
      .select({ id: user.id, username: user.username, role: user.role })
      .from(user)
      .where(inArray(user.username, names));

    const need = rows.filter((r) => {
      const roles = String(r.role ?? "user").split(",").map((s) => s.trim());
      return !roles.includes("admin");
    });

    for (const r of need) {
      await db.update(user).set({ role: "admin", updatedAt: new Date() }).where(eq(user.id, r.id));
    }

    if (need.length) {
      console.log(`[daybook] 已提权 ${need.length} 个管理员：${need.map((r) => r.username).join(", ")}`);
    }
    const missing = names.filter((n) => !rows.some((r) => r.username === n));
    if (missing.length) {
      console.warn(`[daybook] ADMIN_USERNAMES 中这些用户名不存在（尚未注册）：${missing.join(", ")}`);
    }
  } catch (err) {
    console.error("[daybook] 初始化管理员失败:", err);
  }
}
