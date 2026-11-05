// 管理后台浏览器 e2e：登录 → 概览 → 用户管理 → 流水审计 → 统计 → 操作日志 → 系统信息
// 用法：node tests/admin-browser-e2e.mjs   （需 api:3001 与 web:5173 已启动，后台走 /admin/ 代理）
// 截图输出到 %TEMP%\opencode\admin-shots\
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2] || "9444";
const ORIGIN = process.argv[3] || "http://127.0.0.1:5173/admin/";
const API = "http://127.0.0.1:3001";
const SHOTS = join(process.env.TEMP ?? "/tmp", "opencode", "admin-shots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? "chrome";
}

mkdirSync(SHOTS, { recursive: true });
const profileDir = join(process.env.TEMP ?? "/tmp", `daybook-admin-e2e-${Date.now()}`);
mkdirSync(profileDir, { recursive: true });

const chrome = spawn(
  findChrome(),
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

function cleanup() {
  try {
    spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch {
      /* retry */
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

/* ----------------------------- CDP ----------------------------- */
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === "page");
      if (t) return t;
    } catch {
      /* not ready */
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
        this.exceptions.push(
          msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "unknown",
        );
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
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description ?? ""));
    }
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

/* --------------------- 准备一个固定管理员 --------------------- */
const stamp = Date.now().toString(36).slice(-5);
const ADMIN_USER = `adm${stamp}`;
const ADMIN_PASS = "Admin!23456789";
const TARGET_USER = `usr${stamp}`;

