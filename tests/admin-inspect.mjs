import { createClient } from "@libsql/client";

const c = createClient({ url: "file:./apps/api/data/daybook.sqlite" });

const r = await c.execute(
  "select username, display_username, role, banned, status from user where username is not null order by created_at desc limit 10",
);
console.log("用户：");
for (const row of r.rows) console.log(" ", JSON.stringify(row));

const m = await c.execute(
  "select count(*) n, sum(case when amount<>0 then 1 else 0 end) withAmount, sum(case when tx_type<>'expense' then 1 else 0 end) nonExpense from ledger_transactions",
);
console.log("物化列回填：", JSON.stringify(m.rows[0]));

const s = await c.execute("select count(*) n from admin_audit_log");
console.log("审计日志：", JSON.stringify(s.rows[0]));

await c.close();
