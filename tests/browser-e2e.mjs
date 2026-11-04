// 浏览器端到端验证：IndexedDB 持久化 + 浏览器内云同步闭环
//
// 用法：
//   node tests/browser-e2e.mjs                        # 自动拉起无头 Chrome
//   node tests/browser-e2e.mjs <debugPort> <origin>    # 连接已在运行的 Chrome
//
// 前置：先跑 `pnpm dev`（或分别启动 api:3001 与 web:5173）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const argPort = process.argv[2];
const port = argPort || "9333";
const origin = process.argv[3] || "http://127.0.0.1:5173";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------- 自动拉起 / 收尾无头 Chrome --------------------- */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? "chrome";
}

let chromeProc = null;
let profileDir = null;
if (!argPort) {
  profileDir = join(process.env.TEMP ?? "/tmp", `daybook-e2e-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  chromeProc = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=430,932",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
}

function killChrome() {
  if (!chromeProc?.pid) return;
  try {
    spawnSync("taskkill", ["/PID", String(chromeProc.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      chromeProc.kill();
    } catch {
      /* 已退出 */
    }
  }
}

function removeProfile() {
  if (!profileDir) return;
  // Windows 上 Chrome 退出的瞬间文件句柄可能还没释放，重试几次
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      return;
    } catch {
      /* 重试 */
    }
  }
}

process.on("exit", () => {
  killChrome();
  removeProfile();
});
process.on("SIGINT", () => {
  killChrome();
  removeProfile();
  process.exit(130);
});

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === "page");
      if (t) return t;
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(500);
  }
  throw new Error("no page target");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.exceptions.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "unknown");
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
const cdp = new Cdp(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });

// ---------- 工具函数（注入到页面上下文） ----------
const HELPERS = `
window.__db = () => new Promise((resolve) => {
  const req = indexedDB.open('daybook');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('transactions', 'readonly');
    const c = tx.objectStore('transactions').count();
    c.onsuccess = () => resolve({ count: c.result, stores: [...db.objectStoreNames] });
    c.onerror = () => resolve({ error: 'count failed' });
  };
  req.onerror = () => resolve({ error: 'open failed' });
});
window.__store = () => {
  const el = document.querySelector('#root');
  return el ? el.innerText : '';
};
window.__clickText = (txt) => {
  const all = [...document.querySelectorAll('button, a, .tab, .setting-row, .link-btn')];
  const el = all.find((e) => (e.textContent || '').trim() === txt) || all.find((e) => (e.textContent || '').includes(txt));
  if (!el) return false;
  el.click();
  return true;
};
window.__type = (sel, text) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
window.__pressKeys = async (keys) => {
  const keypad = () => [...document.querySelectorAll('button.key')].filter((b) => !b.classList.contains('done'));
  for (const k of keys) {
    const b = keypad().find((x) => (x.textContent || '').trim() === k);
    if (!b) return 'missing:' + k;
    b.click();
    // React 渲染是异步提交的，必须等一下再点下一个/再读 disabled
    await new Promise((r) => setTimeout(r, 220));
  }
  let done = document.querySelector('button.key.done');
  if (!done) return 'no-done-button';
  if (done.disabled) {
    await new Promise((r) => setTimeout(r, 250));
    done = document.querySelector('button.key.done');
  }
  if (!done || done.disabled) return 'done-disabled';
  done.click();
  return 'ok';
};
`;

const goto = async (hash = "", { fresh = false } = {}) => {
  // ?r= 必须放在 hash 之前，否则会被当成 hash 的一部分
  const clean = hash.replace(/^#?\/?/, "");
  const suffix = clean ? `#/${clean}` : "";
  const url = `${origin}/?r=${Math.floor(Math.random() * 1e6)}${suffix}`;
  await cdp.send("Page.navigate", { url });
  await sleep(fresh ? 2800 : 1800);
};

/** 在已加载的页面上用 hashchange 打开二级页（这是 App 的主路径） */
const openSheet = async (route) => {
  await cdp.ev(`location.hash = ${JSON.stringify("#/" + route)}`);
  await sleep(1200);
};

// ---------- 1) 冷启动 ----------
await goto("");
await cdp.ev(HELPERS);
let rootText = await cdp.ev("document.querySelector('#root').innerText");
check("应用完成渲染（非空白）", rootText.length > 60, `len=${rootText.length}`);
check("引导态已结束（出现底部导航）", rootText.includes("首页") && rootText.includes("明细"), rootText.slice(0, 60).replace(/\n/g, "|"));

