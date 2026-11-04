/* 金额工具：内部一律以「分」为整数存储，展示时换算（PRD §9.6） */

/** 分 → 带千分位的字符串，如 1234567 → "12,345.67" */
export function formatAmount(cents: number, opts?: { decimals?: boolean }): string {
  const decimals = opts?.decimals ?? true;
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const yuanStr = yuan.toLocaleString("zh-CN");
  const base = decimals ? `${yuanStr}.${String(fen).padStart(2, "0")}` : yuanStr;
  return neg ? `-${base}` : base;
}

/** 分 → 带 ¥ 前缀 */
export function formatMoney(cents: number, opts?: { decimals?: boolean; symbol?: string }): string {
  const symbol = opts?.symbol ?? "¥";
  return symbol + formatAmount(cents, opts);
}

/** 分 → 人民币大写（用于工具提示，非必需） */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[¥,\s]/g, "");
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** 键盘输入拼接：限制整数 9 位、小数 2 位（PRD F1.2） */
export function pushDigit(current: string, digit: string): { next: string; error?: string } {
  if (current.includes(".")) {
    const [, frac = ""] = current.split(".");
    if (digit === ".") return { next: current };
    if (frac.length >= 2) return { next: current };
    return { next: current + digit };
  }
  if (digit === ".") {
    if (current === "") return { next: "0." };
    return { next: current + "." };
  }
  const intPart = current === "" ? digit : current + digit;
  if (intPart.replace(/^0+(?=\d)/, "").length > 9) {
    return { next: current, error: "金额过大" };
  }
  // 避免前导零
  if (current === "0") return { next: digit };
  return { next: intPart };
}

export function backspace(current: string): string {
  return current.slice(0, -1);
}

/** 把输入的字符串转成展示用金额，如 "12" → "¥12.00" */
export function displayInput(input: string): string {
  if (!input) return "";
  const cents = parseAmountToCents(input);
  if (cents === null) return input;
  return formatAmount(cents);
}

export function parseCents(input: string): number {
  const c = parseAmountToCents(input);
  return c === null ? 0 : c;
}