/* CSV 导出下载（浏览器专用：Blob / document）
   解析与序列化等纯逻辑在 @daybook/shared，前后端共用。 */

import { transactionsToCSV, type AppData } from "@daybook/shared";

export { parseCSV, mapImportedTransactions } from "@daybook/shared";
export type { ParsedRow, AppData } from "@daybook/shared";
export { transactionsToCSV } from "@daybook/shared";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV(data: AppData): void {
  downloadFile("\uFEFF" + transactionsToCSV(data), `DayBook-${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

export function downloadJSON(data: AppData): void {
  const cloned = { ...data, transactions: data.transactions.filter((t) => t.deletedAt === null) };
  downloadFile(JSON.stringify(cloned, null, 2), `DayBook-backup-${dateStamp()}.json`, "application/json");
}

export function downloadTemplate(): void {
  const lines = [
    "日期,时间,类型,一级分类,二级分类,金额,账户,备注,币种",
    "2026-11-01,08:12,支出,餐饮,早餐,12.00,现金,包子豆浆,CNY",
    "2026-11-01,12:30,支出,餐饮,午餐,28.00,微信,公司楼下,CNY",
    "2026-11-01,18:40,收入,收入,工资,8000.00,储蓄卡,11月工资,CNY",
  ];
  downloadFile("\uFEFF" + lines.join("\r\n"), "DayBook-import-template.csv", "text/csv;charset=utf-8");
}