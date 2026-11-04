/* 本地持久化：IndexedDB（Dexie）
   替代 localStorage —— 支持 5 万条量级（PRD §11）、事务、索引，且写入非阻塞主线程。

   表结构：
   - meta         单行 KV：schemaVersion / budget / settings / lastUsed / categoryUsage / sync / deviceId
   - categories   事务中的分类（索引 parentId / kind / sortOrder）
   - accounts     账户（索引 type / isArchived）
   - transactions 流水（索引 occurredAt / type / parentCategoryId / accountId / updatedAt / deletedAt）
   - outbox       待推送变更队列（为云同步准备，P0 预埋）
   - snapshots    本地每日备份
*/

import Dexie, { type Table } from "dexie";
import type { Account, AppData, Budget, Category, Settings, Transaction } from "@daybook/shared";

export interface MetaRow {
  key: string;
  value: unknown;
}

export type OutboxEntity = "transaction" | "category" | "account" | "state";

export interface OutboxRow {
  seq?: number;
  entity: OutboxEntity;
  entityId: string;
  op: "upsert" | "delete";
  at: number;
}

export interface SnapshotRow {
  /** YYYY-MM-DD */
  date: string;
  savedAt: number;
  records: number;
  payload: string;
}

export interface SyncMeta {
  /** 服务端单调游标 */
  cursor: number;
  lastSyncedAt: number | null;
  /** 服务端返回的最近一次同步时间 */
  serverTime: number | null;
  /** 本端 user state 的版本号（LWW） */
  stateUpdatedAt: number;
  autoSync: boolean;
}

export class DayBookDB extends Dexie {
  meta!: Table<MetaRow, string>;
  categories!: Table<Category, string>;
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  outbox!: Table<OutboxRow, number>;
  snapshots!: Table<SnapshotRow, string>;

  constructor() {
    super("daybook");
    this.version(1).stores({
      meta: "key",
      categories: "id, parentId, kind, sortOrder",
      accounts: "id, type, isArchived",
      transactions: "id, occurredAt, type, parentCategoryId, accountId, updatedAt, deletedAt",
      outbox: "++seq, entity, entityId",
      snapshots: "date",
    });
  }
}

export const db = new DayBookDB();

export const META = {
  schemaVersion: "schemaVersion",
  budget: "budget",
  settings: "settings",
  lastUsed: "lastUsed",
  categoryUsage: "categoryUsage",
  sync: "sync",
  deviceId: "deviceId",
  seeded: "seeded",
  migrated: "migratedFromLocalStorage",
} as const;

export interface LastUsed {
  categoryId: string | null;
  accountId: string | null;
}

export const DEFAULT_LAST_USED: LastUsed = { categoryId: null, accountId: null };

export const DEFAULT_SYNC_META: SyncMeta = {
  cursor: 0,
  lastSyncedAt: null,
  serverTime: null,
  stateUpdatedAt: 0,
  autoSync: true,
};

/* ----------------------------- 读 ----------------------------- */

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function loadAll(): Promise<AppData | null> {
  const [categories, accounts, transactions, budget, settings, lastUsed, categoryUsage, schemaVersion] = await Promise.all([
    db.categories.toArray(),
    db.accounts.toArray(),
    db.transactions.toArray(),
    readMeta<Budget | null>(META.budget, null),
    readMeta<Settings | null>(META.settings, null),
    readMeta<LastUsed | null>(META.lastUsed, null),
    readMeta<Record<string, number>>(META.categoryUsage, {}),
    readMeta<number>(META.schemaVersion, 1),
  ]);
  if (!categories.length || !budget || !settings) return null;
  return {
    schemaVersion,
    categories,
    accounts,
    transactions,
    budget,
    settings,
    lastUsedCategoryId: lastUsed?.categoryId ?? null,
    lastUsedAccountId: lastUsed?.accountId ?? null,
    categoryUsage,
  };
}

/* ----------------------------- 写 ----------------------------- */

/** 串行写队列：保证 IndexedDB 写入有序，避免并发写导致 outbox 乱序 */
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

const now = () => Date.now();

