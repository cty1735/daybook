/* 后台公共格式化工具 */

/** 金额（分）→ ¥1,234.56 */
export function yuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("zh-CN");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}¥${whole}.${frac}`;
}

/** 时间戳 → 2026-11-04 17:32 */
export function dt(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dateOnly(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 相对时间：刚刚 / 3 分钟前 / 2 天前 */
export function rel(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return dateOnly(ts);
}

/** 秒 → 3d 4h / 4h 12m / 12m */
export function uptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const TX_TYPE_LABEL: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  adjustment: "余额调整",
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  cash: "现金",
  debit: "储蓄卡",
  credit: "信用卡",
  huabei: "花呗/白条",
  wallet: "电子钱包",
  other: "其他",
};

export const ACTION_LABEL: Record<string, string> = {
  "user.ban": "封禁用户",
  "user.unban": "解封用户",
  "user.role": "变更角色",
  "user.revoke-sessions": "强制下线",
  "tx.soft-delete": "删除流水",
  "tx.restore": "恢复流水",
};

/** 本地日期 → YYYY-MM-DD（给 input[type=date] 用） */
export function todayInput(): string {
  return dateOnly(Date.now());
}

/** YYYY-MM-DD → 当天 00:00 的毫秒 */
export function dayStartMs(s: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(`${s}T00:00:00`);
  return Number.isFinite(t) ? t : undefined;
}

/** YYYY-MM-DD → 当天 23:59:59.999 的毫秒 */
export function dayEndMs(s: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(`${s}T23:59:59.999`);
  return Number.isFinite(t) ? t : undefined;
}
