/* 选择器：分类树 / 账户展示 */

import type { Account, AccountType, Category } from "@daybook/shared";

export const expenseParents = (cats: Category[]): Category[] =>
  cats.filter((c) => !c.parentId && c.kind === "expense" && !c.isHidden);

export const incomeParents = (cats: Category[]): Category[] =>
  cats.filter((c) => !c.parentId && c.kind === "income" && !c.isHidden);

export const childrenOf = (cats: Category[], parentId: string): Category[] =>
  cats.filter((c) => c.parentId === parentId && !c.isHidden).sort((a, b) => a.sortOrder - b.sortOrder);

export const categoryById = (cats: Category[], id: string | null): Category | undefined =>
  id ? cats.find((c) => c.id === id) : undefined;

/** 高频分类置顶（PRD 风险对策：自动按使用频次排序） */
export function sortByUsage(cats: Category[], usage: Record<string, number>): Category[] {
  return cats
    .slice()
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.sortOrder - b.sortOrder);
}

export const ACCOUNT_ICON: Record<AccountType, string> = {
  cash: "coin",
  debit: "bank",
  credit: "card",
  huabei: "card",
  wallet: "wallet",
  other: "tag",
};

export function accountIcon(a: Account): string {
  return ACCOUNT_ICON[a.type] ?? "wallet";
}

/** 分类「图标 + 文字」双编码所需的语义前缀 */
export function txSign(type: string): string {
  if (type === "income") return "↑";
  if (type === "transfer" || type === "adjustment") return "⇄";
  return "↓";
}