export const repo = {
  /** 全量写入（迁移 / 恢复备份 / 出厂重置时使用） */
  saveAll(data: AppData): Promise<void> {
    return enqueue(() =>
      db.transaction("rw", [db.meta, db.categories, db.accounts, db.transactions], async () => {
        await Promise.all([db.categories.clear(), db.accounts.clear(), db.transactions.clear()]);
        await db.categories.bulkPut(data.categories);
        await db.accounts.bulkPut(data.accounts);
        await db.transactions.bulkPut(data.transactions);
        await db.meta.bulkPut([
          { key: META.schemaVersion, value: data.schemaVersion },
          { key: META.budget, value: data.budget },
          { key: META.settings, value: data.settings },
          { key: META.lastUsed, value: { categoryId: data.lastUsedCategoryId, accountId: data.lastUsedAccountId } },
          { key: META.categoryUsage, value: data.categoryUsage },
        ]);
      }),
    );
  },

  putTransactions(txs: Transaction[], trackOutbox = true): Promise<void> {
    if (!txs.length) return Promise.resolve();
    return enqueue(() =>
      db.transaction("rw", [db.transactions, db.outbox], async () => {
        await db.transactions.bulkPut(txs);
        if (trackOutbox) {
          const t = now();
          await db.outbox.bulkAdd(
            txs.map((tx) => ({ entity: "transaction" as const, entityId: tx.id, op: "upsert" as const, at: t })),
          );
        }
      }),
    );
  },

  putCategories(cats: Category[], trackOutbox = true): Promise<void> {
    if (!cats.length) return Promise.resolve();
    return enqueue(() =>
      db.transaction("rw", [db.categories, db.outbox], async () => {
        await db.categories.bulkPut(cats);
        if (trackOutbox) {
          const t = now();
          await db.outbox.bulkAdd(cats.map((c) => ({ entity: "category" as const, entityId: c.id, op: "upsert" as const, at: t })));
        }
      }),
    );
  },

  putAccounts(accs: Account[], trackOutbox = true): Promise<void> {
    if (!accs.length) return Promise.resolve();
    return enqueue(() =>
      db.transaction("rw", [db.accounts, db.outbox], async () => {
        await db.accounts.bulkPut(accs);
        if (trackOutbox) {
          const t = now();
          await db.outbox.bulkAdd(accs.map((a) => ({ entity: "account" as const, entityId: a.id, op: "upsert" as const, at: t })));
        }
      }),
    );
  },

  deleteCategoryRows(ids: string[]): Promise<void> {
    if (!ids.length) return Promise.resolve();
    return enqueue(() =>
      db.transaction("rw", [db.categories], async () => {
        await db.categories.bulkDelete(ids);
      }),
    );
  },

  deleteAccountRows(ids: string[]): Promise<void> {
    if (!ids.length) return Promise.resolve();
    return enqueue(() =>
      db.transaction("rw", [db.accounts], async () => {
        await db.accounts.bulkDelete(ids);
      }),
    );
  },

  clearTransactions(): Promise<void> {
    return enqueue(async () => {
      await db.transactions.clear();
    });
  },

  setMeta(key: string, value: unknown): Promise<void> {
    return enqueue(async () => {
      await db.meta.put({ key, value });
    });
  },

  setMetaMany(rows: MetaRow[]): Promise<void> {
    return enqueue(async () => {
      await db.meta.bulkPut(rows);
    });
  },

  /* ---------------- outbox / 同步游标（P0 预埋） ---------------- */

  async outboxSize(): Promise<number> {
    return db.outbox.count();
  },

  async drainOutbox(limit = 2000): Promise<OutboxRow[]> {
    return db.outbox.orderBy("seq").limit(limit).toArray();
  },

  async ackOutbox(maxSeq: number): Promise<number> {
    return db.outbox.where("seq").belowOrEqual(maxSeq).delete();
  },

  async clearOutbox(): Promise<void> {
    await enqueue(async () => {
      await db.outbox.clear();
    });
  },

  getSyncMeta(): Promise<SyncMeta> {
    return readMeta<SyncMeta>(META.sync, DEFAULT_SYNC_META);
  },

  patchSyncMeta(patch: Partial<SyncMeta>): Promise<SyncMeta> {
    return enqueue(async () => {
      const cur = await readMeta<SyncMeta>(META.sync, DEFAULT_SYNC_META);
      const next = { ...cur, ...patch };
      await db.meta.put({ key: META.sync, value: next });
      return next;
    });
  },

  /** 本设备稳定标识（用于同步与会话冲突排查） */
  async deviceId(): Promise<string> {
    const existing = await readMeta<string | null>(META.deviceId, null);
    if (existing) return existing;
    const value =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
        : `dev_${Math.random().toString(36).slice(2, 14)}`;
    await db.meta.put({ key: META.deviceId, value });
    return value;
  },
};