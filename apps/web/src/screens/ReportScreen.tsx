/* 报表与洞察（PRD F6） */

import { useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { Donut, DayBars, MonthLine, HBars } from "../components/Charts";
import { EmptyArt } from "../components/EmptyArt";
import { formatMoney } from "@daybook/shared";
import { formatMonthLabel } from "@daybook/shared";
import {
  accountBreakdown,
  categoryBreakdown,
  dailySeries,
  generateInsights,
  monthlySeries,
  totalsInRange,
} from "@daybook/shared";

type Mode = "month" | "year";

export function ReportScreen() {
  const store = useStore();
  const [mode, setMode] = useState<Mode>("month");
  const [offset, setOffset] = useState(0); // 0 = 当前

  const cursor = useMemo(() => {
    const now = new Date();
    if (mode === "month") return new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return new Date(now.getFullYear() + offset, 0, 1);
  }, [mode, offset]);

  const range = useMemo(() => {
    if (mode === "month") {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const start = new Date(y, m, 1).getTime();
      const end = new Date(y, m + 1, 1).getTime() - 1;
      const prevStart = new Date(y, m - 1, 1).getTime();
      const prevEnd = start - 1;
      return { start, end, prevStart, prevEnd };
    }
    const y = cursor.getFullYear();
    return {
      start: new Date(y, 0, 1).getTime(),
      end: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
      prevStart: new Date(y - 1, 0, 1).getTime(),
      prevEnd: new Date(y - 1, 11, 31, 23, 59, 59, 999).getTime(),
    };
  }, [mode, cursor]);

  const cur = useMemo(() => totalsInRange(store.transactions, range.start, range.end), [store.transactions, range]);
  const prev = useMemo(() => totalsInRange(store.transactions, range.prevStart, range.prevEnd), [store.transactions, range]);

  const breakdown = useMemo(
    () => categoryBreakdown(store, range.start, range.end, range.prevStart, range.prevEnd),
    [store, range],
  );

  const hasData = cur.expense > 0 || cur.income > 0;

  const donutSlices = useMemo(() => {
    const top = breakdown.slice(0, 6);
    const rest = breakdown.slice(6);
    const slices = top.map((s) => ({ key: s.category.id, label: s.category.name, color: s.category.color, amount: s.amount }));
    if (rest.length) {
      slices.push({
        key: "other",
        label: "其他",
        color: "var(--cat-12)",
        amount: rest.reduce((s, x) => s + x.amount, 0),
      });
    }
    return slices.filter((s) => s.amount > 0);
  }, [breakdown]);

  const trend = useMemo(
    () => (mode === "month" ? dailySeries(store.transactions, cursor.getFullYear(), cursor.getMonth()) : null),
    [store.transactions, mode, cursor],
  );
  const yearly = useMemo(
    () => (mode === "year" ? monthlySeries(store.transactions, cursor.getFullYear()) : null),
    [store.transactions, mode, cursor],
  );

  const accounts = useMemo(() => accountBreakdown(store, range.start, range.end), [store, range]);

  const insights = useMemo(
    () => (mode === "month" && offset === 0 ? generateInsights(store) : []),
    [store, mode, offset],
  );

  const sliceDeltaPct = (id: string) => breakdown.find((b) => b.category.id === id)?.deltaPct ?? null;
  const netDelta = prev.net !== 0 ? ((cur.net - prev.net) / Math.abs(prev.net)) * 100 : null;

  const label = mode === "month" ? formatMonthLabel(cursor.getTime()) : `${cursor.getFullYear()}年`;

  return (
    <div className="page">
      {/* 周期切换 */}
      <div className="between" style={{ marginBottom: 14 }}>
        <div className="pill-tabs">
          <button className={mode === "month" ? "on" : ""} onClick={() => { setMode("month"); setOffset(0); }}>
            月
          </button>
          <button className={mode === "year" ? "on" : ""} onClick={() => { setMode("year"); setOffset(0); }}>
            年
          </button>
        </div>
        <div className="arrow-nav">
          <button className="icon-btn" aria-label="上一个周期" onClick={() => setOffset((o) => o - 1)}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <span className="cur">{label}</span>
          <button
            className="icon-btn"
            aria-label="下一个周期"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset >= 0}
            style={offset >= 0 ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
          >
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="card">
          <div className="empty">
            <EmptyArt />
            <b>这个{formatMonthLabel(cursor.getTime()).slice(-2)}还没有记录</b>
            <span>记几笔之后，这里会告诉你钱花在哪</span>
          </div>
        </div>
      ) : (
        <>
          {/* 三个核心数字 */}
          <div className="stat-grid">
            <div className="stat">
              <span>总支出</span>
              <b style={{ color: "var(--expense)" }}>{formatMoney(cur.expense, { decimals: false })}</b>
            </div>
            <div className="stat">
              <span>总收入</span>
              <b style={{ color: "var(--income)" }}>{formatMoney(cur.income, { decimals: false })}</b>
            </div>
            <div className="stat">
              <span>结余</span>
              <b className="smaller" style={{ color: cur.net >= 0 ? "var(--income)" : "var(--budget-over)" }}>
                {formatMoney(cur.net, { decimals: false })}
                {netDelta !== null ? (
                  <span className={`delta ${netDelta >= 0 ? "down" : "up"}`} style={{ marginLeft: 4 }}>
                    {netDelta >= 0 ? "↑" : "↓"}
                  </span>
                ) : null}
              </b>
            </div>
          </div>

          {/* 洞察卡片 */}
          {insights.length > 0 ? (
            <div className="section">
              <div className="section-head">
                <div className="section-title">本周期洞察</div>
                <span className="xsmall muted-2">自动生成 · 人话结论</span>
              </div>
              {insights.map((i) => (
                <div key={i.id} className={`insight ${i.tone === "ok" ? "" : i.tone}`}>
                  <span className="emo">{i.emoji}</span>
                  <div className="txt">
                    <span>{i.text}</span>
                    {i.detail ? <div className="xsmall muted-2" style={{ marginTop: 4 }}>{i.detail}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* 分类占比 */}
          <div className="section">
            <div className="section-head">
              <div className="section-title">分类占比</div>
              <span className="xsmall muted-2">与上期对比</span>
            </div>
            <div className="card">
              <div className="donut-wrap">
                <Donut slices={donutSlices} total={cur.expense} centerLabel="支出" />
                <div className="legend">
                  {donutSlices.map((s) => {
                    const d = sliceDeltaPct(s.key);
                    return (
                      <div className="legend-item" key={s.key}>
                        <span className="swatch" style={{ background: s.color }} />
                        <span className="name">{s.label}</span>
                        {d !== null ? (
                          <span className={`delta ${d >= 0 ? "up" : "down"}`} title="环比">
                            {d >= 0 ? "↑" : "↓"}
                            {Math.abs(Math.round(d))}%
                          </span>
                        ) : null}
                        <span className="val num">{formatMoney(s.amount, { decimals: false })}</span>
                        <span className="pct num">{Math.round((s.amount / Math.max(1, cur.expense)) * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 趋势 */}
          <div className="section">
            <div className="section-head">
              <div className="section-title">支出趋势</div>
              <span className="xsmall muted-2">{mode === "month" ? "按日" : "按月"}</span>
            </div>
            <div className="card tight">
              {trend ? <DayBars data={trend} /> : yearly ? <MonthLine data={yearly} /> : null}
            </div>
          </div>

          {/* 账户分布 */}
          {accounts.length > 0 ? (
            <div className="section">
              <div className="section-head">
                <div className="section-title">账户支出分布</div>
              </div>
              <div className="card tight">
                <HBars
                  items={accounts.map((a) => ({
                    key: a.account.id,
                    label: a.account.name,
                    color: a.account.type === "credit" || a.account.type === "huabei" ? "var(--cat-10)" : "var(--green-400)",
                    amount: a.amount,
                  }))}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}