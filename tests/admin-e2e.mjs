/* 管理后台接口 e2e（需 pnpm -F @daybook/api dev 在 3001 运行）
   覆盖：鉴权 401/403、用户列表/详情、封禁后无法登录、解封、授权、强制下线、
        流水审计（物化列筛选）、软删/恢复后的 seq 与墓碑、统计、审计日志留痕。
   运行：node tests/admin-e2e.mjs */

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const ORIGIN = "http://localhost:5174";
import { execSync } from "node:child_process";

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function section(t) {
  console.log(`\n── ${t} ──`);
}

const jars = new Map();

function jar(name) {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name);
}

async function req(who, path, init = {}) {
  const cookies = jar(who);
  const cookieHeader = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const headers = { Origin: ORIGIN, ...(init.headers ?? {}) };
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const rnd = Math.random().toString(36).slice(2, 8);
const adminName = `adm_${rnd}`;
const adminPass = "AdminPass12345";
const victimName = `vic_${rnd}`;
const victimPass = "Passw0rd!2345";

/** 直接往 admin_user 插一条后台管理员（独立表，密码哈希与生产同参数） */
function createAdminRow(username, password) {
  const id = `adm_test_${username}`;
  const script =
    "const{createClient}=require('@libsql/client');" +
    "const{randomBytes,scryptSync}=require('node:crypto');" +
    "const[user,pass,id]=process.argv.slice(1);" +
    "const salt=randomBytes(16).toString('hex');" +
    "const key=scryptSync(pass,salt,64,{N:16384,r:16,p:1,maxmem:67108864}).toString('hex');" +
    "const now=Date.now();" +
    "const c=createClient({url:'file:./apps/api/data/daybook.sqlite'});" +
    "c.execute({sql:'insert into admin_user (id,username,password_hash,name,status,created_at,updated_at) values (?,?,?,?,?,?,?)',args:[id,user,salt+':'+key,user,'active',now,now]})" +
    ".then(()=>c.close()).catch(e=>{console.error(e);process.exit(1)})";
  execSync(`node -e "${script}" "${username}" "${password}" "${id}"`, { cwd: process.cwd(), stdio: "pipe" });
}

section("后台独立账号：登录与鉴权基线");
{
  // 清掉历史登录风控计数（本地 e2e 会连续多次登录，避免 20 次/小时误伤）
  execSync(
    `node -e "const{createClient}=require('@libsql/client');const c=createClient({url:'file:./apps/api/data/daybook.sqlite'});Promise.all([c.execute('delete from login_ip'),c.execute('delete from login_attempt')]).then(()=>c.close()).catch(e=>{console.error(e);process.exit(1)})"`,
    { cwd: process.cwd(), stdio: "pipe" },
  );

  const anon = await req("anon", "/api/admin/overview");
  ok("未登录访问后台 → 401", anon.status === 401, `got ${anon.status}`);

  const reg2 = await req("victim", "/api/auth/register", {
    method: "POST",
    json: { username: victimName, password: victimPass, acceptedTerms: true },
  });
  ok("普通用户注册成功", reg2.status === 200 && reg2.body?.user?.id, `got ${reg2.status}`);

  const notAdmin = await req("victim", "/api/admin/overview");
  ok("前台登录用户不能进后台 → 401", notAdmin.status === 401, `got ${notAdmin.status}`);

  const badLogin = await req("admin", "/api/admin/auth/login", {
    method: "POST",
    json: { username: adminName, password: "WrongPass123" },
  });
  ok("不存在的后台账号登录 → 401", badLogin.status === 401, `got ${badLogin.status}`);

  createAdminRow(adminName, adminPass);

  const login = await req("admin", "/api/admin/auth/login", {
    method: "POST",
    json: { username: adminName, password: adminPass },
  });
  ok("后台账号登录成功", login.status === 200 && login.body?.data?.username === adminName, `got ${login.status} ${JSON.stringify(login.body).slice(0, 120)}`);

  const me = await req("admin", "/api/admin/auth/me");
  ok("后台会话 /me 200 且 isSelf 数据一致", me.status === 200 && me.body?.data?.username === adminName, `got ${me.status}`);

  const r = await req("admin", "/api/admin/overview");
  ok("管理员访问概览 → 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  ok("概览含用户数", typeof r.body?.data?.users === "number", JSON.stringify(r.body?.data));
  ok("概览含管理员数", typeof r.body?.data?.admins === "number", JSON.stringify(r.body?.data));
  ok("概览含 7 日趋势数组", Array.isArray(r.body?.data?.trend), "trend missing");
  ok("概览含今日收支金额", typeof r.body?.data?.todayExpense === "number" && typeof r.body?.data?.todayIncome === "number", JSON.stringify(r.body?.data));
}

let victimId = null;

section("用户列表与详情");
{
  const list = await req("admin", `/api/admin/users?q=${victimName}&limit=5`);
  ok("按用户名搜索命中", list.status === 200 && list.body?.data?.length >= 1, JSON.stringify(list.body).slice(0, 200));
  victimId = list.body?.data?.[0]?.id ?? null;
  ok("返回脱敏邮箱", victimId && /@daybook.local/.test(list.body?.data?.[0]?.email ?? "") === false, "邮箱未脱敏或占位邮箱外露");

  const detail = await req("admin", `/api/admin/users/${victimId}`);
  ok("用户详情 200", detail.status === 200, `got ${detail.status}`);
  ok("详情不含密码/哈希/令牌", !/password|code_hash|tokenHash|"token"/.test(JSON.stringify(detail.body)), "疑似泄漏敏感字段");
  ok("详情含 sessions 数组", Array.isArray(detail.body?.data?.sessions), "sessions missing");
  ok("详情含 transactions 统计", typeof detail.body?.data?.transactions?.total === "number", "tx stat missing");
  ok("列表带流水概况", typeof list.body?.data?.[0]?.transactions?.total === "number", "transactions summary missing");
  ok("详情含账本结构字段 ledger", "ledger" in (detail.body?.data ?? {}), "ledger missing");
}

section("封禁 → 登录被拦截 → 解封");
{
  const ban = await req("admin", `/api/admin/users/${victimId}/ban`, {
    method: "POST",
    json: { reason: "e2e 测试封禁" },
  });
  ok("封禁成功", ban.status === 200, `got ${ban.status} ${JSON.stringify(ban.body)}`);

  const afterBan = await req("admin", `/api/admin/users/${victimId}`);
  ok("封禁状态已落库", afterBan.body?.data?.user?.banned === true, JSON.stringify(afterBan.body?.data?.user));

  // 被封禁用户重新登录必须失败
  const victimJar = jar("victim2");
  victimJar.clear();
  const login = await req("victim2", "/api/auth/login", {
    method: "POST",
    json: { username: victimName, password: victimPass },
  });
  ok("封禁后登录被拒（401/403）", login.status === 401 || login.status === 403, `got ${login.status} ${JSON.stringify(login.body).slice(0, 120)}`);

  const unban = await req("admin", `/api/admin/users/${victimId}/unban`, { method: "POST", json: {} });
  ok("解封成功", unban.status === 200, `got ${unban.status}`);

  const login2 = await req("victim3", "/api/auth/login", {
    method: "POST",
    json: { username: victimName, password: victimPass },
  });
  ok("解封后可以登录", login2.status === 200, `got ${login2.status}`);
}

section("强制下线");
{
  const before = await req("admin", `/api/admin/users/${victimId}`);
  const nBefore = before.body?.data?.sessions?.length ?? 0;
  ok("存在有效会话", nBefore >= 1, `sessions=${nBefore}`);

  const rv = await req("admin", `/api/admin/users/${victimId}/revoke-sessions`, { method: "POST", json: {} });
  ok("强制下线 200", rv.status === 200, `got ${rv.status}`);

  const after = await req("admin", `/api/admin/users/${victimId}`);
  ok("会话已清空", (after.body?.data?.sessions?.length ?? 0) === 0, `sessions=${after.body?.data?.sessions?.length}`);
}

section("流水审计：物化列筛选");
{
  const list = await req("admin", "/api/admin/transactions?limit=5");
  ok("流水列表 200", list.status === 200 && Array.isArray(list.body?.data), `got ${list.status}`);
  ok("流水带 amount/type/username", typeof list.body?.data?.[0]?.amount === "number" && list.body?.data?.[0]?.type, "字段缺失");
  ok("流水带前台口径的分类名/备注字段", "categoryName" in (list.body?.data?.[0] ?? {}) && typeof list.body?.data?.[0]?.note === "string", "名称解析字段缺失");
  ok("列表默认不含墓碑", list.body?.data?.every((t) => t.deleted === false), "出现已删除记录");

  const withDel = await req("admin", "/api/admin/transactions?limit=5&includeDeleted=1");
  ok("includeDeleted=1 可含墓碑", withDel.status === 200, `got ${withDel.status}`);

  const byType = await req("admin", "/api/admin/transactions?type=income&limit=5");
  ok("按类型筛选生效", byType.status === 200 && byType.body.data.every((t) => t.type === "income"), JSON.stringify(byType.body?.data?.map((t) => t.type)));

  const byAmt = await req("admin", "/api/admin/transactions?minAmount=1000&maxAmount=100000&limit=5");
  ok(
    "按金额区间筛选生效",
    byAmt.status === 200 && byAmt.body.data.every((t) => t.amount >= 1000 && t.amount <= 100000),
    JSON.stringify(byAmt.body?.data?.map((t) => t.amount)),
  );

  const first = list.body?.data?.[0];
  const detail = await req("admin", `/api/admin/transactions/${first.id}?userId=${first.userId}`);
  ok("流水详情含原始 payload", detail.status === 200 && detail.body?.data?.payload, `got ${detail.status}`);
}

section("软删 / 恢复：墓碑与 seq");
{
  const list = await req("admin", "/api/admin/transactions?limit=1");
  const tx = list.body.data[0];
  const beforeSeq = tx.seq;

  const del = await req("admin", `/api/admin/transactions/${tx.id}/delete?userId=${tx.userId}`, { method: "POST", json: {} });
  ok("软删 200", del.status === 200, `got ${del.status} ${JSON.stringify(del.body)}`);
  ok("软删后 seq 增大（否则设备拉不到）", del.body?.data?.seq > beforeSeq, `before=${beforeSeq} after=${del.body?.data?.seq}`);

  const detail = await req("admin", `/api/admin/transactions/${tx.id}?userId=${tx.userId}`);
  ok("墓碑已写入 payload.deletedAt", detail.body?.data?.payload?.deletedAt !== null, "payload.deletedAt 未更新");
  ok("物化 deletedAt 列已同步", detail.body?.data?.deletedAt !== null, "deleted_at 未同步");

  const again = await req("admin", `/api/admin/transactions/${tx.id}/delete?userId=${tx.userId}`, { method: "POST", json: {} });
  ok("重复软删被拒（400）", again.status === 400, `got ${again.status}`);

  const restore = await req("admin", `/api/admin/transactions/${tx.id}/restore?userId=${tx.userId}`, { method: "POST", json: {} });
  ok("恢复 200", restore.status === 200, `got ${restore.status}`);
  ok("恢复后 seq 再次增大", restore.body?.data?.seq > del.body?.data?.seq, "seq 未增长");

  const after = await req("admin", `/api/admin/transactions/${tx.id}?userId=${tx.userId}`);
  ok("恢复后墓碑清空", after.body?.data?.deletedAt === null && after.body?.data?.payload?.deletedAt === null, "墓碑未清");

  const restoreAgain = await req("admin", `/api/admin/transactions/${tx.id}/restore?userId=${tx.userId}`, { method: "POST", json: {} });
  ok("重复恢复被拒（400）", restoreAgain.status === 400, `got ${restoreAgain.status}`);
}

section("统计");
{
  const totals = await req("admin", "/api/admin/stats/totals");
  ok("总额 200", totals.status === 200, `got ${totals.status}`);
  ok("含 expense/income 分组", typeof totals.body?.data?.expense?.amount === "number", JSON.stringify(totals.body?.data));

  const cats = await req("admin", "/api/admin/stats/categories");
  ok("分类分布 200", cats.status === 200 && Array.isArray(cats.body?.data), `got ${cats.status}`);
  ok("分类含占比 share", cats.body?.data?.every((r) => typeof r.share === "number"), "share missing");

  const daily = await req("admin", "/api/admin/stats/daily");
  ok("日趋势 200", daily.status === 200 && Array.isArray(daily.body?.data), `got ${daily.status}`);
}

section("审计日志留痕");
{
  const audit = await req("admin", "/api/admin/audit?limit=20");
  ok("审计列表 200", audit.status === 200, `got ${audit.status}`);
  const actions = new Set((audit.body?.data ?? []).map((a) => a.action));
  ok("记录了 user.ban", actions.has("user.ban"), [...actions].join(","));
  ok("记录了 user.unban", actions.has("user.unban"), [...actions].join(","));
  ok("记录了 tx.soft-delete", actions.has("tx.soft-delete"), [...actions].join(","));
  ok("记录了 tx.restore", actions.has("tx.restore"), [...actions].join(","));
  ok("审计含管理员名", audit.body?.data?.[0]?.adminName, "adminName missing");
}

section("管理员账号管理（后台独立体系）");
{
  const meRes = await req("admin", "/api/admin/auth/me");
  const meId = meRes.body?.data?.id;

  const list = await req("admin", "/api/admin/auth/accounts");
  ok("管理员列表 200", list.status === 200 && Array.isArray(list.body?.data), `got ${list.status}`);
  ok("列表标记当前账号 isSelf", list.body?.data?.some((a) => a.username === adminName && a.isSelf === true), JSON.stringify(list.body?.data));
  ok("列表不含前台用户", !list.body?.data?.some((a) => a.username === victimName), JSON.stringify(list.body?.data?.map((a) => a.username)));
  ok("列表不含密码哈希", !/password_hash|passwordHash/.test(JSON.stringify(list.body)), "疑似泄漏哈希");

  const opsName = `ops_${rnd}`;
  const create = await req("admin", "/api/admin/auth/accounts", {
    method: "POST",
    json: { username: opsName, password: "OpsPass12345", name: "测试运营" },
  });
  ok("新建管理员 200", create.status === 200 && create.body?.data?.username === opsName, `got ${create.status} ${JSON.stringify(create.body)}`);
  const opsId = create.body?.data?.id;

  const dup = await req("admin", "/api/admin/auth/accounts", {
    method: "POST",
    json: { username: opsName, password: "OpsPass12345" },
  });
  ok("同名管理员被拒 409", dup.status === 409, `got ${dup.status}`);

  const weak = await req("admin", "/api/admin/auth/accounts", {
    method: "POST",
    json: { username: `weak_${rnd}`, password: "12345678" },
  });
  ok("弱密码被拒 400", weak.status === 400, `got ${weak.status}`);

  const login2 = await req("admin2", "/api/admin/auth/login", {
    method: "POST",
    json: { username: opsName, password: "OpsPass12345" },
  });
  ok("新管理员可登录后台", login2.status === 200, `got ${login2.status}`);

  const reset = await req("admin", `/api/admin/auth/accounts/${opsId}/password`, {
    method: "POST",
    json: { password: "OpsPass54321" },
  });
  ok("重置密码 200", reset.status === 200, `got ${reset.status}`);

  const afterReset = await req("admin2", "/api/admin/auth/me");
  ok("重置后旧会话失效 401", afterReset.status === 401, `got ${afterReset.status}`);

  const login3 = await req("admin2", "/api/admin/auth/login", {
    method: "POST",
    json: { username: opsName, password: "OpsPass54321" },
  });
  ok("新密码可登录", login3.status === 200, `got ${login3.status}`);

  const disable = await req("admin", `/api/admin/auth/accounts/${opsId}/status`, {
    method: "POST",
    json: { status: "disabled" },
  });
  ok("停用管理员 200", disable.status === 200, `got ${disable.status}`);

  const login4 = await req("admin2", "/api/admin/auth/login", {
    method: "POST",
    json: { username: opsName, password: "OpsPass54321" },
  });
  ok("停用后无法登录 401", login4.status === 401, `got ${login4.status}`);

  const enable = await req("admin", `/api/admin/auth/accounts/${opsId}/status`, {
    method: "POST",
    json: { status: "active" },
  });
  ok("启用管理员 200", enable.status === 200, `got ${enable.status}`);

  const selfDisable = await req("admin", `/api/admin/auth/accounts/${meId}/status`, {
    method: "POST",
    json: { status: "disabled" },
  });
  ok("不能停用自己 409", selfDisable.status === 409, `got ${selfDisable.status}`);

  const del = await req("admin", `/api/admin/auth/accounts/${opsId}`, { method: "DELETE" });
  ok("删除管理员 200", del.status === 200, `got ${del.status}`);

  const list2 = await req("admin", "/api/admin/auth/accounts");
  ok("删除后列表不再包含", !list2.body?.data?.some((a) => a.id === opsId), JSON.stringify(list2.body?.data?.map((a) => a.username)));

  const selfDel = await req("admin", `/api/admin/auth/accounts/${meId}`, { method: "DELETE" });
  ok("不能删除自己 409", selfDel.status === 409, `got ${selfDel.status}`);

  const audit = await req("admin", "/api/admin/audit?limit=50");
  const actions = new Set((audit.body?.data ?? []).map((a) => a.action));
  ok("审计记录了 admin.create", actions.has("admin.create"), [...actions].join(","));
  ok("审计记录了 admin.reset-password", actions.has("admin.reset-password"), [...actions].join(","));
  ok("审计记录了 admin.disable / admin.delete", actions.has("admin.disable") && actions.has("admin.delete"), [...actions].join(","));
}

section("系统信息");
{
  const sys = await req("admin", "/api/admin/system");
  ok("系统信息 200", sys.status === 200, `got ${sys.status}`);
  ok("含各表行数", typeof sys.body?.data?.tables?.user === "number", JSON.stringify(sys.body?.data?.tables));
}

console.log(`\n${"─".repeat(48)}`);
console.log(`通过 ${pass} 条，失败 ${fail} 条`);
if (fail) {
  console.log("失败项：");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}

