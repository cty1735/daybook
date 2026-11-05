/* 全局状态：数据 + 动作
   服务端为准：启动时从 /api/data 拉取完整账本，写操作乐观更新内存后实时回写接口。
   不在浏览器存任何账本数据（无 IndexedDB / localStorage 副本），刷新即从接口重拉。 */

import { create } from "zustand";
import {
  SCHEMA_VERSION,
  buildDefaultAccounts,
  buildDefaultBudget,
  buildDefaultCategories,
  buildDefaultSettings,
  buildDemoTransactions,
  buildInitialData,
  uid,
  type Account,
  type AppData,
  type Budget,
  type Category,
  type Settings,
  type ThemeMode,
  type Transaction,
  type TxType,
} from "@daybook/shared";
import { api } from "../lib/api";

export interface NewTxInput {
  type: TxType;
  amount: number;
  categoryId: string | null;
  parentCategoryId: string | null;
  accountId: string;
  toAccountId?: string | null;
  occurredAt: number;
  note: string;
}

export type StoreStatus = "loading" | "anon" | "ready" | "error";

interface MetaState {
  status: StoreStatus;
  initError: string | null;
}

interface Actions {
  init: () => Promise<void>;
  logout: () => void;

  addTransaction: (input: NewTxInput) => Transaction;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  softDeleteTransaction: (id: string) => void;
  restoreTransaction: (id: string) => void;
  purgeTransaction: (id: string) => void;
  updateMany: (ids: string[], patch: Partial<Transaction>) => void;

  addCategory: (input: Omit<Category, "id" | "sortOrder">) => Category;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  deleteCategory: (id: string) => { moved: number };
  bumpCategoryUsage: (id: string) => void;

  addAccount: (input: Omit<Account, "id">) => Account;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  removeAccount: (id: string) => { ok: boolean; reason?: string };
  adjustBalance: (accountId: string, actualBalance: number) => Transaction | null;

  setBudget: (patch: Partial<Budget>) => void;
  setCategoryLimit: (categoryId: string, limit: number | null) => void;

  setTheme: (theme: ThemeMode) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;

  importTransactions: (txs: Transaction[]) => number;
  clearTransactions: () => void;
  loadDemoData: () => void;
  resetAll: () => void;
  replaceAll: (data: Partial<AppData>) => string | null;
}

export type Store = AppData & MetaState & Actions;

/* ---------------------------- 持久化辅助 ---------------------------- */

type ErrorHandler = (message: string) => void;
let errorHandler: ErrorHandler | null = null;

/** 由 App 外壳注册，把写失败弹成 toast（store 本身不依赖 React） */
export function setApiErrorHandler(fn: ErrorHandler | null): void {
  errorHandler = fn;
}

function reportError(e: unknown): void {
  console.error("[daybook] 保存失败:", e);
  errorHandler?.(e instanceof Error ? e.message : String(e));
}

function persistTransactions(txs: Transaction[]): void {
  if (!txs.length || useStore.getState().status !== "ready") return;
  void api.saveTransactions(txs).catch(reportError);
}

let stateTimer: ReturnType<typeof setTimeout> | null = null;

/** 分类/账户/预算/偏好改动：合并 300ms 内多次变更，整包提交 */
function persistState(get: () => Store): void {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    stateTimer = null;
    const s = get();
    if (s.status !== "ready") return;
    void api
      .saveState({
        categories: s.categories,
        accounts: s.accounts,
        budget: s.budget,
        settings: s.settings,
        categoryUsage: s.categoryUsage,
        lastUsedCategoryId: s.lastUsedCategoryId,
        lastUsedAccountId: s.lastUsedAccountId,
      })
      .catch(reportError);
  }, 300);
}

function flushStateTimer(): void {
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }
}

/** 主题镜像到 localStorage，只为「首屏内联脚本」在 hydration 之前定色，避免闪白 */
function mirrorTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem("daybook.theme", theme);
  } catch {
    /* 隐私模式下忽略 */
  }
}

const initial = buildInitialData();