const dbInfo = await cdp.ev("window.__db()");
check("IndexedDB 名为 daybook 且建好索引表", (dbInfo.stores ?? []).includes("transactions") && (dbInfo.stores ?? []).includes("outbox") && (dbInfo.stores ?? []).includes("snapshots"), JSON.stringify(dbInfo.stores));
const seeded = dbInfo.count;
check("首次启动预置示例数据（≥16 条）", seeded >= 16, `count=${seeded}`);

// ---------- 2) 记一笔 → 写 IndexedDB ----------
await cdp.ev("document.querySelector('.fab').click()");
await sleep(700);
const keyResult = await cdp.ev("window.__pressKeys(['1','2'])");
check("金额键盘输入 1、2 后完成", keyResult === "ok", keyResult);
await sleep(900);
const afterAdd = await cdp.ev("window.__db()");
check("新增记录已写入 IndexedDB", afterAdd.count === seeded + 1, `${seeded} → ${afterAdd.count}`);

// ---------- 3) 刷新后仍在（证明持久化在 IndexedDB 而非内存） ----------
await cdp.send("Page.reload", { ignoreCache: false });
await sleep(2800);
await cdp.ev(HELPERS);
const afterReload = await cdp.ev("window.__db()");
check("整页刷新后数据仍在", afterReload.count === seeded + 1, `count=${afterReload.count}`);

const outboxInfo = await cdp.ev(`new Promise((resolve)=>{const r=indexedDB.open('daybook');r.onsuccess=()=>{const db=r.result;const t=db.transaction('outbox','readonly');const c=t.objectStore('outbox').count();c.onsuccess=()=>resolve(c.result)}})`);
check("outbox 记录了待推送变更", outboxInfo >= 1, `outbox=${outboxInfo}`);

// ---------- 4) 旧 localStorage 迁移 ----------
await cdp.ev(`window.__legacySeed = (() => {
  const tx = [{ id: 'tx_legacy_1', type: 'expense', amount: 8888, currency: 'CNY', categoryId: null, parentCategoryId: null, accountId: 'acc_cash', toAccountId: null, occurredAt: Date.now(), note: 'legacy', createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, source: 'manual' }];
  localStorage.setItem('daybook.v1', JSON.stringify({ state: { schemaVersion: 1, categories: [{ id: 'cat_legacy', parentId: null, name: '旧数据', kind: 'expense', icon: 'tag', color: '#35B87A', sortOrder: 0, isHidden: false, noteTemplate: '' }], accounts: [], transactions: tx, budget: { period: 'monthly', startDay: 1, totalAmount: 100000, categoryLimits: {}, rollover: false }, settings: { theme: 'dark', usageStats: false } } }));
  return true;
})()`);
await cdp.ev(`new Promise((resolve)=>{const r=indexedDB.deleteDatabase('daybook');r.onsuccess=()=>resolve(true);r.onerror=()=>resolve(false);r.onblocked=()=>resolve(false)})`);
await goto("", { fresh: true });
await cdp.ev(HELPERS);
const migrated = await cdp.ev("window.__db()");
check("旧 localStorage 数据被迁移进 IndexedDB", migrated.count === 1, `count=${migrated.count}`);
const legacyNote = await cdp.ev(`document.body.innerText.includes('legacy') || document.body.innerText.includes('旧数据')`);
check("迁移后的数据可见", legacyNote === true, String(legacyNote));

// ---------- 5) 浏览器内云同步闭环 ----------
// 先恢复成有示例数据的干净库，再登录同步
await cdp.ev(`localStorage.removeItem('daybook.v1'); localStorage.removeItem('daybook.seeded')`);
await cdp.ev(`Promise.all([indexedDB.deleteDatabase('daybook')]).then(()=>true)`);
await goto("", { fresh: true });
await cdp.ev(HELPERS);
const beforeSync = await cdp.ev("window.__db()");
check("重新初始化后有示例数据", (beforeSync.count ?? 0) >= 16, `count=${beforeSync.count}`);

await goto("");
await cdp.ev(HELPERS);
await openSheet("sync");
const syncText = await cdp.ev("document.body.innerText");
check("云同步页已打开", syncText.includes("云同步") && syncText.includes("登录"), syncText.slice(0, 80).replace(/\n/g, "|"));
check("后端连通性检测通过", syncText.includes("正常"), syncText.match(/后端服务[\s\S]{0,40}/)?.[0]?.replace(/\n/g, "|") ?? "");

