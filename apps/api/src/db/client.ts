/* 数据库客户端：libSQL（SQLite 文件模式）
   选它而不是 better-sqlite3 的原因：预编译二进制走 npm registry，
   不需要访问 GitHub Releases，也不需要本机 C++ 构建工具链。 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

/** 把 `file:./data/daybook.sqlite` 里的目录先建出来，避免首次启动失败 */
function ensureDir(url: string): void {
  const filePath = url.startsWith("file:") ? url.slice("file:".length) : null;
  if (!filePath || filePath.startsWith(":memory:")) return;
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });
}

ensureDir(env.databaseUrl);

export const client = createClient({ url: env.databaseUrl });

export const db = drizzle(client, { schema });

export type DB = typeof db;
