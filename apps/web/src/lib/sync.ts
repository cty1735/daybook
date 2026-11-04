/* 客户端同步引擎（P1 功能，P0 已铺好 outbox 与游标）
   策略：
   1) 读 outbox → 收集本端「脏」记录（含墓碑）
   2) push（服务端按 LWW 归一化 updatedAt）
   3) pull（按服务端单调 seq 增量拉取，循环直到 hasMore=false）
   4) 本地按 LWW 归并
   5) 确认并清空已推送的 outbox 行（只清 seq <= 推送前快照，避免丢新变更） */

import { mergeTransactions, resolveLWW, type Transaction } from "@daybook/shared";
import { api } from "./api";
import { repo } from "./db";
import { useStore } from "../store/store";

export interface SyncOutcome {
  pushed: number;
  rejected: number;
  pulled: number;
  applied: number;
  stateApplied: boolean;
  cursor: number;
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** 首次同步的标志：从未成功同步过（既无游标也无时间戳） */
export function isFirstSync(sync: { cursor: number; lastSyncedAt: number | null }): boolean {
  return sync.lastSyncedAt === null && sync.cursor === 0;
}

/** 同一时刻只允许一个同步在跑：App 外壳与同步页可能同时触发，重复跑会互相抢 outbox */
let inFlight: Promise<SyncOutcome> | null = null;

export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<SyncOutcome> {
  const store = useStore.getState();
  const user = await api.session();
  if (!user) throw new Error("尚未登录，无法同步");

  const deviceId = store.deviceId || (await repo.deviceId());

  // 1) 收集本端待推送内容
  const rows = await repo.drainOutbox(2000);
  const maxSeq = rows.length ? (rows[rows.length - 1].seq ?? 0) : 0;

  const txIds = new Set<string>();
  let wantState = false;
  for (const r of rows) {
    if (r.entity === "transaction") txIds.add(r.entityId);
    if (r.entity === "state") wantState = true;
  }

  const localById = new Map(store.transactions.map((t) => [t.id, t]));
  const changes: Transaction[] = [];
  if (isFirstSync(store.sync)) {
    // 首次同步：把本机全部记录一次性备份上去（含种子/迁移进来的历史数据，
    // 这些不会进 outbox，否则会永远上不了云）
    changes.push(...store.transactions);
    wantState = true;
  } else {
    for (const id of txIds) {
      const tx = localById.get(id);
      if (tx) changes.push(tx);
    }
  }

  // 2) push
  const pushRes = await api.push({
    deviceId,
    cursor: store.sync.cursor,
    transactions: changes,
    state: wantState ? { payload: store.snapshotUserState(), updatedAt: store.sync.stateUpdatedAt || Date.now() } : undefined,
  });

  // 3) pull（循环直到没有更多）
  let cursor = store.sync.cursor;
  let pulled = 0;
  let applied = 0;
  let stateApplied = false;

  for (let guard = 0; guard < 50; guard++) {
    const res = await api.pull(cursor, 500);
    pulled += res.transactions.length;
    cursor = res.cursor;

    if (res.transactions.length) {
      const local = useStore.getState().transactions;
      const before = new Map(local.map((t) => [t.id, t]));
      applied += res.transactions.filter((r) => {
        const l = before.get(r.id);
        return !l || resolveLWW(l, r) === "remote";
      }).length;
      const merged = mergeTransactions(local, res.transactions);
      useStore.setState({ transactions: merged });
      void repo.putTransactions(res.transactions, false);
    }

    if (res.state && res.state.updatedAt > useStore.getState().sync.stateUpdatedAt) {
      const ok = useStore.getState().applyRemoteUserState(res.state.payload, res.state.updatedAt);
      stateApplied = stateApplied || ok;
    }

    if (!res.hasMore) break;
  }

  // 4) 确认 outbox
  if (maxSeq) await repo.ackOutbox(maxSeq);
  await useStore.getState().refreshOutboxCount();
  useStore.getState().setSyncMeta({
    cursor,
    lastSyncedAt: Date.now(),
    serverTime: pushRes.serverTime,
  });

  return {
    pushed: pushRes.accepted,
    rejected: pushRes.rejected,
    pulled,
    applied,
    stateApplied,
    cursor,
  };
}