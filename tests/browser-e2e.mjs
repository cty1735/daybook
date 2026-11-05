// 浏览器端到端验证：登录门禁 + 服务端实时读写闭环
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
window.__data = async () => {
  const r = await fetch('/api/data', { credentials: 'include' });
  if (!r.ok) return { status: r.status };
  return r.json();
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
  await sleep(fresh ? 3000 : 2000);
};

// ---------- 1) 冷启动：未登录也能进首页（不强制登录） ----------
await goto("");
await cdp.ev(HELPERS);
const coldText = await cdp.ev("document.body.innerText");
check("应用完成渲染（非空白）", coldText.length > 60, `len=${coldText.length}`);
check(
  "未登录直接进首页（不弹注册登录）",
  coldText.includes("今日支出") && coldText.includes("免费注册"),
  coldText.slice(0, 80).replace(/\n/g, "|"),
);
check("未登录也显示底部导航", (await cdp.ev("document.querySelector('.tabbar') !== null")) === true, "tabbar");
const anonData = await cdp.ev("window.__data()");
check("未登录访问 /api/data 返回 401", anonData?.status === 401, `status=${anonData?.status}`);
check(
  "前端不再使用 IndexedDB 存数据",
  (await cdp.ev("typeof indexedDB.databases === 'function' ? indexedDB.databases().then(l => !l.some(d => d.name === 'daybook')) : true")) === true,
  "indexeddb",
);

// ---------- 2) 注册（用户名 + 密码） ----------
const USERNAME = `browser${Date.now().toString(36).slice(-6)}`;
const PASSWORD = "Passw0rd2026";
await cdp.ev("window.__clickText('免费注册')");
await sleep(900);
const regText = await cdp.ev("document.body.innerText");
check("注册页已打开", regText.includes("确认密码") && regText.includes("邮箱"), regText.slice(0, 60).replace(/\n/g, "|"));

