/* 迁移执行器：把 drizzle/ 下生成的 SQL 应用到 SQLite（幂等，可重复运行） */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./client.ts";

// Windows 下必须用 fileURLToPath，pathname 会得到 /D:/... 这种非法路径
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(): Promise<void> {
  try {
    readdirSync(MIGRATIONS_FOLDER);
  } catch {
    throw new Error(`找不到迁移目录 ${MIGRATIONS_FOLDER}，请先执行 pnpm db:generate`);
  }
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

// 允许直接 `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  await runMigrations();
  console.log("[daybook] 迁移完成");
  process.exit(0);
}
