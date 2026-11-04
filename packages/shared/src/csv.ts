/* CSV 导入 / 导出（PRD F7） */

import type { AppData, Transaction, TxType } from "./types.ts";
import { formatAmount } from "./money.ts";
import { formatDate, formatTime } from "./date.ts";

export const CSV_HEADERS = ["日期", "时间", "类型", "一级分类", "二级分类", "金额", "账户", "备注", "币种"] as const;
const HEADERS = CSV_HEADERS;

const TYPE_TO_CN: Record<TxType, string> = { expense: "支出", income: "收入", transfer: "转账", adjustment: "余额调整" };
const CN_TO_TYPE: Record<string, TxType> = { 支出: "expense", 收入: "income", 转账: "transfer", 余额调整: "adjustment", 调整: "adjustment" };

/** 列名别名映射（中英文容错，PRD F7.3） */
const ALIAS: Record<string, string> = {
  日期: "日期", date: "日期", 时间: "时间", time: "时间",
  类型: "类型", type: "类型", kind: "类型",
  一级分类: "一级分类", 分类: "一级分类", category: "一级分类", 类别: "一级分类",
  二级分类: "二级分类", 子分类: "二级分类", subcategory: "二级分类", parent: "一级分类",
  金额: "金额", amount: "金额", money: "金额",
  账户: "账户", account: "账户", 账户名: "账户",
  备注: "备注", note: "备注", memo: "备注", remark: "备注",
  币种: "币种", currency: "币种",
};

export function transactionsToCSV(data: AppData): string {
  const rows: string[] = [HEADERS.join(",")];
  const txs = data.transactions
    .filter((t) => t.deletedAt === null)
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const accName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name ?? "";
  for (const t of txs) {
    const parent = data.categories.find((c) => c.id === t.parentCategoryId);
    const child = data.categories.find((c) => c.id === t.categoryId);
    const isParentItself = child && child.id === parent?.id;
    const row = [
      formatDate(t.occurredAt),
      formatTime(t.occurredAt),
      TYPE_TO_CN[t.type],
      parent?.name ?? "",
      isParentItself ? "" : child?.name ?? "",
      formatAmount(t.amount),
      t.type === "transfer" ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : accName(t.accountId),
      t.note,
      t.currency,
    ];
    rows.push(row.map(escapeCell).join(","));
  }
  return rows.join("\r\n");
}

function escapeCell(v: string): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ParsedRow {
  index: number;
  ok: boolean;
  error?: string;
  data?: {
    occurredAt: number;
    type: TxType;
    parentName: string;
    childName: string;
    amount: number;
    accountName: string;
    note: string;
    currency: string;
  };
}

export function parseCSV(text: string): { headers: string[]; rows: ParsedRow[]; errors: string[] } {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], errors: ["文件为空"] };
  const headers = splitCSVLine(lines[0]).map((h) => ALIAS[h.trim()] ?? h.trim());
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]);
    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const lineNo = i + 1;
    const dateStr = get("日期");
    const timeStr = get("时间") || "00:00";
    const typeCn = get("类型") || "支出";
    const amountStr = get("金额");

    if (!dateStr && !amountStr) continue; // 跳过空行

    const amount = parseMoneyCell(amountStr);
    if (amount === null) {
      rows.push({ index: lineNo, ok: false, error: amountStr === "" ? "金额为空" : `金额格式错误（${amountStr}）` });
      continue;
    }
    const occurred = parseDateCell(dateStr, timeStr);
    if (occurred === null) {
      rows.push({ index: lineNo, ok: false, error: `日期格式错误（${dateStr}）` });
      continue;
    }
    const type = CN_TO_TYPE[typeCn] ?? "expense";
    rows.push({
      index: lineNo,
      ok: true,
      data: {
        occurredAt: occurred,
        type,
        parentName: get("一级分类") || "其他",
        childName: get("二级分类"),
        amount,
        accountName: get("账户") || "现金",
        note: get("备注"),
        currency: get("币种") || "CNY",
      },
    });
  }
  return { headers, rows, errors };
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMoneyCell(v: string): number | null {
  const s = v.replace(/[¥,\s]/g, "");
  if (!s) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Math.abs(Number(s)) * 100);
}

function parseDateCell(date: string, time: string): number | null {
  const dm = date.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!dm) return null;
  const tm = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const h = tm ? Number(tm[1]) : 0;
  const mi = tm ? Number(tm[2]) : 0;
  const s = tm && tm[3] ? Number(tm[3]) : 0;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, mi, s, 0);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

export function mapImportedTransactions(
  data: AppData,
  parsed: ParsedRow[],
): { toInsert: Transaction[]; failures: ParsedRow[]; unmatched: number; duplicates: number } {
  const toInsert: Transaction[] = [];
  const failures: ParsedRow[] = [];
  let unmatched = 0;
  let duplicates = 0;
  const now = Date.now();
  const fallbackParent = data.categories.find((c) => !c.parentId && c.name === "其他");
  const fallbackChild = data.categories.find((c) => c.parentId === fallbackParent?.id) ?? fallbackParent;

  const sameDay = (a: number, b: number) => Math.abs(a - b) < 86400000 && new Date(a).toDateString() === new Date(b).toDateString();

  for (const row of parsed) {
    if (!row.ok || !row.data) {
      failures.push(row);
      continue;
    }
    const d = row.data;
    const kind = d.type === "income" ? "income" : "expense";
    const searchKind = kind === "income" ? data.categories.find((c) => !c.parentId && c.name === "收入") : null;
    const parent =
      (kind === "income" ? searchKind : data.categories.find((c) => !c.parentId && c.name === d.parentName && c.kind === "expense")) ??
      fallbackParent;
    if (!parent || (kind === "expense" && parent.name === "其他" && d.parentName !== "其他")) unmatched++;
    let child = d.childName
      ? data.categories.find((c) => c.parentId === parent?.id && c.name === d.childName)
      : undefined;
    if (d.childName && !child) unmatched++;
    if (!child) child = data.categories.find((c) => c.parentId === parent?.id) ?? parent ?? fallbackChild;
    let account = data.accounts.find((a) => a.name === d.accountName);
    if (!account) account = data.accounts[0];

    const isDup = data.transactions.some(
      (t) => t.deletedAt === null && t.amount === d.amount && sameDay(t.occurredAt, d.occurredAt) && (t.note || "") === (d.note || ""),
    );
    if (isDup) duplicates++;

    toInsert.push({
      id: `tx_imp_${now.toString(36)}_${row.index}`,
      type: d.type,
      amount: d.amount,
      currency: d.currency || "CNY",
      categoryId: child?.id ?? null,
      parentCategoryId: parent?.id ?? null,
      accountId: account?.id ?? "",
      toAccountId: null,
      occurredAt: d.occurredAt,
      note: d.note,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      source: "import",
    });
  }
  return { toInsert, failures, unmatched, duplicates };
}