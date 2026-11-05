/* 服务端同步实现：push / pull
   设计要点：
   - 变更幂等：客户端 UUID + UNIQUE(user_id, id)
   - 冲突：Last-Write-Wins（比 updatedAt；同分时墓碑胜出，避免复活）
   - 增量：每个用户一条单调递增的 seq，每次「被接受的写入」都重新分配 seq，
     因此就地更新也能被其它设备拉到；客户端游标只存 seq 数字
   - 时间戳归一化：客户端时间可能被篡改/漂移，服务端把 updatedAt 夹在
     [0, serverNow + 60s] 之间后回写，保证多设备口径一致 */

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { SyncPullResult, SyncPushResult, Transaction, UserState } from "@daybook/shared";
import { db } from "../db/client.ts";
import { devices, ledgerTransactions, userState } from "../db/schema.ts";

const FUTURE_TOLERANCE_MS = 60_000;

export function normalizeUpdatedAt(clientUpdatedAt: number, serverNow: number): number {
  if (!Number.isFinite(clientUpdatedAt) || clientUpdatedAt <= 0) return serverNow;
  return Math.min(clientUpdatedAt, serverNow + FUTURE_TOLERANCE_MS);
}

function nextSeq(userId: string, tx: typeof db): Promise<number> {
  return tx
    .select({ maxSeq: sql<number>`coalesce(max(${ledgerTransactions.seq}), 0)` })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.userId, userId))
    .then((rows) => Number(rows[0]?.maxSeq ?? 0) + 1);
}

export interface PushInput {
  userId: string;
  deviceId: string;
  transactions: Transaction[];
  state?: { payload: UserState; updatedAt: number };
}

/** payload 的物化列，供后台按金额/类型/分类做 SQL 聚合 */
export function materialize(t: Transaction): { amount: number; txType: string; categoryId: string | null } {
  return {
    amount: Number.isFinite(t.amount) ? Math.trunc(t.amount) : 0,
    txType: typeof t.type === "string" ? t.type : "expense",
    categoryId: t.categoryId ?? null,
  };
}

export async function pushChanges(input: PushInput): Promise<SyncPushResult> {
  const serverNow = Date.now();
  const { userId, deviceId, transactions, state } = input;
  let accepted = 0;
  let rejected = 0;
  let stateAccepted = false;

  if (transactions.length) {
    const ids = [...new Set(transactions.map((t) => t.id))];
    const existing = await db
      .select({
        id: ledgerTransactions.id,
        updatedAt: ledgerTransactions.updatedAt,
        deletedAt: ledgerTransactions.deletedAt,
      })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.userId, userId), inArray(ledgerTransactions.id, ids)));
    const byId = new Map(existing.map((r) => [r.id, r]));

    // 归一化 + LWW 预判
    const toWrite: Transaction[] = [];
    for (const t of transactions) {
      const normalized: Transaction = { ...t, updatedAt: normalizeUpdatedAt(t.updatedAt, serverNow) };
      const cur = byId.get(t.id);
      if (!cur) {
        toWrite.push(normalized);
        accepted++;
        continue;
      }
      if (normalized.updatedAt > cur.updatedAt) {
        toWrite.push(normalized);
        accepted++;
      } else if (normalized.updatedAt === cur.updatedAt && normalized.deletedAt !== null && cur.deletedAt === null) {
        // 同分时墓碑优先
        toWrite.push(normalized);
        accepted++;
      } else {
        rejected++;
      }
    }

    if (toWrite.length) {
      await db.transaction(async (tx) => {
        let seq = await nextSeq(userId, tx as unknown as typeof db);
        for (const t of toWrite) {
          const payload = JSON.stringify(t);
          const cols = materialize(t);
          const target = tx as unknown as typeof db;
          const rows = await target
            .select({ id: ledgerTransactions.id })
            .from(ledgerTransactions)
            .where(and(eq(ledgerTransactions.userId, userId), eq(ledgerTransactions.id, t.id)))
            .limit(1);
          if (rows.length) {
            await target
              .update(ledgerTransactions)
              .set({
                payload,
                seq,
                updatedAt: t.updatedAt,
                deletedAt: t.deletedAt,
                occurredAt: t.occurredAt,
                ...cols,
              })
              .where(and(eq(ledgerTransactions.userId, userId), eq(ledgerTransactions.id, t.id)));
          } else {
            await target.insert(ledgerTransactions).values({
              id: t.id,
              userId,
              payload,
              seq,
              updatedAt: t.updatedAt,
              deletedAt: t.deletedAt,
              occurredAt: t.occurredAt,
              ...cols,
            });
          }
          seq++;
        }
      });
    }
  }

  // 用户级状态：整包 LWW
  if (state) {
    const normalized = normalizeUpdatedAt(state.updatedAt, serverNow);
    const cur = (await db.select().from(userState).where(eq(userState.userId, userId)).limit(1))[0];
    if (!cur || normalized > cur.updatedAt) {
      const payload = JSON.stringify(state.payload);
      if (cur) {
        await db.update(userState).set({ payload, updatedAt: normalized }).where(eq(userState.userId, userId));
      } else {
        await db.insert(userState).values({ userId, payload, updatedAt: normalized });
      }
      stateAccepted = true;
    }
  }

  await touchDevice(userId, deviceId, "push");

  return {
    accepted,
    rejected,
    cursor: await maxSeq(userId),
    serverTime: serverNow,
    stateAccepted,
  };
}

export async function pullChanges(
  userId: string,
  cursor: number,
  limit: number,
  includeState: boolean,
): Promise<SyncPullResult> {
  const serverNow = Date.now();
  const rows = await db
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.userId, userId), gt(ledgerTransactions.seq, cursor)))
    .orderBy(asc(ledgerTransactions.seq), asc(ledgerTransactions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length ? page[page.length - 1].seq : cursor;

  let state: SyncPullResult["state"] = null;
  if (includeState) {
    const row = (await db.select().from(userState).where(eq(userState.userId, userId)).limit(1))[0];
    if (row) {
      state = { payload: JSON.parse(row.payload) as UserState, updatedAt: row.updatedAt };
    }
  }

  return {
    cursor: nextCursor,
    hasMore,
    transactions: page.map((r) => JSON.parse(r.payload) as Transaction),
    state,
    serverTime: serverNow,
  };
}

async function maxSeq(userId: string): Promise<number> {
  const rows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${ledgerTransactions.seq}), 0)` })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.userId, userId));
  return Number(rows[0]?.maxSeq ?? 0);
}

async function touchDevice(userId: string, deviceId: string, kind: "push" | "pull"): Promise<void> {
  const now = Date.now();
  const existing = (await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1))[0];
  if (!existing) {
    await db.insert(devices).values({
      id: deviceId,
      userId,
      lastSeenAt: now,
      pushes: kind === "push" ? 1 : 0,
      pulls: kind === "pull" ? 1 : 0,
    });
    return;
  }
  await db
    .update(devices)
    .set({
      lastSeenAt: now,
      pushes: existing.pushes + (kind === "push" ? 1 : 0),
      pulls: existing.pulls + (kind === "pull" ? 1 : 0),
    })
    .where(eq(devices.id, deviceId));
}

export { touchDevice };
