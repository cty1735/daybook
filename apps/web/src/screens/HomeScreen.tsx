/* 首页 · 今日概览（PRD §5.2 / F1 / F5） */

import { useMemo } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { useRecord } from "../record";
import { budgetStatus, totalsInRange, activeTxs } from "@daybook/shared";
import { formatMoney } from "@daybook/shared";
import { endOfDay, formatDayLabel, monthRange, startOfDay } from "@daybook/shared";
import { sortByUsage } from "../lib/select";
import { TxRow } from "../components/TxRow";
import { EmptyArt } from "../components/EmptyArt";

export function HomeScreen() {
  const store = useStore();
  const nav = useNav();
  const record = useRecord();

  const todayTotal = useMemo(
    () => totalsInRange(store.transactions, startOfDay(Date.now()), endOfDay(Date.now())).expense,
    [store.transactions],
  );

  const budget = useMemo(() => budgetStatus(store), [store]);

  const recent = useMemo(
    () => activeTxs(store.transactions).slice().sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 3),
    [store.transactions],
  );

  const monthTotals = useMemo(() => {
    const now = new Date();
    const { start, end } = monthRange(now.getFullYear(), now.getMonth());
    return totalsInRange(store.transactions, start, end);
  }, [store.transactions]);

  const quickCats = useMemo(
    () =>
      sortByUsage(
        store.categories.filter((c) => !c.parentId && c.kind === "expense" && !c.isHidden),
        store.categoryUsage,
      ).slice(0, 5),
    [store.categories, store.categoryUsage],
  );

  const statusText = () => {
    if (budget.total <= 0) return "还没设置预算，去设置一个吧";
    if (budget.state === "over") return `已超支 ${formatMoney(-budget.remaining)}`;
    if (budget.state === "warn") return `本周期已用 ${Math.round(budget.ratio * 100)}%，剩余 ${budget.daysLeft} 天`;
    return `本周期已用 ${Math.round(budget.ratio * 100)}%，剩余 ${budget.daysLeft} 天 🌱`;
  };

  return (
    <div className="page">
      {/* 今日支出 */}
      <div className="between" style={{ padding: "6px 2px 14px" }}>
        <div>
          <div className="xsmall muted-2">今日支出</div>
          <div className="big-amount" style={{ color: "var(--expense)" }}>
            {formatMoney(todayTotal)}
          </div>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
          <span className="badge">{formatDayLabel(Date.now())}</span>
          <span className="xsmall muted-2 num">
            本月支出 {formatMoney(monthTotals.expense, { decimals: false })}
          </span>
        </div>
      </div>

      {/* 预算进度 */}
      <button className="card tight" style={{ width: "100%", textAlign: "left" }} onClick={() => nav.push("budget")}>
        <div className="between" style={{ marginBottom: 10 }}>
          <span className="small muted" style={{ fontWeight: 600 }}>
            本月预算
          </span>
          <span className="xsmall muted-2 num">
            {budget.total > 0
              ? `剩余 ${formatMoney(Math.max(0, budget.remaining), { decimals: false })} / 日均 ${formatMoney(budget.dailyAvailable, { decimals: false })}`
              : "未设置"}
          </span>
        </div>
        <div className={`progress ${budget.state === "ok" ? "" : budget.state}`}>
          <i style={{ width: `${(budget.total > 0 ? budget.barRatio : 0) * 100}%` }} />
        </div>
        <div
          className="xsmall"
          style={{
            marginTop: 10,
            color:
              budget.state === "over" ? "var(--budget-over)" : budget.state === "warn" ? "var(--budget-warn)" : "var(--t2)",
            fontWeight: 600,
          }}
        >
          {statusText()}
        </div>
      </button>

      {/* 快捷记账 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">快捷记一笔</div>
          <button className="link-btn" onClick={() => record.open()}>
            更多
          </button>
        </div>
        <div className="chips">
          {quickCats.map((c) => (
            <button
              key={c.id}
              className="chip"
              onClick={() => record.open({ categoryId: c.id })}
            >
              <span style={{ color: c.color, display: "grid", placeItems: "center" }}>
                <Icon name={c.icon} size={15} />
              </span>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 最近记录 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">最近记录</div>
          <button className="link-btn" onClick={() => nav.setTab("ledger")}>
            查看全部
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="card">
            <div className="empty" style={{ padding: "24px 12px" }}>
              <EmptyArt size={104} />
              <b>还没有记录</b>
              <span>点右下角记第一笔</span>
            </div>
          </div>
        ) : (
          <div className="list">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} store={store} onTap={() => record.open({ editing: t })} />
            ))}
          </div>
        )}
      </div>

      {/* 本周期小结 */}
      <div className="section">
        <div className="card flush">
          <div className="stat-grid" style={{ gap: 0 }}>
            <div className="stat" style={{ border: "none", borderRadius: 0 }}>
              <span>本月支出</span>
              <b style={{ color: "var(--expense)" }}>{formatMoney(monthTotals.expense, { decimals: false })}</b>
            </div>
            <div className="stat" style={{ border: "none", borderRadius: 0, borderLeft: "1px solid var(--border)" }}>
              <span>本月收入</span>
              <b style={{ color: "var(--income)" }}>{formatMoney(monthTotals.income, { decimals: false })}</b>
            </div>
            <div className="stat" style={{ border: "none", borderRadius: 0, borderLeft: "1px solid var(--border)" }}>
              <span>结余</span>
              <b className="smaller">{formatMoney(monthTotals.net, { decimals: false })}</b>
            </div>
          </div>
        </div>
        <div className="xsmall muted-2 center" style={{ marginTop: 10 }}>
          记账 3 秒一笔 · 数据只存在你的设备上
        </div>
      </div>

      {/* 今日时间线提示 */}
      <div className="section">
        <div className="card tight">
          <div className="row-flex" style={{ gap: 10 }}>
            <span className="ic" style={{ width: 36, height: 36, borderRadius: 12, background: "var(--green-50)", color: "var(--green-700)", display: "grid", placeItems: "center" }}>
              <Icon name="sparkles" size={18} />
            </span>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 14 }}>
                今日已记{" "}
                {activeTxs(store.transactions).filter((t) => t.occurredAt >= startOfDay(Date.now()) && t.occurredAt <= endOfDay(Date.now())).length} 笔
              </b>
              <div className="xsmall muted-2">保持记录，月底才能看懂钱花在哪</div>
            </div>
          </div>
        </div>
      </div>

      <div className="xsmall muted-2 center" style={{ marginTop: 18, opacity: 0.8 }}>
        {activeTxs(store.transactions).length} 条记录 · 本地存储
      </div>
    </div>
  );
}