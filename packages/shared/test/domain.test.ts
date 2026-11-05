/* 共享领域层单元测试：node --test（Node 22 原生类型剥离，无需额外工具链） */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemoTransactions,
  buildInitialData,
  formatAmount,
  formatMoney,
  isLegacyDemoLedger,
  isSameTransaction,
  mapImportedTransactions,
  mergeTransactions,
  parseCSV,
  parseCents,
  pushDigit,
  resolveLWW,
  transactionsToCSV,
  type Transaction,
} from "../src/index.ts";
import { AppDataSchema, TransactionSchema } from "../src/schemas.ts";

const now = 1_800_000_000_000;
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  type: "expense",
  amount: 1000,
  currency: "CNY",
  categoryId: null,
  parentCategoryId: null,
  accountId: "a1",
  toAccountId: null,
  occurredAt: now,
  note: "",
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  source: "manual",
  ...over,
});

test("resolveLWW：新版本胜出", () => {
  assert.equal(resolveLWW(tx({ updatedAt: 200 }), tx({ updatedAt: 100 })), "local");
  assert.equal(resolveLWW(tx({ updatedAt: 100 }), tx({ updatedAt: 200 })), "remote");
});

test("resolveLWW：同分时墓碑优先，避免记录复活", () => {
  const alive = tx({ updatedAt: 100, deletedAt: null });
  const dead = tx({ updatedAt: 100, deletedAt: 150 });
  assert.equal(resolveLWW(alive, dead), "remote");
  assert.equal(resolveLWW(dead, alive), "local");
  assert.equal(resolveLWW(alive, alive), "same");
});

test("mergeTransactions：只让更新的远端版本覆盖本地", () => {
  const local = [tx({ id: "a", amount: 100, updatedAt: 10 }), tx({ id: "b", amount: 200, updatedAt: 99 })];
  const remote = [
    tx({ id: "a", amount: 999, updatedAt: 20 }), // 更新 → 覆盖
    tx({ id: "b", amount: 111, updatedAt: 5 }), // 更旧 → 保留本地
    tx({ id: "c", amount: 300, updatedAt: 30 }), // 新增
  ];
  const merged = mergeTransactions(local, remote);
  const byId = new Map(merged.map((t) => [t.id, t]));
  assert.equal(merged.length, 3);
  assert.equal(byId.get("a")!.amount, 999);
  assert.equal(byId.get("b")!.amount, 200);
  assert.equal(byId.get("c")!.amount, 300);
});

test("mergeTransactions：删除会随远端墓碑生效", () => {
  const local = [tx({ id: "a", updatedAt: 10, deletedAt: null })];
  const remote = [tx({ id: "a", updatedAt: 20, deletedAt: 25 })];
  const merged = mergeTransactions(local, remote);
  assert.equal(merged[0].deletedAt, 25);
});

test("isSameTransaction：忽略无关字段差异", () => {
  assert.equal(isSameTransaction(tx(), tx()), true);
  assert.equal(isSameTransaction(tx(), tx({ amount: 1 })), false);
  assert.equal(isSameTransaction(tx(), tx({ updatedAt: 5 })), false);
});

test("金额：分为整数，展示两位小数", () => {
  assert.equal(formatAmount(1200), "12.00");
  assert.equal(formatAmount(5), "0.05");
  assert.equal(formatAmount(0), "0.00");
  assert.equal(formatMoney(12800), "¥128.00");
  assert.equal(parseCents("12.34"), 1234);
  assert.equal(parseCents("0.05"), 5);
});

test("金额键盘：整数最多 9 位，小数最多 2 位", () => {
  let v = "";
  let overflowError: string | undefined;
  for (let i = 0; i < 12; i++) {
    const r = pushDigit(v, "9");
    v = r.next;
    if (r.error) overflowError = r.error;
  }
  assert.equal(v.length, 9, `实际得到 ${v}`);
  assert.ok(overflowError, "超出 9 位整数应给出错误提示");

  let d = "";
  d = pushDigit(d, "1").next;
  d = pushDigit(d, ".").next;
  d = pushDigit(d, "2").next;
  d = pushDigit(d, "3").next;
  // 第三位小数被静默忽略（键盘上多按不会报错）
  assert.equal(pushDigit(d, "4").next, "1.23");
  // 不允许出现第二个小数点
  assert.equal(pushDigit(d, ".").next, "1.23");
  assert.equal(pushDigit("", ".").next, "0.");
});

