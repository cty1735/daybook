/* 日期工具：本地时区 */

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 该时间点所属的「预算周期」起止（支持自定义起始日，PRD F5.2） */
export function budgetPeriodRange(ts: number, startDay: number): { start: number; end: number; days: number } {
  const d = new Date(ts);
  const day = d.getDate();
  let startMonth = d.getMonth();
  let startYear = d.getFullYear();
  if (day < startDay) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }
  const start = new Date(startYear, startMonth, startDay, 0, 0, 0, 0).getTime();
  const end = new Date(startYear, startMonth + 1, startDay, 0, 0, 0, 0).getTime() - 1;
  const days = Math.round((endOfDay(end) - startOfDay(start)) / 86400000);
  return { start, end, days };
}

/** 自然月范围 */
export function monthRange(year: number, month0: number): { start: number; end: number } {
  const start = new Date(year, month0, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month0 + 1, 1, 0, 0, 0, 0).getTime() - 1;
  return { start, end };
}

export function yearRange(year: number): { start: number; end: number } {
  const start = new Date(year, 0, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
  return { start, end };
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isSameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b);
}

export function isToday(ts: number): boolean {
  return isSameDay(ts, Date.now());
}

/** 11月3日 周一 */
export function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

/** 2026-11-01 */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 08:12 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** datetime-local 输入框需要的值 */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

export function formatMonthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function formatMonthShort(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月`;
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** 昨天/今天/明天 这类相对描述 */
export function relativeDayLabel(ts: number): string | null {
  const today = startOfDay(Date.now());
  const target = startOfDay(ts);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  if (diff === -2) return "前天";
  return null;
}