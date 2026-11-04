/* 统计与洞察：与 UI 分离（PRD §11 可维护性） */

import type { Account, AppData, Budget, Category, Transaction } from "./types.ts";
import { budgetPeriodRange, startOfDay } from "./date.ts";

export const activeTxs = (txs: Transaction[]): Transaction[] => txs.filter((t) => t.deletedAt === null);

/** 单账户余额 */
export function accountBalance(account: Account, txs: Transaction[]): number {
  let bal = account.initialBalance;
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (t.type === "expense" && t.accountId === account.id) bal -= t.amount;
    else if (t.type === "income" && t.accountId === account.id) bal += t.amount;
    else if (t.type === "transfer") {
      if (t.accountId === account.id) bal -= t.amount;
      if (t.toAccountId === account.id) bal += t.amount;
    } else if (t.type === "adjustment" && t.accountId === account.id) bal += t.amount;
  }
  return bal;
}

/** 信用卡「已用额度」 */
export function creditUsed(account: Account, txs: Transaction[]): number {
  let used = 0;
  for (const t of txs) {
    if (t.deletedAt !== null || t.accountId !== account.id) continue;
    if (t.type === "expense") used += t.amount;
    else if (t.type === "transfer" && t.toAccountId === account.id) used -= t.amount;
  }
  return Math.max(0, account.initialBalance + used);
}

export interface RangeTotals {
  expense: number;
  income: number;
  net: number;
}

export function totalsInRange(txs: Transaction[], start: number, end: number): RangeTotals {
  let expense = 0;
  let income = 0;
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (t.occurredAt < start || t.occurredAt > end) continue;
    if (t.type === "expense") expense += t.amount;
    else if (t.type === "income") income += t.amount;
  }
  return { expense, income, net: income - expense };
}

/** 一级分类下辖的所有分类 ID（含自身） */
export function categoryBranchIds(cats: Category[], parentId: string): string[] {
  const ids = [parentId];
  cats.filter((c) => c.parentId === parentId).forEach((c) => ids.push(c.id));
  return ids;
}

export interface CategoryStat {
  category: Category;
  amount: number;
  share: number;
  prevAmount: number;
  deltaPct: number | null;
}

export function categoryBreakdown(
  data: AppData,
  start: number,
  end: number,
  prevStart: number,
  prevEnd: number,
): CategoryStat[] {
  const parents = data.categories.filter((c) => !c.parentId && c.kind === "expense" && !c.isHidden);
  const byParent = new Map<string, { amount: number; prev: number }>();
  const record = (map: "amount" | "prev", parentId: string | null, amount: number) => {
    if (!parentId) return;
    const cur = byParent.get(parentId) ?? { amount: 0, prev: 0 };
    cur[map] += amount;
    byParent.set(parentId, cur);
  };
  for (const t of data.transactions) {
    if (t.deletedAt !== null || t.type !== "expense") continue;
    if (t.occurredAt >= start && t.occurredAt <= end) record("amount", t.parentCategoryId, t.amount);
    if (t.occurredAt >= prevStart && t.occurredAt <= prevEnd) record("prev", t.parentCategoryId, t.amount);
  }
  const total = [...byParent.values()].reduce((s, v) => s + v.amount, 0);
  return parents
    .map((category) => {
      const v = byParent.get(category.id) ?? { amount: 0, prev: 0 };
      const deltaPct = v.prev > 0 ? ((v.amount - v.prev) / v.prev) * 100 : null;
      return {
        category,
        amount: v.amount,
        share: total > 0 ? v.amount / total : 0,
        prevAmount: v.prev,
        deltaPct,
      };
    })
    .filter((s) => s.amount > 0 || s.prevAmount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** 每日支出序列（月视图柱状图） */
export function dailySeries(txs: Transaction[], year: number, month0: number): { day: number; amount: number }[] {
  const start = new Date(year, month0, 1, 0, 0, 0, 0).getTime();
  const days = new Date(year, month0 + 1, 0).getDate();
  const arr = Array.from({ length: days }, (_, i) => ({ day: i + 1, amount: 0 }));
  for (const t of txs) {
    if (t.deletedAt !== null || t.type !== "expense") continue;
    const d = new Date(t.occurredAt);
    if (d.getFullYear() !== year || d.getMonth() !== month0) continue;
    const idx = d.getDate() - 1;
    if (idx >= 0 && idx < days && t.occurredAt >= start) arr[idx].amount += t.amount;
  }
  return arr;
}

/** 每月支出序列（年视图折线） */
export function monthlySeries(txs: Transaction[], year: number): { month: number; amount: number }[] {
  const arr = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: 0 }));
  for (const t of txs) {
    if (t.deletedAt !== null || t.type !== "expense") continue;
    const d = new Date(t.occurredAt);
    if (d.getFullYear() !== year) continue;
    arr[d.getMonth()].amount += t.amount;
  }
  return arr;
}