export const useStore = create<Store>()((set, get) => ({
  ...initial,
  status: "loading",
  initError: null,

  /* ------------------------------ 启动 ------------------------------ */
  init: async () => {
    // 首次启动 / 失败重试才显示引导屏；登录后的静默刷新不要卸载界面，
    // 否则注册页的恢复码、当前页面栈都会丢。
    const cur = get().status;
    if (cur === "loading" || cur === "error") set({ status: "loading", initError: null });
    try {
      const user = await api.session();
      if (!user) {
        set({ status: "anon" });
        return;
      }
      const data = await api.getData();
      set({ ...data, status: "ready", initError: null });
      mirrorTheme(data.settings.theme);
    } catch (err) {
      set({ status: "error", initError: err instanceof Error ? err.message : String(err) });
    }
  },

  logout: () => {
    flushStateTimer();
    set({ ...buildInitialData(), status: "anon", initError: null });
  },

  /* ---------------------------- 流水 ---------------------------- */
  addTransaction: (input) => {
    const now = Date.now();
    const tx: Transaction = {
      id: uid("tx"),
      type: input.type,
      amount: input.amount,
      currency: "CNY",
      categoryId: input.categoryId,
      parentCategoryId: input.parentCategoryId,
      accountId: input.accountId,
      toAccountId: input.toAccountId ?? null,
      occurredAt: input.occurredAt,
      note: input.note,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      source: input.type === "adjustment" ? "adjustment" : "manual",
    };
    set((s) => ({
      transactions: [tx, ...s.transactions],
      lastUsedCategoryId: input.categoryId ?? s.lastUsedCategoryId,
      lastUsedAccountId: input.accountId,
      categoryUsage: input.categoryId
        ? { ...s.categoryUsage, [input.categoryId]: (s.categoryUsage[input.categoryId] ?? 0) + 1 }
        : s.categoryUsage,
    }));
    persistTransactions([tx]);
    persistState(get);
    return tx;
  },

  updateTransaction: (id, patch) => {
    const next = get().transactions.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) persistTransactions([tx]);
  },

  softDeleteTransaction: (id) => {
    const at = Date.now();
    const next = get().transactions.map((t) => (t.id === id ? { ...t, deletedAt: at, updatedAt: at } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) persistTransactions([tx]);
  },

  restoreTransaction: (id) => {
    const next = get().transactions.map((t) => (t.id === id ? { ...t, deletedAt: null, updatedAt: Date.now() } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) persistTransactions([tx]);
  },

  purgeTransaction: (id) =>
    set((s) => {
      const tx = s.transactions.find((t) => t.id === id);
      if (tx) persistTransactions([{ ...tx, deletedAt: Date.now(), updatedAt: Date.now() }]);
      return { transactions: s.transactions.filter((t) => t.id !== id) };
    }),

  updateMany: (ids, patch) => {
    const targets = new Set(ids);
    const at = Date.now();
    const next = get().transactions.map((t) => (targets.has(t.id) ? { ...t, ...patch, updatedAt: at } : t));
    set({ transactions: next });
    persistTransactions(next.filter((t) => targets.has(t.id)));
  },

  /* ---------------------------- 分类 ---------------------------- */
  addCategory: (input) => {
    const cat: Category = { ...input, id: uid("cat"), sortOrder: get().categories.length };
    set((s) => ({ categories: [...s.categories, cat] }));
    persistState(get);
    return cat;
  },

  updateCategory: (id, patch) => {
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    persistState(get);
  },

  deleteCategory: (id) => {
    const { categories, transactions } = get();
    const target = categories.find((c) => c.id === id);
    if (!target) return { moved: 0 };
    const childIds = new Set(categories.filter((c) => c.parentId === id).map((c) => c.id));
    const removedIds = [id, ...childIds];
    let moved = 0;
    const changed: Transaction[] = [];
    const nextTxs = transactions.map((t) => {
      if (childIds.has(t.categoryId ?? "") || t.categoryId === id) {
        moved++;
        const next = { ...t, categoryId: target.parentId, parentCategoryId: target.parentId, updatedAt: Date.now() };
        changed.push(next);
        return next;
      }
      return t;
    });
    const limits = { ...get().budget.categoryLimits };
    delete limits[id];
    set((s) => ({
      categories: s.categories.filter((c) => !removedIds.includes(c.id)),
      transactions: nextTxs,
      budget: { ...s.budget, categoryLimits: limits },
    }));
    if (changed.length) persistTransactions(changed);
    persistState(get);
    return { moved };
  },

  bumpCategoryUsage: (id) => {
    set((s) => ({ categoryUsage: { ...s.categoryUsage, [id]: (s.categoryUsage[id] ?? 0) + 1 } }));
    persistState(get);
  },

  /* ---------------------------- 账户 ---------------------------- */
  addAccount: (input) => {
    const acc: Account = { ...input, id: uid("acc") };
    set((s) => ({ accounts: [...s.accounts, acc] }));
    persistState(get);
    return acc;
  },

  updateAccount: (id, patch) => {
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    persistState(get);
  },

  removeAccount: (id) => {
    const used = get().transactions.some((t) => t.deletedAt === null && (t.accountId === id || t.toAccountId === id));
    if (used) return { ok: false, reason: "该账户下仍有记录，请先迁移或删除相关记录" };
    const remaining = get().accounts.filter((a) => a.id !== id);
    set((s) => ({
      accounts: remaining,
      lastUsedAccountId: s.lastUsedAccountId === id ? (remaining[0]?.id ?? null) : s.lastUsedAccountId,
    }));
    persistState(get);
    return { ok: true };
  },

  adjustBalance: (accountId, actualBalance) => {
    const acc = get().accounts.find((a) => a.id === accountId);
    if (!acc) return null;
    let bal = acc.initialBalance;
    for (const t of get().transactions) {
      if (t.deletedAt !== null) continue;
      if (t.type === "expense" && t.accountId === accountId) bal -= t.amount;
      else if (t.type === "income" && t.accountId === accountId) bal += t.amount;
      else if (t.type === "transfer") {
        if (t.accountId === accountId) bal -= t.amount;
        if (t.toAccountId === accountId) bal += t.amount;
      } else if (t.type === "adjustment" && t.accountId === accountId) bal += t.amount;
    }
    const delta = actualBalance - bal;
    if (delta === 0) return null;
    const at = Date.now();
    const tx: Transaction = {
      id: uid("tx"),
      type: "adjustment",
      amount: delta,
      currency: "CNY",
      categoryId: null,
      parentCategoryId: null,
      accountId,
      toAccountId: null,
      occurredAt: at,
      note: "余额调整",
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      source: "adjustment",
    };
    set((s) => ({ transactions: [tx, ...s.transactions] }));
    persistTransactions([tx]);
    return tx;
  },

  /* ---------------------------- 预算 ---------------------------- */
  setBudget: (patch) => {
    set((s) => ({ budget: { ...s.budget, ...patch } }));
    persistState(get);
  },

  setCategoryLimit: (categoryId, limit) => {
    set((s) => {
      const limits = { ...s.budget.categoryLimits };
      if (limit === null) delete limits[categoryId];
      else limits[categoryId] = limit;
      return { budget: { ...s.budget, categoryLimits: limits } };
    });
    persistState(get);
  },

  /* ---------------------------- 偏好 ---------------------------- */
  setTheme: (theme) => {
    set((s) => ({ settings: { ...s.settings, theme } }));
    mirrorTheme(theme);
    persistState(get);
  },

  setSetting: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    if (key === "theme") mirrorTheme(value as ThemeMode);
    persistState(get);
  },

  /* ---------------------------- 数据批量 ---------------------------- */
  importTransactions: (txs) => {
    set((s) => ({ transactions: [...txs, ...s.transactions] }));
    persistTransactions(txs);
    return txs.length;
  },

  clearTransactions: () => {
    set({ transactions: [] });
    void api.clearTransactions().catch((e) => {
      reportError(e);
      void get().init();
    });
  },

  loadDemoData: () => {
    const base = get();
    const txs = buildDemoTransactions({
      schemaVersion: base.schemaVersion,
      accounts: base.accounts,
      categories: base.categories,
      transactions: [],
      budget: base.budget,
      settings: base.settings,
      lastUsedCategoryId: base.lastUsedCategoryId,
      lastUsedAccountId: base.lastUsedAccountId,
      categoryUsage: base.categoryUsage,
    });
    set({ transactions: txs });
    persistTransactions(txs);
  },

  resetAll: () => {
    flushStateTimer();
    void api
      .resetData()
      .then((data) => {
        set({ ...data, status: "ready", initError: null });
        mirrorTheme(data.settings.theme);
      })
      .catch(reportError);
  },

  replaceAll: (data) => {
    if (data.schemaVersion !== undefined && data.schemaVersion > SCHEMA_VERSION) {
      return `备份来自更高版本（v${data.schemaVersion}），当前仅支持 v${SCHEMA_VERSION}`;
    }
    const next: AppData = {
      schemaVersion: SCHEMA_VERSION,
      accounts: data.accounts?.length ? data.accounts : buildDefaultAccounts(),
      categories: data.categories?.length ? data.categories : buildDefaultCategories(),
      transactions: data.transactions ?? [],
      budget: { ...buildDefaultBudget(), ...(data.budget ?? {}) },
      settings: { ...buildDefaultSettings(), ...(data.settings ?? {}) },
      lastUsedCategoryId: data.lastUsedCategoryId ?? null,
      lastUsedAccountId: data.lastUsedAccountId ?? null,
      categoryUsage: data.categoryUsage ?? {},
    };
    flushStateTimer();
    set({ ...next });
    void api
      .replaceData(next)
      .then((saved) => {
        set({ ...saved, status: "ready", initError: null });
        mirrorTheme(saved.settings.theme);
      })
      .catch((e) => {
        reportError(e);
        void get().init();
      });
    return null;
  },
}));