// 登录页仍在栈底，必须取最后一个 username 输入框（注册页在最上层）
const usernameFilled = await cdp.ev(`(() => {
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const els = document.querySelectorAll('input[autocomplete=username]');
  if (!els.length) return 0;
  set(els[els.length - 1], ${JSON.stringify(USERNAME)});
  return els.length;
})()`);
check("用户名可写入（注册页在最上层）", usernameFilled >= 1, `n=${usernameFilled}`);
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
const clickedRegister = await cdp.ev(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '注册'); if (!b || b.disabled) return 'no'; b.click(); return 'ok'; })()`,
);
check("点击注册按钮", clickedRegister === "ok", String(clickedRegister));
await sleep(3200);
const afterRegText = await cdp.ev("document.body.innerText");
const code = (afterRegText.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/) ?? [])[0] ?? "";
check("注册成功并展示恢复码", /恢复码/.test(afterRegText) && code.length === 9, `code=${code}`);
await cdp.ev("window.__clickText('我已保存，进入记账')");
await sleep(3000);

// ---------- 3) 进入应用：服务端已初始化默认分类/账户 ----------
const homeText = await cdp.ev("document.body.innerText");
check("登录后进入应用主界面", (await cdp.ev("document.querySelector('.tabbar') !== null")) === true, homeText.slice(0, 60).replace(/\n/g, "|"));
check("首页展示空账本引导", homeText.includes("还没有记录"), homeText.slice(0, 80).replace(/\n/g, "|"));

const initial = await cdp.ev("window.__data()");
check(
  "服务端为新用户初始化了默认分类与账户",
  (initial.categories ?? []).length > 0 && (initial.accounts ?? []).length > 0,
  `categories=${(initial.categories ?? []).length} accounts=${(initial.accounts ?? []).length}`,
);
check("新账本没有任何流水", (initial.transactions ?? []).length === 0, `n=${(initial.transactions ?? []).length}`);

// ---------- 4) 记一笔 → 实时写服务端 ----------
await cdp.ev("document.querySelector('.fab').click()");
await sleep(700);
const keyResult = await cdp.ev("window.__pressKeys(['1','2'])");
check("金额键盘输入 1、2 后完成", keyResult === "ok", keyResult);
await sleep(1800);

const afterAdd = await cdp.ev("window.__data()");
const txs1 = (afterAdd.transactions ?? []).filter((t) => !t.deletedAt);
check("新增记录已实时写入服务端", txs1.length === 1, `n=${txs1.length}`);
check("金额落库为 1200 分（¥12.00）", txs1[0]?.amount === 1200, `amount=${txs1[0]?.amount}`);

// ---------- 5) 整页刷新：会话与数据都从服务端恢复 ----------
await cdp.send("Page.reload", { ignoreCache: false });
await sleep(3200);
await cdp.ev(HELPERS);
const reloadText = await cdp.ev("document.body.innerText");
check(
  "整页刷新后仍在登录态并渲染账本",
  (await cdp.ev("document.querySelector('.tabbar') !== null")) === true && reloadText.includes("首页"),
  reloadText.slice(0, 60).replace(/\n/g, "|"),
);
const afterReload = await cdp.ev("window.__data()");
check("刷新后服务端数据仍在", (afterReload.transactions ?? []).filter((t) => !t.deletedAt).length === 1, `n=${(afterReload.transactions ?? []).length}`);

// ---------- 6) 账号与安全 → 退出登录 ----------
await cdp.ev("window.__clickText('我的')");
await sleep(900);
await cdp.ev("window.__clickText('点击查看账号与设备')");
// 等 AccountScreen 真正挂载（会拉设备列表）
for (let i = 0; i < 12; i++) {
  const t = await cdp.ev("document.body.innerText");
  if (t.includes("退出登录")) break;
  await sleep(400);
}
const acctText = await cdp.ev("document.body.innerText");
check(
  "账号与安全页已打开并显示用户名",
  acctText.includes(USERNAME) && acctText.includes("退出登录"),
  acctText.slice(0, 80).replace(/\n/g, "|"),
);

await cdp.ev("window.__clickText('退出登录')");
await sleep(2200);
await cdp.ev("window.__clickText('首页')");
await sleep(600);
const afterLogout = await cdp.ev("document.body.innerText");
check(
  "退出登录后回到首页（未登录态仍可浏览）",
  afterLogout.includes("今日支出") && afterLogout.includes("免费注册"),
  afterLogout.slice(0, 80).replace(/\n/g, "|"),
);
const anonData2 = await cdp.ev("window.__data()");
check("退出后 /api/data 返回 401", anonData2?.status === 401, `status=${anonData2?.status}`);

// ---------- 7) 重新登录：服务端数据完整保留 ----------
await cdp.ev("window.__clickText('已有账号登录')");
await sleep(900);
await cdp.ev(`window.__type('input[autocomplete=username]', ${JSON.stringify(USERNAME)})`);
await cdp.ev(`window.__type('input[autocomplete=current-password]', ${JSON.stringify(PASSWORD)})`);
await sleep(300);
const clickedLogin = await cdp.ev(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '登录'); if (!b || b.disabled) return 'no'; b.click(); return 'ok'; })()`,
);
check("点击登录按钮", clickedLogin === "ok", String(clickedLogin));
await sleep(3200);

const afterLoginText = await cdp.ev("document.body.innerText");
check("重新登录后回到应用主界面", (await cdp.ev("document.querySelector('.tabbar') !== null")) === true, afterLoginText.slice(0, 60).replace(/\n/g, "|"));
const afterLogin = await cdp.ev("window.__data()");
check("重新登录后从服务端恢复记录", (afterLogin.transactions ?? []).filter((t) => !t.deletedAt).length === 1, `n=${(afterLogin.transactions ?? []).length}`);

console.log("\n浏览器账号：" + USERNAME);
console.log("服务端记录数：" + (afterLogin.transactions ?? []).filter((t) => !t.deletedAt).length);

// ---------- 8) 控制台干净 ----------
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
