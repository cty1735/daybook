/* 后端端到端验证：注册/登录（用户名+密码）→ push → pull → LWW → 墓碑 → 双设备 → 用户状态
   → 账号体系（大小写登录、改密、恢复码、设备、锁定、登出） */
const BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
/** 每次运行用不同 IP，避免同一 IP 每小时 20 次登录限流影响反复调试 */
const TEST_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const jar = new Map();
function absorb(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v === "" || v === "deleted") jar.delete(k);
    else jar.set(k, v);
  }
}
function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function call(path, { method = "GET", body, useJar = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      // better-auth 的 CSRF 保护要求 POST 带 Origin；浏览器会自动带，脚本需显式加
      origin: ORIGIN,
      "x-forwarded-for": TEST_IP,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(useJar && jar.size ? { cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const username = `tester${Date.now().toString(36).slice(-6)}`;
const PASSWORD = "Daybook2026x";
const now = Date.now();
const mkT = (id, amount, updatedAt, extra = {}) => ({
  id,
  type: "expense",
  amount,
  currency: "CNY",
  categoryId: "cat_food",
  parentCategoryId: "cat_food",
  accountId: "acc_cash",
  toAccountId: null,
  occurredAt: now,
  note: "e2e",
  createdAt: now,
  updatedAt,
  deletedAt: null,
  source: "manual",
  ...extra,
});

// 0) 健康检查
const health = await call("/api/health");
check("健康检查", health.status === 200 && health.json?.ok === true, JSON.stringify(health.json));

// 1) 未登录访问同步接口应 401
const anon = await call("/api/sync/pull?cursor=0");
check("未登录 pull 返回 401", anon.status === 401, `status=${anon.status}`);

// 2) 注册（用户名 + 密码）
const reg = await call("/api/auth/register", {
  method: "POST",
  body: { username, password: PASSWORD, acceptedTerms: true },
});
check(
  "注册成功并返回恢复码",
  reg.status === 200 && reg.json?.user?.username === username && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reg.json?.recoveryCode ?? ""),
  `status=${reg.status} ${reg.text.slice(0, 160)}`,
);
const recoveryCode = reg.json?.recoveryCode;

// 3) 注册后自动登录（拿到会话 Cookie）
check("注册后拿到会话 Cookie", jar.size > 0, [...jar.keys()].join(","));

// 4) 会话校验
const sess = await call("/api/auth/session");
check("session 返回当前用户名", sess.json?.user?.username === username, JSON.stringify(sess.json).slice(0, 160));
check("session 不泄露内部占位邮箱", sess.json?.user?.email === null, String(sess.json?.user?.email));

// 6) push：2 条新记录
const t1 = mkT("tx_e2e_1", 1200, now - 1000);
const t2 = mkT("tx_e2e_2", 3400, now - 900);
const push1 = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_A", cursor: 0, transactions: [t1, t2] },
});
check("push 两条新记录被接受", push1.json?.accepted === 2 && push1.json?.rejected === 0, JSON.stringify(push1.json));

// 7) pull：应拿到 2 条
const pull1 = await call("/api/sync/pull?cursor=0&limit=500");
check(
  "pull 拿到 2 条并推进游标",
  pull1.json?.transactions?.length === 2 && pull1.json?.cursor >= 2 && pull1.json?.hasMore === false,
  `cursor=${pull1.json?.cursor} n=${pull1.json?.transactions?.length}`,
);

// 8) 幂等：同一份数据重推不应产生新版本
const push2 = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_A", cursor: pull1.json.cursor, transactions: [t1, t2] },
});
check("重复推送被拒（幂等）", push2.json?.accepted === 0 && push2.json?.rejected === 2, JSON.stringify(push2.json));

// 9) LWW：旧版本被拒
const stale = { ...t1, amount: 999, updatedAt: now - 5000 };
const push3 = await call("/api/sync/push", { method: "POST", body: { deviceId: "dev_B", cursor: 0, transactions: [stale] } });
check("旧版本被拒（LWW）", push3.json?.accepted === 0 && push3.json?.rejected === 1, JSON.stringify(push3.json));

