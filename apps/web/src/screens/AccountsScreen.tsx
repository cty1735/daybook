/* 账户管理（PRD F3） */

import { useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";
import { Sheet, Dialog, useDialog, useToast } from "../components/feedback";
import { MoneyInput } from "../components/MoneyInput";
import { accountBalance, creditUsed } from "@daybook/shared";
import { formatMoney } from "@daybook/shared";
import { ACCOUNT_TYPE_LABEL, type Account, type AccountType } from "@daybook/shared";
import { accountIcon } from "../lib/select";

const TYPES: AccountType[] = ["cash", "debit", "credit", "huabei", "wallet", "other"];

interface Draft {
  id?: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  includeInAssets: boolean;
  creditLimit: number;
}

const emptyDraft = (): Draft => ({ name: "", type: "cash", initialBalance: 0, includeInAssets: true, creditLimit: 0 });

export function AccountsScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const dialog = useDialog();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [adjust, setAdjust] = useState<Account | null>(null);
  const [adjustValue, setAdjustValue] = useState(0);

  const rows = useMemo(
    () =>
      store.accounts.map((a) => {
        const isCredit = a.type === "credit" || a.type === "huabei";
        const balance = accountBalance(a, store.transactions);
        const used = isCredit ? creditUsed(a, store.transactions) : 0;
        return { account: a, isCredit, balance, used };
      }),
    [store.accounts, store.transactions],
  );

  const assetsTotal = rows.filter((r) => r.account.includeInAssets && !r.account.isArchived && !r.isCredit).reduce((s, r) => s + r.balance, 0);
  const liabilityTotal = rows.filter((r) => r.isCredit).reduce((s, r) => s + r.used, 0);

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.show({ message: "请填写账户名称", tone: "err", duration: 2500 });
      return;
    }
    if (draft.id) {
      store.updateAccount(draft.id, {
        name: draft.name.trim(),
        type: draft.type,
        includeInAssets: draft.includeInAssets,
        creditLimit: draft.creditLimit,
      });
      toast.show({ message: "账户已更新", duration: 2000 });
    } else {
      store.addAccount({
        name: draft.name.trim(),
        type: draft.type,
        initialBalance: draft.initialBalance,
        includeInAssets: draft.includeInAssets,
        isArchived: false,
        creditLimit: draft.creditLimit,
      });
      toast.show({ message: "账户已创建", duration: 2000 });
    }
    setDraft(null);
  };

  return (
    <SubPage
      title="账户管理"
      subtitle={`资产 ${formatMoney(assetsTotal, { decimals: false })} · 待还 ${formatMoney(liabilityTotal, { decimals: false })}`}
      onBack={nav.pop}
      action={
        <button className="icon-btn" aria-label="新建账户" onClick={() => setDraft(emptyDraft())}>
          <Icon name="plus" size={20} />
        </button>
      }
    >
      <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <div>
          <div className="xsmall muted-2">总资产（不含信用）</div>
          <div className="big-amount" style={{ fontSize: 26, color: "var(--income)" }}>
            {formatMoney(assetsTotal, { decimals: false })}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="xsmall muted-2">信用卡待还</div>
          <div className="big-amount" style={{ fontSize: 26, color: "var(--transfer)" }}>
            {formatMoney(liabilityTotal, { decimals: false })}
          </div>
        </div>
      </div>

      <div className="list">
        {rows.map(({ account: a, isCredit, balance, used }) => (
          <div key={a.id} className="row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8, padding: "14px 16px" }}>
            <div className="row-flex" style={{ width: "100%" }}>
              <span className="ic" style={{ background: "var(--green-50)", color: "var(--green-700)" }}>
                <Icon name={accountIcon(a)} size={20} />
              </span>
              <div className="tx" style={{ flex: 1 }}>
                <b>
                  {a.name}
                  {a.isArchived ? <span className="xsmall muted-2">（已归档）</span> : null}
                </b>
                <span>{ACCOUNT_TYPE_LABEL[a.type]}{a.includeInAssets ? " · 计入资产" : ""}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="amt num" style={{ color: isCredit ? "var(--transfer)" : balance >= 0 ? "var(--t1)" : "var(--budget-over)" }}>
                  {formatMoney(isCredit ? used : balance)}
                </div>
                {isCredit ? (
                  <div className="xsmall muted-2 num">额度 {formatMoney(a.creditLimit, { decimals: false })}</div>
                ) : null}
              </div>
            </div>
            <div className="row-flex" style={{ gap: 8, width: "100%" }}>
              <button className="btn-round-sm" onClick={() => setDraft({ id: a.id, name: a.name, type: a.type, initialBalance: a.initialBalance, includeInAssets: a.includeInAssets, creditLimit: a.creditLimit })}>
                编辑
              </button>
              {!isCredit ? (
                <button
                  className="btn-round-sm"
                  onClick={() => {
                    setAdjust(a);
                    setAdjustValue(accountBalance(a, store.transactions));
                  }}
                >
                  余额校准
                </button>
              ) : null}
              <button
                className="btn-round-sm"
                style={{ marginLeft: "auto", color: "var(--budget-over)" }}
                onClick={() =>
                  dialog.confirm({
                    title: `删除账户「${a.name}」？`,
                    description: "若该账户下仍有记录，需要先迁移或删除这些记录。",
                    confirmLabel: "删除",
                    tone: "danger",
                    onConfirm: () => {
                      const r = store.removeAccount(a.id);
                      toast.show({ message: r.ok ? "账户已删除" : r.reason ?? "删除失败", tone: r.ok ? "ok" : "err", duration: 3000 });
                    },
                  })
                }
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="xsmall muted-2" style={{ marginTop: 14, lineHeight: 1.7 }}>
        · 信用卡「支出」计入已用额度，还款记为「转账」，不计入支出统计<br />
        · 余额校准会生成一条「余额调整」记录，同样不计入收支
      </div>

      {/* 新建 / 编辑账户 */}
      <Sheet open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? "编辑账户" : "新建账户"}>
        {draft ? (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>账户名称</label>
              <input className="input" value={draft.name} placeholder="如：招行储蓄卡" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>账户类型</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {TYPES.map((t) => (
                  <button key={t} className={`chip ${draft.type === t ? "on" : ""}`} style={{ justifyContent: "center" }} onClick={() => setDraft({ ...draft, type: t })}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            {!draft.id ? (
              <div className="field" style={{ marginBottom: 12 }}>
                <label>初始余额</label>
                <div className="row-flex">
                  <MoneyInput valueCents={draft.initialBalance} onChange={(c) => setDraft({ ...draft, initialBalance: c })} />
                </div>
              </div>
            ) : null}
            {draft.type === "credit" || draft.type === "huabei" ? (
              <div className="field" style={{ marginBottom: 12 }}>
                <label>信用额度</label>
                <div className="row-flex">
                  <MoneyInput valueCents={draft.creditLimit} onChange={(c) => setDraft({ ...draft, creditLimit: c })} />
                </div>
              </div>
            ) : null}
            <div className="between" style={{ marginBottom: 16 }}>
              <div>
                <div className="small" style={{ fontWeight: 600 }}>
                  计入总资产
                </div>
                <div className="xsmall muted-2">关闭后不计入资产合计</div>
              </div>
              <button className={`switch ${draft.includeInAssets ? "on" : ""}`} aria-label="计入总资产" onClick={() => setDraft({ ...draft, includeInAssets: !draft.includeInAssets })} />
            </div>
            <button className="btn btn-main btn-block" onClick={saveDraft}>
              保存
            </button>
          </>
        ) : null}
      </Sheet>

      {/* 余额校准 */}
      <Sheet open={Boolean(adjust)} onClose={() => setAdjust(null)} title="余额校准">
        {adjust ? (
          <>
            <div className="xsmall muted-2" style={{ marginBottom: 10 }}>
              输入「{adjust.name}」的实际余额，系统将生成一条差额调整记录（不计入收支）。
            </div>
            <div className="row-flex" style={{ marginBottom: 12 }}>
              <MoneyInput valueCents={adjustValue} onChange={setAdjustValue} autoFocus />
            </div>
            <div className="between xsmall muted-2" style={{ marginBottom: 16 }}>
              <span>系统余额 {formatMoney(accountBalance(adjust, store.transactions))}</span>
              <span>差额 {formatMoney(adjustValue - accountBalance(adjust, store.transactions))}</span>
            </div>
            <button
              className="btn btn-main btn-block"
              onClick={() => {
                const diff = adjustValue - accountBalance(adjust, store.transactions);
                if (diff === 0) {
                  toast.show({ message: "余额一致，无需调整", tone: "info", duration: 2000 });
                } else {
                  store.adjustBalance(adjust.id, adjustValue);
                  toast.show({ message: `已生成 ${formatMoney(Math.abs(diff))} 的余额调整`, duration: 2500 });
                }
                setAdjust(null);
              }}
            >
              确认校准
            </button>
          </>
        ) : null}
      </Sheet>

      <Dialog state={dialog.state} onClose={dialog.close} />
    </SubPage>
  );
}