/** 账户维度本月支出分布 */
export function accountBreakdown(data: AppData, start: number, end: number): { account: Account; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.deletedAt !== null || t.type !== "expense") continue;
    if (t.occurredAt < start || t.occurredAt > end) continue;
    map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amount);
  }
  return data.accounts
    .map((account) => ({ account, amount: map.get(account.id) ?? 0 }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export type BudgetState = "ok" | "warn" | "over";

export interface BudgetStatus {
  total: number;
  used: number;
  remaining: number;
  ratio: number;
  state: BudgetState;
  daysLeft: number;
  dailyAvailable: number;
  /** 0–1，用于进度条宽度 */
  barRatio: number;
  periodStart: number;
  periodEnd: number;
}

export function budgetStatus(data: AppData, now = Date.now()): BudgetStatus {
  const b: Budget = data.budget;
  const { start, end } = budgetPeriodRange(now, b.startDay);
  const { expense } = totalsInRange(data.transactions, start, end);
  const total = b.totalAmount;
  const used = expense;
  const remaining = total - used;
  const ratio = total > 0 ? used / total : 0;
  const state: BudgetState = ratio > 1 ? "over" : ratio >= 0.7 ? "warn" : "ok";
  const endDay = startOfDay(end);
  const today = startOfDay(now);
  const daysLeft = Math.max(1, Math.round((endDay - today) / 86400000) + 1);
  return {
    total,
    used,
    remaining,
    ratio,
    state,
    daysLeft,
    dailyAvailable: Math.max(0, Math.round(remaining / daysLeft)),
    barRatio: Math.min(1, ratio),
    periodStart: start,
    periodEnd: end,
  };
}

/** 一级分类预算消耗 */
export function categoryBudgetStatus(
  data: AppData,
  categoryId: string,
  limit: number,
  now = Date.now(),
): { used: number; ratio: number; state: BudgetState; remaining: number } {
  const { start, end } = budgetPeriodRange(now, data.budget.startDay);
  const ids = new Set(categoryBranchIds(data.categories, categoryId));
  let used = 0;
  for (const t of data.transactions) {
    if (t.deletedAt !== null || t.type !== "expense") continue;
    if (t.occurredAt < start || t.occurredAt > end) continue;
    if (t.parentCategoryId && ids.has(t.parentCategoryId)) used += t.amount;
  }
  const ratio = limit > 0 ? used / limit : 0;
  const state: BudgetState = ratio > 1 ? "over" : ratio >= 0.7 ? "warn" : "ok";
  return { used, ratio, state, remaining: limit - used };
}

/* ------------------------------------------------------------------
   洞察卡片（PRD §6.2 规则引擎，优先级 R1 > R4 > R2 > R5 > R3 > R6）
   ------------------------------------------------------------------ */
export interface Insight {
  id: string;
  rule: "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
  priority: number;
  tone: "ok" | "warn" | "over";
  emoji: string;
  /** 富文本片段，便于加粗 */
  text: string;
  amount?: number;
  percent?: number;
  detail?: string;
}

export function generateInsights(data: AppData, now = Date.now()): Insight[] {
  const txs = data.transactions.filter((t) => t.deletedAt === null);
  const b = data.budget;
  const { start, end } = budgetPeriodRange(now, b.startDay);
  const dayMs = 86400000;
  const prevStart = start - (end - start + 1);
  const prevEnd = start - 1;

  const cur = totalsInRange(txs, start, end);
  const prev = totalsInRange(txs, prevStart, prevEnd);

  const insights: Insight[] = [];

  // R1 超支预警：某分类环比增幅 > 30% 且金额 > 200
  const breakdown = categoryBreakdown(data, start, end, prevStart, prevEnd);
  const r1hit = breakdown.find((s) => s.deltaPct !== null && s.deltaPct > 30 && s.amount > 20000);
  if (r1hit) {
    const cnt = txs.filter(
      (t) => t.type === "expense" && t.parentCategoryId === r1hit.category.id && t.occurredAt >= start && t.occurredAt <= end,
    ).length;
    insights.push({
      id: "R1",
      rule: "R1",
      priority: 1,
      tone: "warn",
      emoji: "📈",
      text: `${r1hit.category.name}比上个周期多花了 ¥${(r1hit.amount - r1hit.prevAmount) / 100}（+${Math.round(r1hit.deltaPct!)}%），共 ${cnt} 笔`,
      amount: r1hit.amount - r1hit.prevAmount,
      percent: r1hit.deltaPct!,
      detail: `本周期 ¥${r1hit.amount / 100} / 上周期 ¥${r1hit.prevAmount / 100}`,
    });
  }

  // R4 预算节奏：时间过半但预算消耗 > 70%
  const totalDays = Math.round((startOfDay(end) - startOfDay(start)) / dayMs) + 1;
  const passedDays = Math.min(totalDays, Math.round((startOfDay(now) - startOfDay(start)) / dayMs) + 1);
  const ratio = b.totalAmount > 0 ? cur.expense / b.totalAmount : 0;
  if (b.totalAmount > 0 && passedDays < totalDays && ratio > 0.7) {
    const remain = Math.max(1, totalDays - passedDays);
    insights.push({
      id: "R4",
      rule: "R4",
      priority: 2,
      tone: ratio > 1 ? "over" : "warn",
      emoji: "⏳",
      text: `本周期过了 ${passedDays} 天，预算已用 ${Math.round(ratio * 100)}%，建议日均控制在 ¥${Math.round((b.totalAmount - cur.expense) / 100 / remain)} 内`,
      percent: ratio * 100,
    });
  }

  // R2 高频小额：单笔 < 30 元的记录 ≥ 20 笔
  const small = txs.filter((t) => t.type === "expense" && t.amount > 0 && t.amount < 3000 && t.occurredAt >= start && t.occurredAt <= end);
  if (small.length >= 20) {
    const sum = small.reduce((s, t) => s + t.amount, 0);
    const share = cur.expense > 0 ? Math.round((sum / cur.expense) * 100) : 0;
    insights.push({
      id: "R2",
      rule: "R2",
      priority: 3,
      tone: "ok",
      emoji: "🧾",
      text: `你有 ${small.length} 笔 30 元以下支出，共 ¥${sum / 100}，占本周期 ${share}%`,
      amount: sum,
      percent: share,
    });
  }

  // R5 异常单笔：单笔 > 当月日均 5 倍
  const expenseTxs = txs.filter((t) => t.type === "expense" && t.occurredAt >= start && t.occurredAt <= end);
  const dailyAvg = passedDays > 0 ? cur.expense / passedDays : 0;
  const maxTx = expenseTxs.slice().sort((a, b2) => b2.amount - a.amount)[0];
  if (maxTx && dailyAvg > 0 && maxTx.amount > dailyAvg * 5 && maxTx.amount > 50000) {
    const d = new Date(maxTx.occurredAt);
    const catName = data.categories.find((c) => c.id === maxTx.parentCategoryId)?.name ?? "支出";
    insights.push({
      id: "R5",
      rule: "R5",
      priority: 4,
      tone: "warn",
      emoji: "🔍",
      text: `${d.getMonth() + 1}月${d.getDate()}日 一笔 ¥${maxTx.amount / 100}（${catName}），是本周期最大支出`,
      amount: maxTx.amount,
    });
  }

  // R3 固定支出占比：房租/订阅类合计 > 40%
  const fixedParents = ["居住", "通讯"];
  const fixedIds = new Set<string>();
  data.categories
    .filter((c) => !c.parentId && fixedParents.includes(c.name))
    .forEach((c) => fixedIds.add(c.id));
  const fixedSum = expenseTxs.filter((t) => t.parentCategoryId && fixedIds.has(t.parentCategoryId)).reduce((s, t) => s + t.amount, 0);
  if (cur.income > 0 && fixedSum / cur.income > 0.4) {
    insights.push({
      id: "R3",
      rule: "R3",
      priority: 5,
      tone: "warn",
      emoji: "🏠",
      text: `固定支出 ¥${fixedSum / 100}，占本周期收入 ${Math.round((fixedSum / cur.income) * 100)}%，可压缩空间在订阅项`,
      amount: fixedSum,
    });
  }

  // R6 结余
  if (cur.income > 0) {
    const saving = Math.round((cur.net / cur.income) * 100);
    const prevSaving = prev.income > 0 ? Math.round((prev.net / prev.income) * 100) : null;
    const diff = prevSaving === null ? null : saving - prevSaving;
    insights.push({
      id: "R6",
      rule: "R6",
      priority: 6,
      tone: cur.net >= 0 ? "ok" : "over",
      emoji: cur.net >= 0 ? "🌱" : "⚠️",
      text:
        cur.net >= 0
          ? `本周期结余 ¥${cur.net / 100}，储蓄率 ${saving}%${diff !== null ? `，比上周期${diff >= 0 ? "高" : "低"} ${Math.abs(diff)} 个点` : ""}`
          : `本周期超支 ¥${Math.abs(cur.net) / 100}，储蓄率 ${saving}%`,
      amount: cur.net,
    });
  }

  return insights.sort((a, b2) => a.priority - b2.priority).slice(0, 3);
}