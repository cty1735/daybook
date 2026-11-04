/* 直接从 SQLite 文件侧核对同步落库情况
   用法：node tests/db-inspect.mjs [file:.../daybook.sqlite] */

import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const defaultDb = fileURLToPath(new URL("../apps/api/data/daybook.sqlite", import.meta.url));
const url = process.argv[2] ?? `file:${defaultDb}`;
console.log("数据库：", url);
const db = createClient({ url });

const tables = await db.execute("select name from sqlite_master where type='table' order by name");
console.log("表：", tables.rows.map((r) => r.name).join(", "));

const tx = await db.execute("select count(*) as n, count(distinct user_id) as users from ledger_transactions");
console.log("ledger_transactions：", tx.rows[0]);

const seq = await db.execute("select min(seq) as minSeq, max(seq) as maxSeq from ledger_transactions");
console.log("seq 范围：", seq.rows[0]);

const state = await db.execute("select count(*) as n from user_state");
console.log("user_state：", state.rows[0]);

const users = await db.execute("select email, email_verified from user order by created_at");
console.log("用户：", users.rows.map((r) => `${r.email}(verified=${r.email_verified})`).join(" | "));

const devs = await db.execute("select id, user_id, pushes, pulls from devices");
console.log("设备：", devs.rows.map((r) => `${r.id} push=${r.pushes} pull=${r.pulls}`).join(" | "));

const sample = await db.execute("select id, seq, updated_at, deleted_at, substr(payload,1,60) as head from ledger_transactions order by seq desc limit 3");
console.log("最近写入：", JSON.stringify(sample.rows, null, 1));

const mig = await db.execute("select hash, created_at from __drizzle_migrations limit 1");
console.log("迁移记录：", mig.rows[0]);
