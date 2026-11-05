/* 创建 / 提升一个管理员账号（幂等）
   用法：
     pnpm -F @daybook/api admin:create                      # 使用脚本内置的默认账号
     pnpm -F @daybook/api admin:create -- <用户名> <密码>
   或从根目录：pnpm admin:create

   行为：
   - 用户不存在 → 走 better-auth 的 signUpEmail 建号（密码哈希、account 行都按官方流程生成）
   - 用户已存在 → 只提升角色，**不改密码**
   - 无论哪条路径，最后都置 role=admin、banned=false、status=active

   注意：默认账号只用于本地开发。生产请用 `-- 用户名 强密码` 指定，或建好后在后台改密。 */

import { eq } from "drizzle-orm";
import { auth } from "../auth.ts";
import { db } from "../db/client.ts";
import { user } from "../db/auth-schema.ts";
import { runMigrations } from "../db/migrate.ts";
import { normalizeUsername } from "../lib/account-rules.ts";

const DEFAULT_USERNAME = "daybook_admin";
const DEFAULT_PASSWORD = "DayBook@2026";

const args = process.argv.slice(2);
const username = normalizeUsername(args[0] || DEFAULT_USERNAME);
const password = args[1] || DEFAULT_PASSWORD;

await runMigrations();

const existing = (await db.select().from(user).where(eq(user.username, username)).limit(1))[0];

if (existing) {
  await db
    .update(user)
    .set({ role: "admin", banned: false, banReason: null, banExpires: null, status: "active", updatedAt: new Date() })
    .where(eq(user.id, existing.id));

  console.log(`[admin:create] 已存在用户 ${username}（${existing.id}），已置为管理员。`);
  console.log("[admin:create] 密码不会在这里改动：请在 App「我的 → 账号」里改密，或换个新用户名建号。");
} else {
  // better-auth 的 user.email 必填且唯一；未绑定邮箱时用内部占位邮箱
  const email = `${username}@daybook.local`;
  const res = await auth.api.signUpEmail({
    body: { email, password, name: username, username, displayUsername: username } as any,
  });
  const created = (res as any)?.user;
  if (!created?.id) {
    console.error("[admin:create] 建号失败：", res);
    process.exit(1);
  }
  await db
    .update(user)
    .set({ role: "admin", banned: false, status: "active", updatedAt: new Date() })
    .where(eq(user.id, created.id));

  console.log(`[admin:create] 已创建管理员 ${username}（${created.id}）。`);
}

console.log("");
console.log("  用户名：" + username);
console.log("  密码：  " + (existing ? "（原有密码，未改动）" : password));
console.log("  后台：  http://localhost:5173/admin/");
console.log("");
console.log("  仅本地开发使用；生产环境请改密或显式传强密码。");