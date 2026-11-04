/* 预算设置（PRD F5） */

import { useMemo } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";
import { MoneyInput } from "../components/MoneyInput";
import { Switch, useToast } from "../components/feedback";
import { budgetStatus, categoryBudgetStatus } from "@daybook/shared";
import { formatMoney } from "@daybook/shared";
import { formatDate } from "@daybook/shared";
import { sortByUsage } from "../lib/select";

export function BudgetScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();

  const status = useMemo(() => budgetStatus(store), [store]);
  const parents = useMemo(
    () => sortByUsage(store.categories.filter((c) => !c.parentId && c.kind === "expense" && !c.isHidden), store.categoryUsage),
    [store.categories, store.categoryUsage],
  );

  return (
    <SubPage title="预算设置" subtitle={`本周期 ${formatDate(status.periodStart)} 起 · 共 ${status.daysLeft} 天剩余`} onBack={nav.pop}>
      {/* 总预算 */}
      <div className="card">
        <div className="field">
          <label>月度总预算</label>
          <div className="row-flex">
            <MoneyInput valueCents={store.budget.totalAmount} onChange={(c) => store.setBudget({ totalAmount: c })} />
          </div>
        </div>
        <div className="divider" />
        <div className="between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>
              周期起始日
            </div>
            <div className="xsmall muted-2">例如每月 5 日发薪日起算</div>
          </div>
          <select
            className="input"
            style={{ width: 88, height: 40 }}
            value={store.budget.startDay}
            onChange={(e) => store.setBudget({ startDay: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} 日
              </option>
            ))}
          </select>
        </div>
        <div className="divider" />
        <div className="between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>
              结余转入下月
            </div>
            <div className="xsmall muted-2">未用完的预算不结转（P1）</div>
          </div>
          <Switch on={store.budget.rollover} onChange={(v) => store.setBudget({ rollover: v })} label="结余转入下月" />
        </div>
      </div>

      {/* 使用情况 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">本周期使用情况</div>
        </div>
        <div className="card tight">
          <div className="between" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ fontWeight: 600 }}>
              已用 {formatMoney(status.used)} / {formatMoney(status.total)}
            </span>
            <span
              className="xsmall"
              style={{ fontWeight: 700, color: status.state === "over" ? "var(--budget-over)" : status.state === "warn" ? "var(--budget-warn)" : "var(--green-600)" }}
            >
              {Math.round(status.ratio * 100)}%
            </span>
          </div>
          <div className={`progress ${status.state === "ok" ? "" : status.state}`}>
            <i style={{ width: `${status.barRatio * 100}%` }} />
          </div>
          <div className="between xsmall muted-2" style={{ marginTop: 10 }}>
            <span>日均可用 {formatMoney(status.dailyAvailable)}</span>
            <span>{status.remaining >= 0 ? `剩余 ${formatMoney(status.remaining)}` : `已超 ${formatMoney(-status.remaining)}`}</span>
          </div>
        </div>
      </div>

      {/* 分类预算 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">分类预算</div>
          <span className="xsmall muted-2">未设置则只受总预算约束</span>
        </div>
        <div className="list">
          {parents.map((p) => {
            const limit = store.budget.categoryLimits[p.id] ?? 0;
            const usage = limit > 0 ? categoryBudgetStatus(store, p.id, limit) : null;
            return (
              <div key={p.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <div className="row-flex" style={{ gap: 10, marginBottom: limit > 0 ? 8 : 0 }}>
                  <span className="ic" style={{ width: 34, height: 34, borderRadius: 11, background: "color-mix(in srgb, " + p.color + " 16%, var(--bg-card))", color: p.color, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
                    <Icon name={p.icon} size={18} />
                  </span>
                  <span style={{ flex: "0 0 64px", fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                  <MoneyInput valueCents={limit} onChange={(c) => store.setCategoryLimit(p.id, c || null)} placeholder="不限额" />
                </div>
                {usage ? (
                  <>
                    <div className={`progress ${usage.state === "ok" ? "" : usage.state}`} style={{ height: 8 }}>
                      <i style={{ width: `${Math.min(1, usage.ratio) * 100}%` }} />
                    </div>
                    <div className="between xsmall muted-2" style={{ marginTop: 6 }}>
                      <span>已用 {formatMoney(usage.used)}</span>
                      <span style={{ color: usage.state === "over" ? "var(--budget-over)" : usage.state === "warn" ? "var(--budget-warn)" : "var(--t3)" }}>
                        {usage.remaining >= 0 ? `剩余 ${formatMoney(usage.remaining)}` : `超支 ${formatMoney(-usage.remaining)}`}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <button
          className="btn btn-main btn-block"
          onClick={() => {
            toast.show({ message: "预算已保存", duration: 2000 });
            nav.pop();
          }}
        >
          完成
        </button>
      </div>
    </SubPage>
  );
}