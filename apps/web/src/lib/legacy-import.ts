/* 一次性搬家：把旧版（本地优先）存在 IndexedDB 里的账本搬到服务端
 *
 * 背景：2026-11 之前的前端用 Dexie/IndexedDB 存账本，靠 outbox 手动同步；
 * 现在改成「服务端为准」后不再读本地库。如果老用户浏览器里还留着没推上去的
 * 记录，直接切换会看起来像「数据丢了」。这里在首次登录后静默做一次合并：
 *   - 只执行一次（localStorage 标记）
 *   - 按 id 合并，updatedAt 大的赢（与服务端 LWW 口径一致）
 *   - 分类 / 账户 / 预算 / 偏好同样按 id 合并，缺的补上
 *   - 本地库不存在 / 读失败直接跳过，绝不影响正常启动
 */

import type { Account, AppData, Budget, Category, Settings, Transaction } from "@daybook/shared";

const DB_NAME = "daybook";
const FLAG = "daybook.legacy-import.v1";

interface LegacyData {
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  budget: Budget | null;
  settings: Settings | null;
}

function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let created = false;
    let settled = false;
    const done = (v: IDBDatabase | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME);
    } catch {
      done(null);
      return;
    }

    // 库不存在时 open 会新建一个空库：标记后删掉，保证不留垃圾
    req.onupgradeneeded = () => {
      created = true;
    };
    req.onsuccess = () => {
      const db = req.result;
      if (created) {
        db.close();
        indexedDB.deleteDatabase(DB_NAME);
        done(null);
        return;
      }
      done(db);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
    setTimeout(() => done(null), 3000);
  });
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) {
      resolve([]);
      return;
    }
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function legacyExists(): Promise<boolean> {
  // Chrome/Edge 支持枚举库名；不支持时退回「尝试打开」
  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === DB_NAME);
    } catch {
      return true;
    }
  }
  return true;
}

async function readLegacy(): Promise<LegacyData | null> {
  if (typeof indexedDB === "undefined" || typeof localStorage === "undefined") return null;
  if (localStorage.getItem(FLAG) === "1") return null;

  if (!(await legacyExists())) {
    localStorage.setItem(FLAG, "1");
    return null;
  }

  const db = await openLegacyDb();
  // 打不开（被其他标签页占用等）就先不落标记，下次登录再试
  if (!db) return null;

  try {
    const [categories, accounts, transactions, meta] = await Promise.all([
      getAll<Category>(db, "categories"),
      getAll<Account>(db, "accounts"),
      getAll<Transaction>(db, "transactions"),
      getAll<{ key: string; value: unknown }>(db, "meta"),
    ]);

    const metaMap = new Map(meta.map((m) => [m.key, m.value]));
    const budget = (metaMap.get("budget") as Budget | undefined) ?? null;
    const settings = (metaMap.get("settings") as Settings | undefined) ?? null;

    if (!transactions.length && !categories.length && !accounts.length) return null;
    return { categories, accounts, transactions, budget, settings };
  } finally {
    db.close();
  }
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** 合并到服务端数据；返回需要回写的数据，没什么可合并时返回 null */
export async function mergeLegacyInto(data: AppData): Promise<AppData | null> {
  let legacy: LegacyData | null = null;
  try {
    legacy = await readLegacy();
  } catch {
    legacy = null;
  }
  if (!legacy) return null;

  // ---- 分类 / 账户：按 id 合并，服务端优先（本地缺的才补） ----
  const catMap = byId(data.categories);
  for (const c of legacy.categories) if (c?.id && !catMap.has(c.id)) catMap.set(c.id, c);

  const accMap = byId(data.accounts);
  for (const a of legacy.accounts) if (a?.id && !accMap.has(a.id)) accMap.set(a.id, a);

  // ---- 流水：同 id 比 updatedAt（LWW），同分保留服务端 ----
  const txMap = byId(data.transactions);
  let txChanged = false;
  for (const t of legacy.transactions) {
    if (!t?.id) continue;
    const cur = txMap.get(t.id);
    if (!cur || (t.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
      txMap.set(t.id, t);
      txChanged = true;
    }
  }

  const stateChanged = catMap.size !== data.categories.length || accMap.size !== data.accounts.length;

  const merged: AppData = {
    ...data,
    categories: [...catMap.values()],
    accounts: [...accMap.values()],
    transactions: [...txMap.values()],
    // 预算 / 偏好：服务端已有设置就沿用，否则用本地搬过来的
    budget: data.budget.totalAmount > 0 || !legacy.budget ? data.budget : legacy.budget,
    settings: legacy.settings ? { ...legacy.settings, ...data.settings } : data.settings,
  };

  if (!txChanged && !stateChanged) {
    localStorage.setItem(FLAG, "1");
    return null;
  }
  return merged;
}

/** 搬家成功后才落标记；失败下次启动会重试 */
export function markLegacyImported() {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    /* 隐私模式下 localStorage 不可写，忽略 */
  }
}

export function clearLegacyImportFlag() {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}
