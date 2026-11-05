/* 全局状态：数据 + 动作
   P0 改动：持久化从 localStorage（zustand/persist）换成 IndexedDB（Dexie）
   - 支持 5 万条量级与索引化查询（PRD §11）
   - 写入非阻塞主线程，不再每次全量 JSON.stringify 同步落盘
   - 同时维护 outbox 待推送队列与同步游标，为云同步（P1）预埋
*/

import { create } from "zustand";
import {
  SCHEMA_VERSION,
  buildDefaultAccounts,
  buildDefaultBudget,
  buildDefaultCategories,
  buildDefaultSettings,
  buildDemoTransactions,
  buildInitialData,
  isLegacyDemoLedger,
  mergeTransactions,
  resolveLWW,
  uid,
  type Account,
  type AppData,
  type Budget,
  type Category,
  type Settings,
  type ThemeMode,
  type Transaction,
  type TxType,
  type UserState,
} from "@daybook/shared";
import {
  DEFAULT_SYNC_META,
  META,
  db,
  loadAll,
  readMeta,
  repo,
  writeMeta,
  type LastUsed,
  type SyncMeta,
} from "../lib/db";

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

interface MetaState {
  /** IndexedDB 是否已加载完成（首屏据此显示骨架） */
  hydrated: boolean;
  initError: string | null;
  outboxCount: number;
  sync: SyncMeta;
  deviceId: string;
  /** 是否从旧的 localStorage 迁移而来（用于提示） */
  migratedFromLegacy: boolean;
}

interface Actions {
  init: () => Promise<void>;

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

  /* -------- 同步相关（P1 使用，P0 先打通数据通道） -------- */
  refreshOutboxCount: () => Promise<void>;
  setSyncMeta: (patch: Partial<SyncMeta>) => void;
  applyRemoteTransactions: (remote: Transaction[]) => number;
  applyRemoteUserState: (state: UserState, updatedAt: number) => boolean;
  snapshotUserState: () => UserState;
  clearOutbox: () => Promise<void>;
}

export type Store = AppData & MetaState & Actions;

const initial = buildInitialData();

/** 用户级状态变更后统一打标（用于整包 LWW 与 outbox） */
function touchState(get: () => Store): void {
  const at = Date.now();
  get().setSyncMeta({ stateUpdatedAt: at });
  void db.outbox.add({ entity: "state", entityId: "self", op: "upsert", at });
}

