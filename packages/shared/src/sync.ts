/* 同步协议：类型 + Last-Write-Wins 归并
   设计要点（见 README / 架构说明）：
   - 客户端生成 UUID → 天然幂等
   - 游标用「服务端单调自增 seq」，不用时间戳（用户可能改设备时间）
   - updatedAt 由服务端归一化后回写
   - 删除用墓碑（deletedAt），同分时墓碑优先，避免「复活」 */

import type { Transaction, UserState } from "./types.ts";

export interface SyncPushResult {
  /** 被接受的变更数（LWW 胜出并写入的） */
  accepted: number;
  /** 因本地版本落后而被丢弃的变更数 */
  rejected: number;
  /** 推送后服务端该用户可见的最大 seq */
  cursor: number;
  serverTime: number;
  stateAccepted: boolean;
}

export interface SyncPullResult {
  cursor: number;
  hasMore: boolean;
  transactions: Transaction[];
  state: { payload: UserState; updatedAt: number } | null;
  serverTime: number;
}

export interface SyncProgress {
  phase: "idle" | "pushing" | "pulling" | "done" | "error";
  pushed: number;
  pulled: number;
  message?: string;
}

export type LwwWinner = "local" | "remote" | "same";

interface Lwwable {
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * 判定同一条记录在「本地 vs 远端」中谁胜出。
 * 规则：updatedAt 大者胜；完全相等时若一方是墓碑（已删除）则该方胜（避免复活）。
 */
export function resolveLWW(local: Lwwable, remote: Lwwable): LwwWinner {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? "local" : "remote";
  }
  const localDeleted = local.deletedAt !== null;
  const remoteDeleted = remote.deletedAt !== null;
  if (localDeleted === remoteDeleted) return "same";
  return localDeleted ? "local" : "remote";
}

/** 按 id 把远端变更归并进本地列表（返回新数组，不修改入参） */
export function mergeTransactions(local: Transaction[], remote: Transaction[]): Transaction[] {
  const byId = new Map(local.map((t) => [t.id, t]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    if (resolveLWW(l, r) === "remote") byId.set(r.id, r);
  }
  return [...byId.values()];
}

/** 判断两条记录内容是否完全一致（用于跳过无意义的写入） */
export function isSameTransaction(a: Transaction, b: Transaction): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.deletedAt === b.deletedAt &&
    a.amount === b.amount &&
    a.type === b.type &&
    a.categoryId === b.categoryId &&
    a.parentCategoryId === b.parentCategoryId &&
    a.accountId === b.accountId &&
    a.toAccountId === b.toAccountId &&
    a.occurredAt === b.occurredAt &&
    a.note === b.note
  );
}