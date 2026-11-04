/* 数据模型 —— 对齐 PRD §9 */

export const SCHEMA_VERSION = 1;

export type TxType = "expense" | "income" | "transfer" | "adjustment";
export type TxSource = "manual" | "recurring" | "import" | "adjustment";

export interface Transaction {
  id: string;
  type: TxType;
  /** 金额，单位为「分」的整数。adjustment 时为带符号差额（PRD §9.6）。 */
  amount: number;
  currency: string;
  /** 二级分类；无二级时为一级分类 */
  categoryId: string | null;
  /** 冗余的一级分类，便于统计 */
  parentCategoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  /** 发生时间（可被用户修改） */
  occurredAt: number;
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  source: TxSource;
}

export type CategoryKind = "expense" | "income";

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  /** 图标 key，见 icons/Icon.tsx */
  icon: string;
  /** 分类色板色值 */
  color: string;
  sortOrder: number;
  isHidden: boolean;
  /** 常用备注模板，选中后一键填入 */
  noteTemplate: string;
}

export type AccountType = "cash" | "debit" | "credit" | "huabei" | "wallet" | "other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** 初始余额（分） */
  initialBalance: number;
  includeInAssets: boolean;
  isArchived: boolean;
  /** 信用额度（分），仅 credit / huabei 用 */
  creditLimit: number;
}

export interface Budget {
  period: "monthly";
  /** 周期起始日 1–28 */
  startDay: number;
  /** 月度总预算（分） */
  totalAmount: number;
  /** 一级分类 ID → 预算（分） */
  categoryLimits: Record<string, number>;
  /** 结余转入下月（P1） */
  rollover: boolean;
}

export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  theme: ThemeMode;
  /** 使用统计（PRD §13.3），MVP 仅本地开关，不实际上报 */
  usageStats: boolean;
}

export interface AppData {
  schemaVersion: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budget: Budget;
  settings: Settings;
  lastUsedCategoryId: string | null;
  lastUsedAccountId: string | null;
  /** 分类使用频次，用于宫格排序（PRD 风险对策：高频置顶） */
  categoryUsage: Record<string, number>;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: "现金",
  debit: "储蓄卡",
  credit: "信用卡",
  huabei: "花呗/白条",
  wallet: "电子钱包",
  other: "其他",
};

export const TX_TYPE_LABEL: Record<TxType, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  adjustment: "余额调整",
};

/** 用户级状态整包（分类 / 账户 / 预算 / 偏好）
    云同步时按 updatedAt 做整包 LWW —— 数据量小，整包覆盖比字段级合并简单可靠 */
export interface UserState {
  categories: Category[];
  accounts: Account[];
  budget: Budget;
  settings: Settings;
  categoryUsage: Record<string, number>;
  lastUsedCategoryId: string | null;
  lastUsedAccountId: string | null;
}