/** 主题额外镜像到 localStorage，只为「首屏内联脚本」能在 hydration 之前定色，避免闪白 */
function mirrorTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem("daybook.theme", theme);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export const useStore = create<Store>()((set, get) => ({
  ...initial,
  hydrated: false,
  initError: null,
  outboxCount: 0,
  sync: { ...DEFAULT_SYNC_META },
  deviceId: "",
  migratedFromLegacy: false,

  /* ------------------------------ 启动 ------------------------------ */
  init: async () => {
    try {
      let data = await loadAll();
      let migrated = false;

      // 一次性迁移：把旧的 localStorage（zustand/persist 格式）搬进 IndexedDB
      if (!data) {
        const legacy = readLegacyLocalStorage();
        if (legacy) {
          await repo.saveAll(legacy);
          data = legacy;
          migrated = true;
          await writeMeta(META.migrated, true);
        }
      }

      if (!data) {
        // 全新安装：默认分类/账户/预算；不预置任何示例流水，账本从零开始
        const fresh = buildInitialData();
        await repo.saveAll(fresh);
        data = fresh;
      }

      const [sync, deviceId, legacySeeded] = await Promise.all([
        repo.getSyncMeta(),
        repo.deviceId(),
        readMeta<boolean>(META.seeded, false),
      ]);
      let transactions = data.transactions;

      // 一次性清理：旧版本自动预置、且整本流水都是示例账单 → 置空
      // （只在「全部为示例数据」时触发，绝不会删掉用户自己记的账）
      if (legacySeeded && isLegacyDemoLedger(transactions)) {
        transactions = [];
        await repo.clearTransactions();
      }

      set({
        ...data,
        transactions,
        hydrated: true,
        initError: null,
        sync,
        deviceId,
        migratedFromLegacy: migrated,
        outboxCount: 0,
      });
      mirrorTheme(data.settings.theme);
      await get().refreshOutboxCount();
    } catch (err) {
      set({ hydrated: true, initError: err instanceof Error ? err.message : String(err) });
    }
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
    void repo.putTransactions([tx]);
    void repo.setMeta(META.lastUsed, { categoryId: get().lastUsedCategoryId, accountId: get().lastUsedAccountId } satisfies LastUsed);
    if (input.categoryId) void repo.setMeta(META.categoryUsage, get().categoryUsage);
    void get().refreshOutboxCount();
    return tx;
  },

  updateTransaction: (id, patch) => {
    const next = get().transactions.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) {
      void repo.putTransactions([tx]);
      void get().refreshOutboxCount();
    }
  },

  softDeleteTransaction: (id) => {
    const at = Date.now();
    const next = get().transactions.map((t) => (t.id === id ? { ...t, deletedAt: at, updatedAt: at } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) {
      void repo.putTransactions([tx]);
      void get().refreshOutboxCount();
    }
  },

  restoreTransaction: (id) => {
    const next = get().transactions.map((t) => (t.id === id ? { ...t, deletedAt: null, updatedAt: Date.now() } : t));
    set({ transactions: next });
    const tx = next.find((t) => t.id === id);
    if (tx) void repo.putTransactions([tx]);
  },

  purgeTransaction: (id) =>
    set((s) => {
      const tx = s.transactions.find((t) => t.id === id);
      if (tx) void repo.putTransactions([{ ...tx, deletedAt: Date.now(), updatedAt: Date.now() }]);
      return { transactions: s.transactions.filter((t) => t.id !== id) };
    }),

  updateMany: (ids, patch) => {
    const targets = new Set(ids);
    const at = Date.now();
    const next = get().transactions.map((t) => (targets.has(t.id) ? { ...t, ...patch, updatedAt: at } : t));
    set({ transactions: next });
    void repo.putTransactions(next.filter((t) => targets.has(t.id)));
    void get().refreshOutboxCount();
  },

  /* ---------------------------- 分类 ---------------------------- */
  addCategory: (input) => {
    const cat: Category = { ...input, id: uid("cat"), sortOrder: get().categories.length };
    set((s) => ({ categories: [...s.categories, cat] }));
    void repo.putCategories([cat]);
    touchState(get);
    void get().refreshOutboxCount();
    return cat;
  },

  updateCategory: (id, patch) => {
    const next = get().categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
    set({ categories: next });
    const cat = next.find((c) => c.id === id);
    if (cat) void repo.putCategories([cat]);
    touchState(get);
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
    void repo.deleteCategoryRows(removedIds);
    if (changed.length) void repo.putTransactions(changed);
    void repo.setMeta(META.budget, get().budget);
    touchState(get);
    return { moved };
  },

  bumpCategoryUsage: (id) => {
    const next = { ...get().categoryUsage, [id]: (get().categoryUsage[id] ?? 0) + 1 };
    set({ categoryUsage: next });
    void repo.setMeta(META.categoryUsage, next);
  },

  /* ---------------------------- 账户 ---------------------------- */
  addAccount: (input) => {
    const acc: Account = { ...input, id: uid("acc") };
    set((s) => ({ accounts: [...s.accounts, acc] }));
    void repo.putAccounts([acc]);
    touchState(get);
    return acc;
  },

  updateAccount: (id, patch) => {
    const next = get().accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
    set({ accounts: next });
    const acc = next.find((a) => a.id === id);
    if (acc) void repo.putAccounts([acc]);
    touchState(get);
  },

  removeAccount: (id) => {
    const used = get().transactions.some((t) => t.deletedAt === null && (t.accountId === id || t.toAccountId === id));
    if (used) return { ok: false, reason: "该账户下仍有记录，请先迁移或删除相关记录" };
    const remaining = get().accounts.filter((a) => a.id !== id);
    set((s) => ({
      accounts: remaining,
      lastUsedAccountId: s.lastUsedAccountId === id ? (remaining[0]?.id ?? null) : s.lastUsedAccountId,
    }));
    void repo.deleteAccountRows([id]);
    touchState(get);
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
    void repo.putTransactions([tx]);
    return tx;
  },

  /* ---------------------------- 预算 ---------------------------- */
  setBudget: (patch) => {
    set((s) => ({ budget: { ...s.budget, ...patch } }));
    void repo.setMeta(META.budget, get().budget);
    touchState(get);
  },

  setCategoryLimit: (categoryId, limit) => {
    const limits = { ...get().budget.categoryLimits };
    if (limit === null) delete limits[categoryId];
    else limits[categoryId] = limit;
    set((s) => ({ budget: { ...s.budget, categoryLimits: limits } }));
    void repo.setMeta(META.budget, get().budget);
    touchState(get);
  },

  /* ---------------------------- 偏好 ---------------------------- */
  setTheme: (theme) => {
    set((s) => ({ settings: { ...s.settings, theme } }));
    mirrorTheme(theme);
    void repo.setMeta(META.settings, get().settings);
    touchState(get);
  },

  setSetting: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    if (key === "theme") mirrorTheme(value as ThemeMode);
    void repo.setMeta(META.settings, get().settings);
    touchState(get);
  },

  /* ---------------------------- 数据批量 ---------------------------- */
  importTransactions: (txs) => {
    set((s) => ({ transactions: [...txs, ...s.transactions] }));
    void repo.putTransactions(txs);
    void get().refreshOutboxCount();
    return txs.length;
  },

  clearTransactions: () => {
    set({ transactions: [] });
    void repo.clearTransactions();
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
    void repo.putTransactions(txs, false);
  },

  resetAll: () => {
    const fresh = buildInitialData();
    set({ ...fresh, outboxCount: 0 });
    void repo.saveAll(fresh);
    void repo.clearOutbox();
  },

  replaceAll: (data) => {
    if (data.schemaVersion !== undefined && data.schemaVersion > SCHEMA_VERSION) {
      return `备份来自更高版本（v${data.schemaVersion}），当前仅支持 v${SCHEMA_VERSION}`;
    }
    const next = {
      accounts: data.accounts?.length ? data.accounts : buildDefaultAccounts(),
      categories: data.categories?.length ? data.categories : buildDefaultCategories(),
      transactions: data.transactions ?? [],
      budget: { ...buildDefaultBudget(), ...(data.budget ?? {}) },
      settings: { ...buildDefaultSettings(), ...(data.settings ?? {}) },
      schemaVersion: SCHEMA_VERSION,
      lastUsedCategoryId: data.lastUsedCategoryId ?? null,
      lastUsedAccountId: data.lastUsedAccountId ?? null,
      categoryUsage: data.categoryUsage ?? {},
    };
    set(next);
    void repo.saveAll({ ...next });
    void repo.clearOutbox();
    return null;
  },

  /* ---------------------------- 同步 ---------------------------- */
  refreshOutboxCount: async () => {
    const n = await repo.outboxSize();
    set({ outboxCount: n });
  },

  setSyncMeta: (patch) => {
    const next = { ...get().sync, ...patch };
    set({ sync: next });
    void repo.setMeta(META.sync, next);
  },

  applyRemoteTransactions: (remote) => {
    if (!remote.length) return 0;
    const merged = mergeTransactions(get().transactions, remote);
    let changed = 0;
    const byId = new Map(get().transactions.map((t) => [t.id, t]));
    for (const r of remote) {
      const l = byId.get(r.id);
      if (!l || resolveLWW(l, r) === "remote") changed++;
    }
    set({ transactions: merged });
    if (changed) void repo.putTransactions(remote, false);
    return changed;
  },

  applyRemoteUserState: (state, updatedAt) => {
    if (updatedAt <= get().sync.stateUpdatedAt) return false;
    set((s) => ({
      categories: state.categories,
      accounts: state.accounts,
      budget: state.budget,
      settings: state.settings,
      categoryUsage: state.categoryUsage,
      lastUsedCategoryId: state.lastUsedCategoryId,
      lastUsedAccountId: state.lastUsedAccountId,
      sync: { ...s.sync, stateUpdatedAt: updatedAt },
    }));
    void repo.saveAll({
      schemaVersion: SCHEMA_VERSION,
      categories: state.categories,
      accounts: state.accounts,
      transactions: get().transactions,
      budget: state.budget,
      settings: state.settings,
      lastUsedCategoryId: state.lastUsedCategoryId,
      lastUsedAccountId: state.lastUsedAccountId,
      categoryUsage: state.categoryUsage,
    });
    return true;
  },

  snapshotUserState: () => {
    const s = get();
    return {
      categories: s.categories,
      accounts: s.accounts,
      budget: s.budget,
      settings: s.settings,
      categoryUsage: s.categoryUsage,
      lastUsedCategoryId: s.lastUsedCategoryId,
      lastUsedAccountId: s.lastUsedAccountId,
    } satisfies UserState;
  },

  clearOutbox: async () => {
    await repo.clearOutbox();
    set({ outboxCount: 0 });
  },
}));

/* ------------------------------------------------------------------
   P0：把旧的 localStorage 数据一次性迁移过来（zustand/persist 格式）
   ------------------------------------------------------------------ */
function readLegacyLocalStorage(): AppData | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("daybook.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Partial<AppData> } | Partial<AppData>;
    const s = (parsed as { state?: Partial<AppData> }).state ?? (parsed as Partial<AppData>);
    if (!s || !Array.isArray(s.categories) || !s.categories.length) return null;
    return {
      schemaVersion: s.schemaVersion ?? SCHEMA_VERSION,
      categories: s.categories,
      accounts: s.accounts?.length ? s.accounts : buildDefaultAccounts(),
      transactions: s.transactions ?? [],
      budget: { ...buildDefaultBudget(), ...(s.budget ?? {}) },
      settings: { ...buildDefaultSettings(), ...(s.settings ?? {}) },
      lastUsedCategoryId: s.lastUsedCategoryId ?? null,
      lastUsedAccountId: s.lastUsedAccountId ?? null,
      categoryUsage: s.categoryUsage ?? {},
    };
  } catch {
    return null;
  }
}