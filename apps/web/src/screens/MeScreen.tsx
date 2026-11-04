/* 我的（PRD §5.2 L1 我的） */

import { useMemo } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { Dialog, useDialog, useToast, Switch } from "../components/feedback";
import { activeTxs, totalsInRange } from "@daybook/shared";
import { formatMoney } from "@daybook/shared";
import { formatMonthLabel, monthRange } from "@daybook/shared";
import type { ThemeMode } from "@daybook/shared";
import { useRecord } from "../record";
import { useSessionUser } from "../lib/auth-state";

export function MeScreen() {
  const store = useStore();
  const nav = useNav();
  const record = useRecord();
  const toast = useToast();
  const dialog = useDialog();
  const { user: accountUser } = useSessionUser();
  const outboxPending = store.outboxCount;

  const month = useMemo(() => {
    const now = new Date();
    const { start, end } = monthRange(now.getFullYear(), now.getMonth());
    return totalsInRange(store.transactions, start, end);
  }, [store.transactions]);

  const recordingDays = useMemo(() => {
    const set = new Set(activeTxs(store.transactions).map((t) => new Date(t.occurredAt).toDateString()));
    return set.size;
  }, [store.transactions]);

  const rows: { icon: string; title: string; sub?: string; onClick: () => void }[] = [
    { icon: "target", title: "预算设置", sub: store.budget.totalAmount > 0 ? `每月 ${formatMoney(store.budget.totalAmount, { decimals: false })}` : "未设置", onClick: () => nav.push("budget") },
    { icon: "wallet", title: "账户管理", sub: `${store.accounts.length} 个账户`, onClick: () => nav.push("accounts") },
    { icon: "tag", title: "分类管理", sub: `${store.categories.filter((c) => !c.parentId).length} 个一级分类`, onClick: () => nav.push("categories") },
    { icon: "refresh", title: "周期账单", sub: "固定支出自动生成 · 规划中", onClick: () => nav.push("recurring") },
    { icon: "swap", title: "云同步", sub: "可选 · 多设备与云备份", onClick: () => nav.push("sync") },
    { icon: "download", title: "导入导出与备份", sub: "CSV / JSON · 不被平台绑架", onClick: () => nav.push("io") },
  ];

  return (
    <div className="page">
      {/* 概览卡 */}
      <div className="card" style={{ background: "var(--fab-gradient)", color: "#fff", border: "none" }}>
        <div className="between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="xsmall" style={{ opacity: 0.9 }}>
              {formatMonthLabel(Date.now())}结余
            </div>
            <div className="big-amount" style={{ color: "#fff", fontSize: 30 }}>
              {formatMoney(month.net, { decimals: false })}
            </div>
          </div>
          <span className="badge" style={{ background: "rgba(255,255,255,.2)", color: "#fff" }}>
            已记账 {recordingDays} 天
          </span>
        </div>
        <div className="between" style={{ marginTop: 16, fontSize: 13, opacity: 0.95 }}>
          <span>支出 {formatMoney(month.expense, { decimals: false })}</span>
          <span>收入 {formatMoney(month.income, { decimals: false })}</span>
        </div>
      </div>

      {/* 账号（PRD v1.2 §5.3：未登录只多一行引导，不做拦阻） */}
      <div className="section">
        <button
          className="card tight"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer" }}
          onClick={() => nav.push(accountUser ? "account" : "login")}
        >
          <span
            className="ic"
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              flex: "0 0 auto",
              background: accountUser ? "var(--green-50)" : "var(--bg-sunken, rgba(0,0,0,.04))",
              color: accountUser ? "var(--green-700)" : "var(--t3)",
            }}
          >
            <Icon name="user" size={17} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="small" style={{ fontWeight: 600, display: "block" }}>
              {accountUser ? accountUser.displayUsername || accountUser.username : "未登录"}
            </span>
            <span className="xsmall muted-2">
              {accountUser ? `${outboxPending} 条待上传 · 点击查看账号与设备` : "登录以开启多设备同步与换机找回"}
            </span>
          </span>
          <span className="chev">
            <Icon name="chevronRight" size={18} />
          </span>
        </button>
      </div>

      <div className="section">
        <div className="list">
          {rows.map((r) => (
            <button key={r.title} className="setting-row" onClick={r.onClick}>
              <span className="ic">
                <Icon name={r.icon === "target" ? "chart" : r.icon} size={18} />
              </span>
              <span className="tx">
                <b>{r.title}</b>
                {r.sub ? <span>{r.sub}</span> : null}
              </span>
              <span className="chev">
                <Icon name="chevronRight" size={18} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 外观 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">外观</div>
        </div>
        <div className="card">
          <div className="between">
            <span className="small" style={{ fontWeight: 600 }}>
              主题
            </span>
            <div className="pill-tabs">
              {(
                [
                  ["light", "仅浅色"],
                  ["system", "跟随系统"],
                  ["dark", "仅深色"],
                ] as [ThemeMode, string][]
              ).map(([v, label]) => (
                <button key={v} className={store.settings.theme === v ? "on" : ""} onClick={() => store.setTheme(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="divider" />
          <div className="between">
            <div>
              <div className="small" style={{ fontWeight: 600 }}>
                使用统计
              </div>
              <div className="xsmall muted-2">仅本地匿名，可随时关闭</div>
            </div>
            <Switch on={store.settings.usageStats} onChange={(v) => store.setSetting("usageStats", v)} label="使用统计" />
          </div>
        </div>
      </div>

      {/* 数据 */}
      <div className="section">
        <div className="section-head">
          <div className="section-title">数据</div>
        </div>
        <div className="list">
          <button className="setting-row" onClick={() => nav.push("io")}>
            <span className="ic">
              <Icon name="upload" size={18} />
            </span>
            <span className="tx">
              <b>导入 / 导出</b>
              <span>CSV 导入、CSV/JSON 导出</span>
            </span>
            <span className="chev">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
          <button
            className="setting-row"
            onClick={() =>
              dialog.confirm({
                title: "载入示例数据？",
                description: "将在当前账本上追加一份按今天生成的示例记录，便于查看报表效果。",
                confirmLabel: "载入",
                onConfirm: () => {
                  store.loadDemoData();
                  toast.show({ message: "示例数据已载入", duration: 2500 });
                },
              })
            }
          >
            <span className="ic">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="tx">
              <b>载入示例数据</b>
              <span>一键生成演示用的本月账单</span>
            </span>
            <span className="chev">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
          <button
            className="setting-row"
            onClick={() =>
              dialog.confirm({
                title: "清空所有记录？",
                description: "只删除流水，保留分类、账户与预算设置。此操作不可撤销。",
                confirmLabel: "清空",
                tone: "danger",
                onConfirm: () => {
                  store.clearTransactions();
                  toast.show({ message: "已清空流水", tone: "info", duration: 2500 });
                },
              })
            }
          >
            <span className="ic" style={{ background: "var(--budget-over-bg)", color: "var(--budget-over)" }}>
              <Icon name="trash" size={18} />
            </span>
            <span className="tx">
              <b>清空所有记录</b>
              <span>保留分类与账户设置</span>
            </span>
            <span className="chev">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
          <button
            className="setting-row"
            onClick={() =>
              dialog.confirm({
                title: "恢复出厂设置？",
                description: "将删除全部数据并重建默认分类、账户与预算。",
                confirmLabel: "重置",
                tone: "danger",
                onConfirm: () => {
                  store.resetAll();
                  toast.show({ message: "已恢复默认设置", tone: "info", duration: 2500 });
                },
              })
            }
          >
            <span className="ic" style={{ background: "var(--budget-over-bg)", color: "var(--budget-over)" }}>
              <Icon name="refresh" size={18} />
            </span>
            <span className="tx">
              <b>恢复出厂设置</b>
              <span>删除全部数据并重建默认项</span>
            </span>
            <span className="chev">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
        </div>
      </div>

      <div className="section center">
        <button className="btn btn-main btn-block" onClick={() => record.open()}>
          <Icon name="plus" size={18} strokeWidth={2.5} />
          记一笔
        </button>
        <div className="xsmall muted-2" style={{ marginTop: 16, lineHeight: 1.7 }}>
          日账 DayBook · v1.0 MVP
          <br />
          数据默认只存在本地，不上传、不接入广告 SDK
        </div>
      </div>

      <Dialog state={dialog.state} onClose={dialog.close} />
    </div>
  );
}