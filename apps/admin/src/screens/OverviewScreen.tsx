/* 概览：核心指标 + 7 日流水趋势 + 收支构成 */

import { api } from "../lib/api";
import { yuan, dt, rel } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { SplitDonut, TrendBars } from "../components/Charts";
import { navigate } from "../lib/router";

export function OverviewScreen() {
  const { data, loading, error } = useAsync(() => api.overview(), []);
  const totals = useAsync(() => api.statsTotals(), []);

  if (loading) return <div className="loading">加载中…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const o = data.data;
  const t = totals.data?.data;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">概览</div>
          <div className="page-desc">全站用户、流水与同步状态一屏掌握</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-k">注册用户</div>
          <div className="stat-v">{o.users}</div>
          <div className="stat-sub">
            管理员 {o.admins} · 已封禁 {o.banned}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">流水总数</div>
          <div className="stat-v">{o.transactions}</div>
          <div className="stat-sub">有效 {o.liveTransactions} 笔</div>
        </div>
        <div className="stat">
          <div className="stat-k">今日新增流水</div>
          <div className="stat-v">{o.todayTransactions}</div>
          <div className="stat-sub">按发生时间统计</div>
        </div>
        <div className="stat">
          <div className="stat-k">7 日内活跃会话</div>
          <div className="stat-v">{o.activeSessions7d}</div>
          <div className="stat-sub">同步设备 {o.devices} 台</div>
        </div>
        <div className="stat">
          <div className="stat-k">全站支出</div>
          <div className="stat-v small">{t ? yuan(t.expense.amount) : "—"}</div>
          <div className="stat-sub">{t ? `${t.expense.count} 笔` : ""}</div>
        </div>
        <div className="stat">
          <div className="stat-k">全站收入</div>
          <div className="stat-v small">{t ? yuan(t.income.amount) : "—"}</div>
          <div className="stat-sub">{t ? `${t.income.count} 笔` : ""}</div>
        </div>
      </div>

      <div className="chart-row">
        <div className="card">
          <div className="section-title" style={{ margin: "0 0 6px" }}>
            近 7 日流水笔数
          </div>
          <TrendBars data={o.trend} />
        </div>
        <div className="card">
          <div className="section-title" style={{ margin: "0 0 14px" }}>
            收支构成（全时段）
          </div>
          {t ? <SplitDonut expense={t.expense.amount} income={t.income.amount} /> : <div className="empty">暂无数据</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ margin: "0 0 10px" }}>
          快捷入口
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => navigate("users")}>
            用户管理
          </button>
          <button className="btn" onClick={() => navigate("transactions")}>
            流水审计
          </button>
          <button className="btn" onClick={() => navigate("stats")}>
            统计分析
          </button>
          <button className="btn" onClick={() => navigate("audit")}>
            操作日志
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--t3)" }}>
          数据统计截至 {dt(Date.now())} · 相对时间示例 {rel(Date.now() - 3600_000)}
        </div>
      </div>
    </>
  );
}
