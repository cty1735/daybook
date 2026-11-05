/* 默认分类体系 + 账户 + 示例数据（PRD §F2 / §F3） */

import type { Account, AppData, Budget, Category, Settings } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

const COLORS = [
  "#57C994", "#2A9E67", "#A8D96B", "#7ECEF4", "#6B8CE0", "#BFB0F2",
  "#FFA8C0", "#FFB088", "#FFD670", "#E5926B", "#6F9E86", "#8C9C94",
];

export const CATEGORY_PALETTE = COLORS;

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface DefParent {
  name: string;
  icon: string;
  color: string;
  children: [string, string][]; // [name, icon]
}

const EXPENSE_DEFS: DefParent[] = [
  { name: "餐饮", icon: "food", color: COLORS[0], children: [["早餐", "food"], ["午餐", "food"], ["晚餐", "food"], ["外卖", "bag"], ["咖啡饮品", "coffee"], ["零食", "candy"], ["聚餐", "users"]] },
  { name: "交通", icon: "car", color: COLORS[1], children: [["公交地铁", "train"], ["打车", "car"], ["加油", "fuel"], ["停车", "parking"], ["高速", "car"], ["火车机票", "plane"]] },
  { name: "购物", icon: "bag", color: COLORS[2], children: [["日用品", "bag"], ["服饰", "shirt"], ["数码", "device"], ["美妆", "beauty"], ["家居", "sofa"]] },
  { name: "居住", icon: "home", color: COLORS[3], children: [["房租", "home"], ["物业", "home"], ["水电燃气", "bolt"], ["维修", "wrench"]] },
  { name: "通讯", icon: "phone", color: COLORS[4], children: [["话费", "phone"], ["宽带", "refresh"], ["会员订阅", "card"]] },
  { name: "娱乐", icon: "film", color: COLORS[5], children: [["电影", "film"], ["游戏", "gamepad"], ["演出", "ticket"], ["运动健身", "dumbbell"]] },
  { name: "医疗", icon: "pill", color: COLORS[6], children: [["挂号问诊", "pill"], ["药品", "pill"]] },
  { name: "教育", icon: "book", color: COLORS[7], children: [["课程", "book"], ["书籍", "book"]] },
  { name: "人情", icon: "gift", color: COLORS[8], children: [["红包", "envelope"], ["礼物", "gift"], ["随礼", "users"]] },
  { name: "旅行", icon: "plane", color: COLORS[9], children: [["交通", "car"], ["住宿", "bed"], ["门票", "ticket"]] },
  { name: "宠物", icon: "paw", color: COLORS[10], children: [["宠物食品", "candy"], ["宠物医疗", "pill"]] },
  { name: "其他", icon: "tag", color: COLORS[11], children: [["未分类", "tag"]] },
];

const INCOME_DEFS: DefParent = {
  name: "收入",
  icon: "coin",
  color: COLORS[1],
  children: [["工资", "briefcase"], ["奖金", "coin"], ["兼职", "briefcase"], ["理财收益", "trendUp"], ["退款", "undo"], ["红包", "envelope"], ["其他", "tag"]],
};

export function buildDefaultCategories(): Category[] {
  const cats: Category[] = [];
  let order = 0;
  EXPENSE_DEFS.forEach((p) => {
    const pid = uid("cat");
    cats.push({ id: pid, parentId: null, name: p.name, kind: "expense", icon: p.icon, color: p.color, sortOrder: order++, isHidden: false, noteTemplate: "" });
    p.children.forEach(([name, icon], i) => {
      cats.push({ id: uid("cat"), parentId: pid, name, kind: "expense", icon, color: p.color, sortOrder: i, isHidden: false, noteTemplate: "" });
    });
  });
  const pid = uid("cat");
  cats.push({ id: pid, parentId: null, name: INCOME_DEFS.name, kind: "income", icon: INCOME_DEFS.icon, color: INCOME_DEFS.color, sortOrder: 0, isHidden: false, noteTemplate: "" });
  INCOME_DEFS.children.forEach(([name, icon], i) => {
    cats.push({ id: uid("cat"), parentId: pid, name, kind: "income", icon, color: INCOME_DEFS.color, sortOrder: i, isHidden: false, noteTemplate: "" });
  });
  return cats;
}