// 10) LWW：新版本被接受（另一台设备）
const newer = { ...t1, amount: 1500, updatedAt: now + 10000 };
const push4 = await call("/api/sync/push", { method: "POST", body: { deviceId: "dev_B", cursor: 0, transactions: [newer] } });
check("新版本被接受", push4.json?.accepted === 1, JSON.stringify(push4.json));

// 11) 从 dev_A 的旧游标增量拉取，应该看到被更新后的那条（seq 重新分配）
const pull2 = await call(`/api/sync/pull?cursor=${pull1.json.cursor}&limit=500`);
const got = pull2.json?.transactions ?? [];
const updated = got.find((t) => t.id === "tx_e2e_1");
check(
  "就地更新能被增量拉到",
  updated?.amount === 1500 && got.length >= 1,
  `n=${got.length} amount=${updated?.amount}`,
);

// 12) 墓碑：删除 t2
const tomb = { ...t2, deletedAt: now + 20000, updatedAt: now + 20000 };
const push5 = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_A", cursor: pull2.json.cursor, transactions: [tomb] },
});
check("墓碑推送被接受", push5.json?.accepted === 1, JSON.stringify(push5.json));

// 13) 同分时墓碑优先
const afterTomb = await call(`/api/sync/pull?cursor=${pull2.json.cursor}&limit=500`);
const tombBack = (afterTomb.json?.transactions ?? []).find((t) => t.id === "tx_e2e_2");
check("墓碑随增量下发", tombBack?.deletedAt !== null && tombBack?.deletedAt !== undefined, `deletedAt=${tombBack?.deletedAt}`);

// 14) 用户级状态整包 LWW
const stateV1 = {
  categories: [
    { id: "cat_food", parentId: null, name: "餐饮", kind: "expense", icon: "food", color: "#F0A", sortOrder: 0, isHidden: false, noteTemplate: "" },
  ],
  accounts: [
    { id: "acc_cash", name: "现金", type: "cash", initialBalance: 0, includeInAssets: true, isArchived: false, creditLimit: 0 },
  ],
  budget: { period: "monthly", startDay: 1, totalAmount: 500000, categoryLimits: {}, rollover: false },
  settings: { theme: "system", usageStats: false },
  categoryUsage: {},
  lastUsedCategoryId: null,
  lastUsedAccountId: null,
};
const sPush = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_A", cursor: 0, transactions: [], state: { payload: stateV1, updatedAt: now + 30000 } },
});
check("用户状态整包接受", sPush.json?.stateAccepted === true, JSON.stringify(sPush.json));

const sOld = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_B", cursor: 0, transactions: [], state: { payload: { ...stateV1, budget: { ...stateV1.budget, totalAmount: 1 } }, updatedAt: now - 5000 } },
});
check("更旧的用户状态被拒（整包 LWW）", sOld.json?.stateAccepted === false, JSON.stringify(sOld.json));

const pullState = await call("/api/sync/pull?cursor=0&limit=1");
check("pull 带回用户状态", pullState.json?.state?.payload?.budget?.totalAmount === 500000, JSON.stringify(pullState.json?.state?.updatedAt));

// 15) 校验层：非法 payload 应 400
const bad = await call("/api/sync/push", {
  method: "POST",
  body: { deviceId: "dev_A", cursor: 0, transactions: [{ id: "x", type: "nope" }] },
});
check("非法变更被 400 拦下", bad.status === 400, `status=${bad.status}`);

// 16) 分页：limit=1 时 hasMore 应为 true
const paged = await call("/api/sync/pull?cursor=0&limit=1");
check("分页 hasMore 正确", paged.json?.transactions?.length === 1 && paged.json?.hasMore === true, JSON.stringify({ n: paged.json?.transactions?.length, hasMore: paged.json?.hasMore }));

