/* 统计分析：收支总额 / 分类分布 / 日趋势（时间区间可调） */

import { useState } from "react";
import { api } from "../lib/api";
import { dayEndMs, dayStartMs, todayInput, yuan } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { CategoryBars, SplitDonut, TrendBars } from "../components/Charts";

export function StatsScreen() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [to, setTo] = useState(() => todayInput());

  const fromMs = from ? String(dayStartMs(from)) : undefined;
  const toMs = to ? String(dayEndMs(to)) : undefined;

  const totals = useAsync(() => api.statsTotals(fromMs, toMs), [fromMs, toMs]);
  const cats = useAsync(() => api.statsCategories(fromMs, toMs), [fromMs, toMs]);
  const daily = useAsync(() => api.statsDaily(fromMs, toMs), [fromMs, toMs]);

  const t = totals.data?.data;
  const net = t ? t.income.amount - t.expense.amount : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">统计分析</div>
          <div className="page-desc">全站口径的收支汇总与消费结构，只统计未删除的流水</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span style={{ color: "var(--t3)" }}>至</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {totals.error && <div className="error-box">{totals.error}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-k">支出</div>
          <div className="stat-v small">{t ? yuan(t.expense.amount) : "—"}</div>
          <div className="stat-sub">{t ? `${t.expense.count} 笔` : ""}</div>
        </div>
        <div className="stat">
          <div className="stat-k">收入</div>
          <div className="stat-v small">{t ? yuan(t.income.amount) : "—"}</div>
          <div className="stat-sub">{t ? `${t.income.count} 笔` : ""}</div>
        </div>
        <div className="stat">
          <div className="stat-k">净收支</div>
          <div className="stat-v small" style={{ color: net >= 0 ? "var(--income)" : "var(--danger)" }}>
            {t ? yuan(net) : "—"}
          </div>
          <div className="stat-sub">收入 − 支出</div>
        </div>
        <div className="stat">
          <div className="stat-k">转账 / 调整</div>
          <div className="stat-v small">
            {t ? `${t.transfer.count + t.adjustment.count}` : "—"}
          </div>
          <div className="stat-sub">不计入收支</div>
        </div>
      </div>

      <div className="chart-row">
        <div className="card">
          <div className="section-title" style={{ margin: "0 0 6px" }}>
            日趋势（笔数）
          </div>
          {daily.loading ? (
            <div className="loading">加载中…</div>
          ) : (
            <TrendBars data={(daily.data?.data ?? []).map((d) => ({ day: d.day, count: d.count }))} />
          )}
        </div>
        <div className="card">
          <div className="section-title" style={{ margin: "0 0 14px" }}>
            收支构成
          </div>
          {t ? <SplitDonut expense={t.expense.amount} income={t.income.amount} /> : <div className="empty">暂无数据</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ margin: "0 0 14px" }}>
          支出分类 Top（{cats.data?.data?.length ?? 0}）
        </div>
        {cats.loading ? (
          <div className="loading">加载中…</div>
        ) : (
          <CategoryBars data={cats.data?.data ?? []} />
        )}
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th style={{ textAlign: "right" }}>支出</th>
              <th style={{ textAlign: "right" }}>收入</th>
              <th style={{ textAlign: "right" }}>笔数</th>
            </tr>
          </thead>
          <tbody>
            {(daily.data?.data ?? [])
              .slice()
              .reverse()
              .slice(0, 31)
              .map((d) => (
                <tr key={d.day}>
                  <td className="num">{d.day}</td>
                  <td className="num" style={{ textAlign: "right" }}>{yuan(d.expense)}</td>
                  <td className="num" style={{ textAlign: "right", color: "var(--income)" }}>{yuan(d.income)}</td>
                  <td className="num" style={{ textAlign: "right", color: "var(--t3)" }}>{d.count}</td>
                </tr>
              ))}
            {(daily.data?.data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  该区间没有流水
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
