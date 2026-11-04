/* 明细 · 按日分组流水（PRD F4） */

import { useDeferredValue, useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useRecord } from "../record";
import { useToast, Sheet, Segmented } from "../components/feedback";
import { TxRow } from "../components/TxRow";
import { EmptyArt } from "../components/EmptyArt";
import { formatMoney } from "@daybook/shared";
import { dayKey, endOfDay, formatDayLabel, isToday, relativeDayLabel, startOfDay } from "@daybook/shared";
import { activeTxs } from "@daybook/shared";
import type { Transaction, TxType } from "@daybook/shared";

type RangeKey = "today" | "week" | "month" | "all";
type TypeKey = "all" | TxType;

function rangeBounds(range: RangeKey): { start: number; end: number } {
  const now = Date.now();
  if (range === "today") return { start: startOfDay(now), end: endOfDay(now) };
  if (range === "week") {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7; // 周一为 0
    return { start: startOfDay(now - dow * 86400000), end: endOfDay(now) };
  }
  if (range === "month") {
    const d = new Date();
    return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: endOfDay(now) };
  }
  return { start: 0, end: Number.MAX_SAFE_INTEGER };
}

export function LedgerScreen() {
  const store = useStore();
  const record = useRecord();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeKey>("month");
  const [type, setType] = useState<TypeKey>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<null | "category" | "account">(null);

  const deferred = useDeferredValue(query);

  const filtered = useMemo(() => {
    const { start, end } = rangeBounds(range);
    const q = deferred.trim().toLowerCase();
    return activeTxs(store.transactions)
      .filter((t) => t.occurredAt >= start && t.occurredAt <= end)
      .filter((t) => (type === "all" ? true : t.type === type))
      .filter((t) => {
        if (!q) return true;
        const cat = store.categories.find((c) => c.id === t.categoryId);
        const parent = store.categories.find((c) => c.id === t.parentCategoryId);
        const acc = store.accounts.find((a) => a.id === t.accountId);
        return [t.note, cat?.name, parent?.name, acc?.name].some((s) => s && s.toLowerCase().includes(q));
      })
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }, [store.transactions, store.categories, store.accounts, deferred, range, type]);

  const groups = useMemo(() => {
    const map = new Map<string, { ts: number; items: Transaction[]; expense: number; income: number }>();
    for (const t of filtered) {
      const k = dayKey(t.occurredAt);
      const g = map.get(k) ?? { ts: startOfDay(t.occurredAt), items: [], expense: 0, income: 0 };
      g.items.push(t);
      if (t.type === "expense") g.expense += t.amount;
      if (t.type === "income") g.income += t.amount;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }, [filtered]);

  const totalShown = filtered.reduce((s, t) => s + (t.type === "expense" ? t.amount : 0), 0);

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const doBatchDelete = () => {
    const ids = [...selected];
    store.updateMany(ids, { deletedAt: Date.now() });
    toast.undo(`已删除 ${ids.length} 笔`, () => {
      ids.forEach((id) => store.restoreTransaction(id));
    });
    exitSelect();
  };

  const batchCategory = (categoryId: string, parentId: string) => {
    const ids = [...selected];
    store.updateMany(ids, { categoryId, parentCategoryId: parentId });
    toast.show({ message: `已将 ${ids.length} 笔改为「${store.categories.find((c) => c.id === categoryId)?.name}」`, duration: 2500 });
    setBatch(null);
    exitSelect();
  };

  const batchAccount = (accountId: string) => {
    const ids = [...selected];
    store.updateMany(ids, { accountId });
    toast.show({ message: `已将 ${ids.length} 笔账户改为「${store.accounts.find((a) => a.id === accountId)?.name}」`, duration: 2500 });
    setBatch(null);
    exitSelect();
  };

  return (
    <div className="page">
      {/* 搜索 */}
      <div className="row-flex" style={{ gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--t3)", display: "grid" }}>
            <Icon name="search" size={17} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 40 }}
            placeholder="搜索备注、分类、账户"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={`icon-btn ${selectMode ? "" : ""}`}
          style={selectMode ? { background: "var(--green-100)", color: "var(--green-700)" } : undefined}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          aria-label="多选"
          title="多选"
        >
          <Icon name="check" size={18} />
        </button>
      </div>

      {/* 筛选 */}
      <div className="scroll-x-pills" style={{ marginBottom: 10 }}>
        {(
          [
            ["today", "今日"],
            ["week", "本周"],
            ["month", "本月"],
            ["all", "全部"],
          ] as [RangeKey, string][]
        ).map(([k, label]) => (
          <button key={k} className={`chip ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>
            {label}
          </button>
        ))}
        <span style={{ width: 4, flex: "0 0 auto" }} />
        {(
          [
            ["all", "全部"],
            ["expense", "支出"],
            ["income", "收入"],
            ["transfer", "转账"],
          ] as [TypeKey, string][]
        ).map(([k, label]) => (
          <button key={k} className={`chip ${type === k ? "on" : ""}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="between" style={{ margin: "4px 2px 12px" }}>
        <span className="xsmall muted-2 num">{filtered.length} 条 · 支出合计 {formatMoney(totalShown)}</span>
        {selectMode ? <span className="xsmall muted-2">已选 {selected.size} 笔</span> : null}
      </div>

      {/* 列表 */}
      {groups.length === 0 ? (
        <div className="card">
          <div className="empty">
            <EmptyArt />
            <b>{query ? "没有匹配的记录" : "还没有记录"}</b>
            <span>{query ? "换个关键词试试" : "点右下角记第一笔"}</span>
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.ts} className="section" style={{ marginTop: 14 }}>
            <div className="between" style={{ margin: "0 2px 8px" }}>
              <span className="small" style={{ fontWeight: 700 }}>
                {relativeDayLabel(g.ts) ?? formatDayLabel(g.ts)}
                {isToday(g.ts) ? "" : ` · ${formatDayLabel(g.ts).split(" ")[1]}`}
                <span className="muted-2" style={{ fontWeight: 500, marginLeft: 8, fontSize: 12 }}>
                  {g.items.length} 笔
                </span>
              </span>
              <span className="xsmall num muted-2">
                {g.expense > 0 ? `支出 ${formatMoney(g.expense)}` : ""}
                {g.expense > 0 && g.income > 0 ? " · " : ""}
                {g.income > 0 ? `收入 ${formatMoney(g.income)}` : ""}
              </span>
            </div>
            <div className="list">
              {g.items.map((t) => (
                <TxRow
                  key={t.id}
                  tx={t}
                  store={store}
                  selectable={selectMode}
                  selected={selected.has(t.id)}
                  onTap={(tx) => (selectMode ? toggleSel(tx.id) : record.open({ editing: tx }))}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* 多选操作条 */}
      {selectMode ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: "calc(76px + env(safe-area-inset-bottom))",
            zIndex: 45,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 20,
            boxShadow: "var(--shadow-lg)",
            padding: 10,
            display: "flex",
            gap: 8,
          }}
        >
          <button className="btn-sub btn" style={{ flex: 1, height: 44 }} disabled={selected.size === 0} onClick={() => setBatch("category")}>
            改分类
          </button>
          <button className="btn-sub btn" style={{ flex: 1, height: 44 }} disabled={selected.size === 0} onClick={() => setBatch("account")}>
            改账户
          </button>
          <button className="btn btn-danger" style={{ flex: 1, height: 44 }} disabled={selected.size === 0} onClick={doBatchDelete}>
            删除
          </button>
        </div>
      ) : null}

      {/* 批量改分类 */}
      <Sheet open={batch === "category"} onClose={() => setBatch(null)} title="选择分类">
        <Segmented
          value="expense"
          onChange={() => {}}
          options={[
            { value: "expense", label: "支出" },
            { value: "income", label: "收入" },
          ]}
        />
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {store.categories
            .filter((c) => !c.parentId)
            .map((p) => (
              <button key={p.id} className="cat-item" style={{ width: "auto" }} onClick={() => batchCategory(p.id, p.id)}>
                <span className="box">
                  <Icon name={p.icon} size={22} />
                </span>
                <span className="label" style={{ maxWidth: 70 }}>
                  {p.name}
                </span>
              </button>
            ))}
        </div>
      </Sheet>

      {/* 批量改账户 */}
      <Sheet open={batch === "account"} onClose={() => setBatch(null)} title="选择账户">
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {store.accounts.map((a) => (
            <button key={a.id} className="chip" onClick={() => batchAccount(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}