test("CSV：导出后能被自己解析回来（往返一致）", () => {
  const data = buildInitialData();
  const acc = data.accounts[0];
  const cat = data.categories.find((c) => c.kind === "expense" && !c.parentId)!;
  const rows = [
    tx({ id: "x1", amount: 1234, accountId: acc.id, parentCategoryId: cat.id, categoryId: cat.id, note: "早餐" }),
    tx({ id: "x2", amount: 5600, type: "income", accountId: acc.id, parentCategoryId: cat.id, categoryId: null, note: "含,逗号" }),
  ];
  const csv = transactionsToCSV({ ...data, transactions: rows });
  const parsed = parseCSV(csv);
  const ok = parsed.rows.filter((r) => r.ok);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].data!.amount, 1234);
  assert.equal(ok[1].data!.amount, 5600);
  assert.equal(ok[0].data!.accountName, acc.name);
  assert.equal(parsed.rows[1].data!.note, "含,逗号"); // 引号转义后仍能还原
});

test("CSV：错误行给出可读原因而不中断整批", () => {
  const csv = "日期,金额,账户\n2026-11-01,12.00,现金\n错误日期,30.00,现金\n2026-11-02,abc,现金\n2026-11-03,15.00,现金";
  const parsed = parseCSV(csv);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.rows.filter((r) => r.ok).length, 2);
  assert.match(parsed.rows[1].error!, /日期格式错误/);
  assert.match(parsed.rows[2].error!, /金额格式错误/);
});

test("CSV：导入时按 同日期+同金额+同备注 判重", () => {
  const data = buildInitialData();
  const acc = data.accounts[0];
  const existing = tx({ id: "e1", amount: 1234, accountId: acc.id, occurredAt: now, note: "重复" });
  const csv = "日期,时间,类型,一级分类,金额,账户,备注\n2026-11-03,12:00,支出,餐饮,12.34,现金,重复\n2026-11-03,13:00,支出,餐饮,50.00,现金,新记录";
  const parsed = parseCSV(csv);
  // 把已有记录的日期对齐到 CSV 的日期，构造真正的重复
  const sameDay = new Date(2026, 10, 3, 12, 0).getTime();
  const res = mapImportedTransactions({ ...data, accounts: [acc], transactions: [{ ...existing, occurredAt: sameDay }] }, parsed.rows);
  assert.equal(res.duplicates, 1);
  assert.equal(res.toInsert.length, 2);
});

test("Zod：拒绝非法流水，放行合法流水", () => {
  assert.equal(TransactionSchema.safeParse(tx()).success, true);
  assert.equal(TransactionSchema.safeParse(tx({ type: "nope" as never })).success, false);
  assert.equal(TransactionSchema.safeParse(tx({ amount: 12.5 })).success, false); // 必须整数分
  assert.equal(TransactionSchema.safeParse({ ...tx(), id: "" }).success, false);
});

test("Zod：AppData 结构校验通过", () => {
  assert.equal(AppDataSchema.safeParse(buildInitialData()).success, true);
});

test("旧版示例账本识别：整本示例数据才会被清理", () => {
  const data = buildInitialData();
  const demo = buildDemoTransactions(data);
  assert.ok(demo.length > 0);
  assert.equal(isLegacyDemoLedger(demo), true);
  // 混入一条用户自己记的账，就不再判定为纯示例账本
  assert.equal(isLegacyDemoLedger([...demo, tx({ id: "mine", amount: 2000, note: "地铁月卡" })]), false);
  assert.equal(isLegacyDemoLedger([]), false);
});