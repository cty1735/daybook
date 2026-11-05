/* 创建后台管理员（独立 admin_user 表，与前台用户无关）
   用法：
     pnpm -F @daybook/api admin:create                      # 使用脚本内置默认账号
     pnpm -F @daybook/api admin:create -- <用户名> <密码>
   或从根目录：pnpm admin:create -- <用户名> <密码>

   行为：
   - 账号不存在 → 直接写入 admin_user（scrypt 哈希）
   - 账号已存在 → 只提示，不改密码（改密请登录后台「管理员账号」页，或先删除再建）
   - 生产环境务必显式传强密码 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { adminUser } from "../db/schema.ts";
import { runMigrations } from "../db/migrate.ts";
import { normalizeUsername, validatePassword, validateUsername } from "../lib/account-rules.ts";
import { hashPassword } from "../lib/admin-auth.ts";
import { uid } from "@daybook/shared";

const DEFAULT_USERNAME = "daybook_admin";
const DEFAULT_PASSWORD = "DayBook@2026";

// pnpm 10 会把 `--` 原样传给脚本，这里过滤掉，避免用户名变成 "--"
const args = process.argv.slice(2).filter((a) => a !== "--" && a.trim() !== "");
const usernameRaw = args[0] || DEFAULT_USERNAME;
const password = args[1] || DEFAULT_PASSWORD;

const nameCheck = validateUsername(usernameRaw);
if (!nameCheck.ok) {
  console.error(`[admin:create] 用户名不合法：${nameCheck.message}`);
  process.exit(1);
}
const username = normalizeUsername(usernameRaw);
const pwCheck = validatePassword(password, username);
if (!pwCheck.ok) {
  console.error(`[admin:create] 密码不合法：${pwCheck.message}`);
  process.exit(1);
}

await runMigrations();

const existing = (await db.select().from(adminUser).where(eq(adminUser.username, username)).limit(1))[0];

if (existing) {
  console.log(`[admin:create] 管理员 ${username} 已存在（${existing.id}），未改动密码。`);
  console.log("[admin:create] 需要改密：登录后台 →「管理员账号」→ 重置密码；或先删除该账号再重建。");
} else {
  const now = new Date();
  const row = {
    id: uid("adm"),
    username,
    passwordHash: hashPassword(password),
    name: username,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginIp: null,
  };
  await db.insert(adminUser).values(row);
  console.log(`[admin:create] 已创建后台管理员 ${username}（${row.id}）。`);
}

console.log("");
console.log("  用户名：" + username);
console.log("  密码：  " + (existing ? "（原有密码，未改动）" : password));
console.log("  后台：  /admin/（开发 http://localhost:5174/admin/）");
console.log("");
console.log("  后台账号与前台 App 账号完全独立，前台注册的用户不能登录后台。");