async function apiCall(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", ...(init.headers ?? {}) },
    body: init.json ? JSON.stringify(init.json) : init.body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

{
  const r = await apiCall("/api/auth/register", {
    method: "POST",
    json: { username: ADMIN_USER, password: ADMIN_PASS, acceptedTerms: true },
  });
  if (r.status !== 200) throw new Error(`注册管理员失败：${r.status} ${JSON.stringify(r.body)}`);

  const u = await apiCall("/api/auth/register", {
    method: "POST",
    json: { username: TARGET_USER, password: ADMIN_PASS, acceptedTerms: true },
  });
  if (u.status !== 200) throw new Error(`注册测试用户失败：${u.status}`);

  const sql = `update user set role='admin' where username='${ADMIN_USER}';`;
  spawnSync(
    "node",
    [
      "-e",
      "const{createClient}=require('@libsql/client');const c=createClient({url:'file:./apps/api/data/daybook.sqlite'});c.execute(process.argv[1]).then(()=>c.close())",
      sql,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
}

/* ----------------------------- 开始 ----------------------------- */
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
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function goto(url) {
  await cdp.send("Page.navigate", { url });
  await sleep(900);
}

async function waitFor(expr, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await cdp.ev(expr)) return true;
    await sleep(180);
  }
  return false;
}

/** 设置 React 受控 input 的值（走原生 setter 才能触发 onChange） */
const SET_INPUT = `
window.__setInput = (sel, value) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__clickText = (text, tag = 'button') => {
  const els = [...document.querySelectorAll(tag)];
  const el = els.find((e) => e.textContent.trim() === text || e.textContent.includes(text));
  if (!el) return false;
  el.click();
  return true;
};
window.__text = () => document.body.innerText;
true;
`;

/* ---- 1. 登录页 ---- */
await goto(ORIGIN);
await cdp.ev(SET_INPUT);
await waitFor("!!document.querySelector('.login-card')");
check("未登录显示登录页", await cdp.ev("!!document.querySelector('.login-card')"));
await cdp.shot("01-login");

await cdp.ev(`window.__setInput('input[placeholder="用户名"]', ${JSON.stringify(ADMIN_USER)})`);
await cdp.ev(`window.__setInput('input[type="password"]', ${JSON.stringify(ADMIN_PASS)})`);
await sleep(120);
await cdp.ev(`window.__clickText('登录')`);
await waitFor("!!document.querySelector('.sidebar')", 8000);

/* ---- 2. 概览 ---- */
check("登录后进入后台外壳", await cdp.ev("!!document.querySelector('.sidebar')"));
await waitFor("document.body.innerText.includes('概览')");
await cdp.shot("02-overview");

const statCount = await cdp.ev("document.querySelectorAll('.stat').length");
check("概览渲染指标卡", statCount >= 6, `stat=${statCount}`);
const hasTrend = await cdp.ev("document.querySelectorAll('.card svg, .card div[title]').length > 0");
check("概览渲染趋势图", hasTrend);
check("概览显示管理员名", await cdp.ev(`document.body.innerText.includes(${JSON.stringify(ADMIN_USER)})`));

/* ---- 3. 用户管理 ---- */
await cdp.ev(`window.__clickText('用户管理', '.nav-item')`);
await waitFor("document.body.innerText.includes('搜索、查看会话')");
await cdp.shot("03-users");

const rowCount = await cdp.ev("document.querySelectorAll('tbody tr').length");
check("用户列表有数据", rowCount > 0, `rows=${rowCount}`);

// 搜索目标用户
await cdp.ev(`window.__setInput('input[placeholder="搜索用户名 / 显示名 / 邮箱"]', ${JSON.stringify(TARGET_USER)})`);
await sleep(500);
const searched = await cdp.ev("document.querySelectorAll('tbody tr').length");
check("搜索过滤生效", searched >= 1 && searched <= 3, `rows=${searched}`);

// 打开详情抽屉
await cdp.ev(`window.__clickText('详情')`);
await waitFor("!!document.querySelector('.drawer')");
await cdp.shot("04-user-detail");
check("用户详情抽屉打开", await cdp.ev("!!document.querySelector('.drawer')"));
check(
  "详情显示设备/流水区块",
  await cdp.ev("document.body.innerText.includes('已登录设备') && document.body.innerText.includes('数据概况')"),
);

/* ---- 4. 封禁（含原因输入） ---- */
await cdp.ev(`window.__clickText('封禁')`);
await waitFor("!!document.querySelector('.confirm-card')");
await cdp.shot("05-ban-confirm");
check("封禁弹出确认框", await cdp.ev("!!document.querySelector('.confirm-card')"));

await cdp.ev(`window.__setInput('.confirm-card textarea', '浏览器 e2e 测试封禁')`);
await sleep(150);
await cdp.ev(`window.__clickText('确认封禁')`);
await waitFor("document.body.innerText.includes('已封禁')", 5000);
await sleep(600);
check("封禁成功并刷新", await cdp.ev("document.body.innerText.includes('已封禁')"));
await cdp.shot("06-user-banned");

/* ---- 5. 流水审计 ---- */
await cdp.ev(`window.__clickText('流水审计', '.nav-item')`);
await waitFor("document.body.innerText.includes('按用户、时间、类型')");
await cdp.shot("07-transactions");
const txRows = await cdp.ev("document.querySelectorAll('tbody tr').length");
check("流水列表有数据", txRows > 0, `rows=${txRows}`);

// 打开流水详情，检查 payload 展示
await cdp.ev(`window.__clickText('详情')`);
await waitFor("!!document.querySelector('pre.json')");
await cdp.shot("08-tx-detail");
check("流水详情展示原始 payload", await cdp.ev("!!document.querySelector('pre.json')"));
await cdp.ev(`window.__clickText('关闭')`);
await sleep(400);

/* ---- 6. 统计分析 ---- */
await cdp.ev(`window.__clickText('统计分析', '.nav-item')`);
await waitFor("document.body.innerText.includes('全站口径')");
await sleep(600);
await cdp.shot("09-stats");
check("统计页渲染收支卡", (await cdp.ev("document.querySelectorAll('.stat').length")) >= 4);
check("统计页有分类占比", await cdp.ev("document.body.innerText.includes('支出分类 Top')"));

/* ---- 7. 操作日志 ---- */
await cdp.ev(`window.__clickText('操作日志', '.nav-item')`);
await waitFor("document.body.innerText.includes('只增不改')");
await sleep(500);
await cdp.shot("10-audit");
check("操作日志记录了封禁", await cdp.ev("document.body.innerText.includes('封禁用户')"));

/* ---- 8. 系统信息 ---- */
await cdp.ev(`window.__clickText('系统信息', '.nav-item')`);
await waitFor("document.body.innerText.includes('运行时长')");
await sleep(400);
await cdp.shot("11-system");
check("系统页显示表行数", await cdp.ev("document.body.innerText.includes('ledgerTransactions')"));

/* ---- 9. 退出登录 ---- */
await cdp.ev(`window.__clickText('退出登录')`);
await waitFor("!!document.querySelector('.login-card')", 6000);
check("退出后回到登录页", await cdp.ev("!!document.querySelector('.login-card')"));
await cdp.shot("12-logged-out");

/* ---- 10. 同域隔离：前后台互不串台 ---- */
await goto("http://127.0.0.1:5173/");
await sleep(800);
const front = await cdp.ev("document.title");
check("回到 / 仍是前台 App", front.includes("个人财务管家"), front);
check("前台没有后台侧栏", !(await cdp.ev("!!document.querySelector('.sidebar')")));

await goto(ORIGIN);
await sleep(800);
check("再进 /admin/ 仍是后台", (await cdp.ev("document.title")).includes("管理后台"));
check("后台未登录显示登录页", await cdp.ev("!!document.querySelector('.login-card')"));

/* ---- 10. 控制台无报错 ---- */
const errs = cdp.consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/.test(e));
const exs = cdp.exceptions.filter((e) => !/favicon/.test(e));
check("无 JS 异常", exs.length === 0, exs.slice(0, 2).join(" | "));
check("无控制台错误", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log(`\n截图目录：${SHOTS}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length} 条，失败 ${failed.length} 条`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.name);
  process.exit(1);
}