export function buildDefaultAccounts(): Account[] {
  const mk = (name: string, type: Account["type"], init: number, include: boolean, limit = 0): Account => ({
    id: uid("acc"),
    name,
    type,
    initialBalance: init,
    includeInAssets: include,
    isArchived: false,
    creditLimit: limit,
  });
  // 新用户从零开始：初始余额一律为 0，不伪造「资产」
  return [
    mk("现金", "cash", 0, true),
    mk("微信", "wallet", 0, true),
    mk("支付宝", "wallet", 0, true),
    mk("储蓄卡", "debit", 0, true),
    mk("信用卡", "credit", 0, false, 2000000),
  ];
}

export function buildDefaultBudget(): Budget {
  // 不预置预算金额，首页引导用户自己设置
  return { period: "monthly", startDay: 1, totalAmount: 0, categoryLimits: {}, rollover: false };
}

export function buildDefaultSettings(): Settings {
  return { theme: "system", usageStats: true };
}

export function buildInitialData(): AppData {
  const categories = buildDefaultCategories();
  const accounts = buildDefaultAccounts();
  const food = categories.find((c) => c.parentId === null && c.name === "餐饮");
  const cash = accounts.find((a) => a.name === "现金");
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts,
    categories,
    transactions: [],
    budget: buildDefaultBudget(),
    settings: buildDefaultSettings(),
    lastUsedCategoryId: food?.id ?? null,
    lastUsedAccountId: cash?.id ?? null,
    categoryUsage: {},
  };
}

/* ------------------------------------------------------------------
   示例数据（仅手动触发「载入示例数据」时调用，新用户默认不预置）
   按「今天」相对生成，保证任何时候载入都有内容可看
   ------------------------------------------------------------------ */
export function buildDemoTransactions(data: AppData): AppData["transactions"] {
  const byName = (parent: string, child: string) => {
    const p = data.categories.find((c) => !c.parentId && c.name === parent);
    const c = data.categories.find((x) => x.parentId === p?.id && x.name === child);
    return { parentId: p?.id ?? null, categoryId: c?.id ?? p?.id ?? null };
  };
  const acc = (name: string) => data.accounts.find((a) => a.name === name)?.id ?? data.accounts[0].id;
  const now = new Date();
  const txs: AppData["transactions"] = [];
  const at = (dayOffset: number, h: number, m: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0, 0);
    return d.getTime();
  };

  const push = (
    dayOffset: number,
    h: number,
    m: number,
    kind: "expense" | "income",
    parent: string,
    child: string,
    yuan: number,
    account: string,
    note: string,
  ) => {
    const { parentId, categoryId } = byName(parent, child);
    const ts = at(dayOffset, h, m);
    txs.push({
      id: uid("tx"),
      type: kind,
      amount: Math.round(yuan * 100),
      currency: "CNY",
      categoryId,
      parentCategoryId: parentId,
      accountId: acc(account),
      toAccountId: null,
      occurredAt: ts,
      note,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      source: "manual",
    });
  };

  const today = now.getDate();

  // 工资（本月发薪日，若已过则落在当天）
  push(-Math.max(0, Math.min(today - 9, today - 1)), 10, 0, "income", "收入", "工资", 12800, "储蓄卡", `${now.getMonth() + 1}月工资`);

  const plan: [number, number, number, string, string, string, number, string, string][] = [
    [0, 8, 12, "expense", "餐饮", "早餐", 12, "现金", "楼下包子豆浆"],
    [0, 12, 30, "expense", "餐饮", "午餐", 28, "微信", "公司楼下快餐"],
    [0, 14, 30, "expense", "餐饮", "咖啡饮品", 28, "微信", "冰美式"],
    [0, 19, 20, "expense", "购物", "日用品", 46.5, "支付宝", "洗发水与纸巾"],
    [-1, 8, 5, "expense", "交通", "公交地铁", 4, "支付宝", ""],
    [-1, 12, 40, "expense", "餐饮", "外卖", 32, "微信", "黄焖鸡"],
    [-1, 20, 10, "expense", "娱乐", "运动健身", 60, "微信", "健身房单次"],
    [-2, 9, 30, "expense", "交通", "打车", 38, "支付宝", "上班快迟到了"],
    [-2, 18, 0, "expense", "餐饮", "聚餐", 168, "微信", "同事聚餐"],
    [-3, 12, 0, "expense", "餐饮", "外卖", 25, "微信", "麻辣烫"],
    [-3, 21, 0, "expense", "通讯", "会员订阅", 25, "支付宝", "视频会员"],
    [-4, 10, 0, "expense", "医疗", "药品", 58, "支付宝", "感冒药"],
    [-4, 19, 0, "expense", "购物", "数码", 129, "储蓄卡", "机械键盘"],
    [-5, 8, 20, "expense", "餐饮", "早餐", 9, "现金", ""],
    [-5, 13, 0, "expense", "餐饮", "午餐", 36, "微信", ""],
    [-6, 11, 0, "expense", "居住", "水电燃气", 142, "支付宝", "9月水电"],
    [-6, 20, 30, "expense", "娱乐", "电影", 45, "微信", "一个人看电影"],
    [-7, 7, 50, "expense", "交通", "公交地铁", 8, "支付宝", ""],
    [-7, 12, 30, "expense", "餐饮", "午餐", 22, "微信", ""],
    [-8, 16, 0, "expense", "餐饮", "零食", 21, "微信", "办公室下午茶"],
  ];
  plan.forEach(([d, h, m, kind, p, c, yuan, account, note]) => {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (target.getMonth() !== now.getMonth() || target.getFullYear() !== now.getFullYear()) return;
    push(d, h, m, kind as "expense" | "income", p, c, yuan, account, note);
  });

  // 房租（上月与本月）
  const rentDay = new Date(now.getFullYear(), now.getMonth(), Math.min(5, today));
  push(rentDay.getDate() - today, 9, 0, "expense", "居住", "房租", 2600, "储蓄卡", "每月房租");
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 5, 9, 0, 0, 0);
  const rentPrev = { ...byName("居住", "房租") };
  txs.push({
    id: uid("tx"),
    type: "expense",
    amount: 260000,
    currency: "CNY",
    categoryId: rentPrev.categoryId,
    parentCategoryId: rentPrev.parentId,
    accountId: acc("储蓄卡"),
    toAccountId: null,
    occurredAt: prevMonth.getTime(),
    note: "每月房租",
    createdAt: prevMonth.getTime(),
    updatedAt: prevMonth.getTime(),
    deletedAt: null,
    source: "manual",
  });

  // 上月一些餐饮，用于环比对比
  const prevFood: [number, number, number, string][] = [
    [3, 12, 30, "上月午餐"],
    [8, 19, 0, "上月晚餐"],
    [12, 12, 0, "上月外卖"],
    [15, 14, 0, "上月咖啡"],
  ];
  prevFood.forEach(([day, h, m, note], i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, day, h, m, 0, 0);
    const { parentId, categoryId } = byName("餐饮", i % 2 === 0 ? "午餐" : "外卖");
    txs.push({
      id: uid("tx"),
      type: "expense",
      amount: (18 + i * 6) * 100,
      currency: "CNY",
      categoryId,
      parentCategoryId: parentId,
      accountId: acc(i % 2 === 0 ? "微信" : "支付宝"),
      toAccountId: null,
      occurredAt: d.getTime(),
      note,
      createdAt: d.getTime(),
      updatedAt: d.getTime(),
      deletedAt: null,
      source: "manual",
    });
  });

  return txs.sort((a, b) => b.occurredAt - a.occurredAt);
}

