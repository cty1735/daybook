/* 后台视角的「账本名称字典」
   前台把分类 / 账户 / 预算整包存在 user_state.payload 里，分类和账户 id 是
   每个用户各自的 UUID（同名分类在不同用户下 id 不同）。后台列表如果只回
   categoryId 就是一堆 UUID，运营看不懂。这里统一把 id → 名称映射出来，
   让后台展示与前台完全一致。

   - id 是客户端生成的全局唯一串，跨用户不会撞，所以可以合成一张大表
   - 只读 user_state，不碰流水，成本低（用户数 × 一次解析）
   - 按 userId 过滤时只解析需要的行，列表页不会全表扫 */

import { inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { userState } from "../db/schema.ts";
import type { Account, Budget, Category, Settings, UserState } from "@daybook/shared";

export interface LedgerNames {
  category: Map<string, Category>;
  account: Map<string, Account>;
}

const EMPTY: LedgerNames = { category: new Map(), account: new Map() };

interface ParsedState {
  state: UserState | null;
  updatedAt: number;
}

/** 读取指定用户（不传则全量）的 user_state 并解析；坏数据不影响整体 */
export async function loadStates(userIds?: string[]): Promise<Map<string, ParsedState>> {
  const rows = userIds
    ? userIds.length
      ? await db
          .select()
          .from(userState)
          .where(inArray(userState.userId, [...new Set(userIds)]))
      : []
    : await db.select().from(userState);

  const out = new Map<string, ParsedState>();
  for (const row of rows) {
    try {
      out.set(row.userId, { state: JSON.parse(row.payload) as UserState, updatedAt: row.updatedAt });
    } catch {
      out.set(row.userId, { state: null, updatedAt: row.updatedAt });
    }
  }
  return out;
}

/** 汇总 id → 分类 / 账户（同名不同 id 不合并，各自保留） */
export async function ledgerNameMaps(userIds?: string[]): Promise<LedgerNames> {
  const states = await loadStates(userIds);
  const category = new Map<string, Category>();
  const account = new Map<string, Account>();
  for (const { state } of states.values()) {
    if (!state) continue;
    for (const c of state.categories ?? []) {
      if (c?.id) category.set(c.id, c);
    }
    for (const a of state.accounts ?? []) {
      if (a?.id) account.set(a.id, a);
    }
  }
  return { category, account };
}

export function emptyNames(): LedgerNames {
  return EMPTY;
}

/** 单个用户账本的结构化摘要（后台「用户账本」抽屉用） */
export interface LedgerSummary {
  categories: Category[];
  accounts: Account[];
  budget: Budget | null;
  settings: Settings | null;
  updatedAt: number;
}

export async function loadLedgerSummary(userId: string): Promise<LedgerSummary | null> {
  const hit = (await loadStates([userId])).get(userId);
  if (!hit) return null;
  return {
    categories: hit.state?.categories ?? [],
    accounts: hit.state?.accounts ?? [],
    budget: hit.state?.budget ?? null,
    settings: hit.state?.settings ?? null,
    updatedAt: hit.updatedAt,
  };
}