// 去注册（PRD F0：用户名 + 密码）
const USERNAME = `browser${Date.now().toString(36).slice(-6)}`;
const PASSWORD = "Passw0rd2026";
await cdp.ev("window.__clickText('登录 / 注册')");
await sleep(900);
const loginText = await cdp.ev("document.body.innerText");
check("登录页已打开", loginText.includes("保持登录") && loginText.includes("忘记密码"), loginText.slice(0, 60).replace(/\n/g, "|"));

await cdp.ev("window.__clickText('还没有账号？注册')");
await sleep(900);
const regText = await cdp.ev("document.body.innerText");
check("注册页已打开", regText.includes("确认密码") && regText.includes("邮箱"), regText.slice(0, 60).replace(/\n/g, "|"));

await cdp.ev(`window.__type('input[autocomplete=username]', ${JSON.stringify(USERNAME)})`);
const filled = await cdp.ev(`(() => {
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const pw = document.querySelectorAll('input[autocomplete=new-password]');
  set(pw[0], ${JSON.stringify(PASSWORD)});
  set(pw[1], ${JSON.stringify(PASSWORD)});
  return pw.length;
})()`);
check("两个密码框都可写入", filled === 2, `n=${filled}`);
await cdp.ev("document.querySelector('input[type=checkbox]').click()");
await sleep(400);
const clickedRegister = await cdp.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '注册'); if (!b || b.disabled) return 'no'; b.click(); return 'ok'; })()`);
check("点击注册按钮", clickedRegister === "ok", String(clickedRegister));
await sleep(2500);
const afterRegText = await cdp.ev("document.body.innerText");
const code = (afterRegText.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/) ?? [])[0] ?? "";
check("注册成功并展示恢复码", /恢复码/.test(afterRegText) && code.length === 9, `code=${code}`);
await cdp.ev("window.__clickText('我已保存，进入记账')");
await sleep(5000);

const afterSyncText = await cdp.ev("document.body.innerText");
const pushedN = Number((afterSyncText.match(/推送 (\d+) 条/) ?? [])[1] ?? -1);
const pulledN = Number((afterSyncText.match(/拉取 (\d+) 条/) ?? [])[1] ?? -1);
check("首次同步把本机全部记录上传", pushedN >= 16, `pushed=${pushedN} :: ${afterSyncText.match(/推送[^\n]{0,80}/)?.[0] ?? "无结果行"}`);
check("显示同步结果含游标推进", /游标 \d+/.test(afterSyncText), afterSyncText.match(/游标[^\n]{0,20}/)?.[0] ?? "");
check("服务端返回了记录（拉取数 >= 本机数）", pulledN >= 16, `pulled=${pulledN}`);
check("显示已登录用户名", afterSyncText.includes(USERNAME), USERNAME);
check("待推送队列已清空", /0 条待推送/.test(afterSyncText), afterSyncText.match(/\d+ 条待推送/)?.[0] ?? "");

// 账号与安全 → 退出登录
await cdp.ev("window.__clickText('账号')");
await sleep(1200);
const acctText = await cdp.ev("document.body.innerText");
check("账号与安全页显示用户名与设备", acctText.includes(USERNAME) && (acctText.includes("已登录设备") || acctText.includes("当前设备")), acctText.slice(0, 80).replace(/\n/g, "|"));
await cdp.ev("window.__clickText('退出登录')");
await sleep(2200);
const afterLogout = await cdp.ev("document.body.innerText");
const dbAfterLogout = await cdp.ev("window.__db()");
check("退出登录后回到未登录态", afterLogout.includes("未登录") || afterLogout.includes("登录 / 注册"), afterLogout.slice(0, 80).replace(/\n/g, "|"));
check("退出登录后本机数据仍保留", (dbAfterLogout.count ?? 0) >= 16, `count=${dbAfterLogout.count}`);

console.log("\n浏览器账号：" + USERNAME);
console.log("已同步记录数：" + (await cdp.ev("window.__db()")).count);

// ---------- 6) 控制台干净 ----------
check("无未捕获异常", cdp.exceptions.length === 0, cdp.exceptions.join(" | ").slice(0, 400));
check("无 console.error", cdp.consoleErrors.length === 0, cdp.consoleErrors.join(" | ").slice(0, 400));

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(` - ${f.name} :: ${f.detail}`);
}

// 主动收尾：先杀 Chrome，等句柄释放，再删临时 profile（exit 钩子只是兜底）
killChrome();
await sleep(600);
removeProfile();
process.exit(failed.length ? 1 : 0);