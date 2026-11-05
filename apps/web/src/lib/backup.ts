/* 本地每日自动备份（PRD F7.4）
   存储在 IndexedDB 的 snapshots 表 —— 不再受 localStorage 5MB 配额限制。 */

import type { AppData } from "@daybook/shared";
import { db } from "./db";

const KEEP = 7;

export interface SnapshotMeta {
  date: string;
  savedAt: number;
  records: number;
  size: number;
}

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function writeSnapshot(data: AppData): Promise<boolean> {
  try {
    const date = todayKey();
    const payload = JSON.stringify(data);
    await db.snapshots.put({
      date,
      savedAt: Date.now(),
      records: data.transactions.length,
      payload,
    });
    await prune();
    return true;
  } catch {
    return false;
  }
}

export async function hasTodaySnapshot(): Promise<boolean> {
  const row = await db.snapshots.get(todayKey());
  return Boolean(row);
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const rows = await db.snapshots.orderBy("savedAt").reverse().toArray();
  return rows.map((r) => ({ date: r.date, savedAt: r.savedAt, records: r.records, size: r.payload.length }));
}

export async function readSnapshot(date: string): Promise<AppData | null> {
  try {
    const row = await db.snapshots.get(date);
    if (!row) return null;
    return JSON.parse(row.payload) as AppData;
  } catch {
    return null;
  }
}

async function prune(): Promise<void> {
  const keys = await db.snapshots.orderBy("savedAt").reverse().primaryKeys();
  const stale = keys.slice(KEEP);
  if (stale.length) await db.snapshots.bulkDelete(stale);
}