// 17) 退出登录：只销毁会话，本机数据不动
await call("/api/auth/logout", { method: "POST", body: {} });
const afterOut = await call("/api/sync/pull?cursor=0");
check("退出后 pull 返回 401", afterOut.status === 401, `status=${afterOut.status}`);
const sessOut = await call("/api/auth/session");
check("退出后 session 为空", sessOut.json?.user === null, JSON.stringify(sessOut.json));

// 18) 用户名大小写不敏感
const loginUpper = await call("/api/auth/login", {
  method: "POST",
  body: { username: username.toUpperCase(), password: PASSWORD },
});
check(
  "用户名大小写不敏感登录",
  loginUpper.status === 200 && loginUpper.json?.user?.username === username,
  `status=${loginUpper.status} ${loginUpper.text.slice(0, 120)}`,
);
check("登录响应不回传 token", loginUpper.json?.token === undefined, String(loginUpper.json?.token));

// 19) 登录失败统一文案（不泄露用户名是否存在）
const wrongPw = await call("/api/auth/login", { method: "POST", body: { username, password: "Passw0rd1X" }, useJar: false });
check("密码错误文案统一", wrongPw.status === 401 && wrongPw.json?.message === "用户名或密码不正确", `${wrongPw.status} ${wrongPw.json?.message}`);
const unknownUser = await call("/api/auth/login", {
  method: "POST",
  body: { username: `nobody${Date.now().toString(36).slice(-4)}`, password: PASSWORD },
  useJar: false,
});
check("用户名不存在同一文案", unknownUser.status === 401 && unknownUser.json?.message === "用户名或密码不正确", `${unknownUser.status} ${unknownUser.json?.message}`);

// 20) 已登录设备列表
const devs = await call("/api/auth/sessions");
check(
  "设备列表包含当前设备",
  devs.status === 200 && Array.isArray(devs.json?.sessions) && devs.json.sessions.some((s) => s.current),
  JSON.stringify(devs.json?.sessions?.map?.((s) => [s.device, s.current])),
);

// 21) 修改密码：旧密码失效，新密码可用
const NEW_PW = "{{SECRET_xq7m2vnd}}";
const chpw = await call("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: NEW_PW } });
check("修改密码成功", chpw.status === 200, `status=${chpw.status} ${chpw.text.slice(0, 120)}`);
const oldLogin = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD }, useJar: false });
check("改密后旧密码失效", oldLogin.status === 401, `status=${oldLogin.status}`);
const newLogin = await call("/api/auth/login", { method: "POST", body: { username, password: NEW_PW } });
check("改密后新密码可登录", newLogin.status === 200, `status=${newLogin.status}`);

// 22) 恢复码重置：全部旧会话失效
const reset = await call("/api/auth/reset-password", { method: "POST", body: { username, code: recoveryCode, newPassword: PASSWORD } });
check("恢复码重置密码成功", reset.status === 200, `status=${reset.status} ${reset.text.slice(0, 120)}`);
const sessAfterReset = await call("/api/auth/session");
check("重置后旧会话失效", sessAfterReset.json?.user === null, JSON.stringify(sessAfterReset.json));
const backLogin = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
check("重置后新密码可登录", backLogin.status === 200, `status=${backLogin.status}`);

// 23) 连续 5 次失败 → 锁定 15 分钟（期间正确密码也不放行）
const lockUser = `lock${Date.now().toString(36).slice(-6)}`;
await call("/api/auth/register", { method: "POST", body: { username: lockUser, password: PASSWORD, acceptedTerms: true } });
for (let i = 0; i < 5; i++) {
  await call("/api/auth/login", { method: "POST", body: { username: lockUser, password: "Passw0rd1x" }, useJar: false });
}
const locked = await call("/api/auth/login", { method: "POST", body: { username: lockUser, password: PASSWORD }, useJar: false });
check(
  "5 次失败后账号锁定",
  locked.status === 429 && /15 分钟/.test(locked.json?.message ?? ""),
  `${locked.status} ${locked.json?.message}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(` - ${f.name} :: ${f.detail}`);
  process.exit(1);
}