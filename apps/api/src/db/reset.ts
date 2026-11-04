/* 清空本地数据库文件（开发期用）：删除 data/*.sqlite* 后重建表结构。
   注意：不能静态 import ./client.ts —— 它在模块加载时就会打开数据库文件并锁住，
   会导致删除失败。所以这里只删文件，再用动态 import 建立新连接。 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.ts";

const url = env.databaseUrl;
if (!url.startsWith("file:")) {
  console.error("[daybook] db:reset 只支持 file: 形式的本地 SQLite");
  process.exit(1);
}

const abs = resolve(url.slice("file:".length));
for (const suffix of ["", "-wal", "-shm"]) {
  const p = abs + suffix;
  if (existsSync(p)) {
    rmSync(p, { force: true });
    console.log(`[daybook] 已删除 ${p}`);
  }
}

const { runMigrations } = await import("./migrate.ts");
await runMigrations();
console.log(`[daybook] 已重建 ${abs}`);
process.exit(0);