export function withDemoData(data: AppData): AppData {
  return { ...data, transactions: buildDemoTransactions(data) };
}

/* 旧版本会自动预置示例账单。这里用「备注 + 不可变时间戳」识别整本都是示例数据，
   仅用于一次性迁移清理，绝不碰用户自己记的账。 */
const DEMO_NOTES = new Set([
  "楼下包子豆浆",
  "公司楼下快餐",
  "冰美式",
  "洗发水与纸巾",
  "黄焖鸡",
  "健身房单次",
  "上班快迟到了",
  "同事聚餐",
  "麻辣烫",
  "视频会员",
  "感冒药",
  "机械键盘",
  "9月水电",
  "一个人看电影",
  "办公室下午茶",
  "每月房租",
  "上月午餐",
  "上月晚餐",
  "上月外卖",
  "上月咖啡",
]);

function isDemoRecord(t: AppData["transactions"][number]): boolean {
  if (t.source !== "manual" || t.deletedAt !== null) return false;
  if (t.createdAt !== t.updatedAt || t.createdAt !== t.occurredAt) return false;
  if (DEMO_NOTES.has(t.note) || /^\d{1,2}月工资$/.test(t.note)) return true;
  // 示例里有 4 条无备注的小额交通/餐饮，用金额 + 时段兜底
  const hour = new Date(t.occurredAt).getHours();
  return t.note === "" && [400, 800, 900, 3600].includes(t.amount) && [7, 8, 13].includes(hour);
}

/** 整本流水是否全部来自旧版自动预置的示例数据 */
export function isLegacyDemoLedger(txs: AppData["transactions"]): boolean {
  const active = txs.filter((t) => t.deletedAt === null);
  return active.length > 0 && active.every(isDemoRecord);
}

export function emptyTransactions(): AppData["transactions"] {
  return [];
}