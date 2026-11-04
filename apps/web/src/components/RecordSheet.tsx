/* 记一笔 抽屉（PRD F1：3 秒记一笔） */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { AmountKeypad } from "./AmountKeypad";
import { Sheet } from "./feedback";
import { useStore } from "../store/store";
import type { Transaction, TxType } from "@daybook/shared";
import { TX_TYPE_LABEL } from "@daybook/shared";
import { displayInput, parseCents } from "@daybook/shared";
import { formatDate, relativeDayLabel, formatTime, toLocalInput, fromLocalInput, isToday } from "@daybook/shared";
import { childrenOf, categoryById, sortByUsage } from "../lib/select";
import { Segmented } from "./feedback";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (tx: Transaction, isEdit: boolean) => void;
  editing?: Transaction | null;
  initialType?: TxType;
  presetCategoryId?: string;
}

const EMPTY = "";

export function RecordSheet({ open, onClose, onSaved, editing, initialType, presetCategoryId }: Props) {
  const store = useStore();
  const { categories, accounts, categoryUsage, lastUsedCategoryId, lastUsedAccountId } = store;

  const [type, setType] = useState<TxType>("expense");
  const [value, setValue] = useState(EMPTY);
  const [parentId, setParentId] = useState<string | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<number>(Date.now());
  const [note, setNote] = useState("");
  const [showTime, setShowTime] = useState(false);
  const [error, setError] = useState("");

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.isArchived), [accounts]);

  /* 打开时初始化 */
  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      setType(editing.type);
      setValue((editing.amount / 100).toString());
      setParentId(editing.parentCategoryId);
      setChildId(editing.categoryId === editing.parentCategoryId ? null : editing.categoryId);
      setAccountId(editing.accountId);
      setToAccountId(editing.toAccountId ?? "");
      setOccurredAt(editing.occurredAt);
      setNote(editing.note);
      setShowTime(false);
      return;
    }
    setValue(EMPTY);
    setNote("");
    setOccurredAt(Date.now());
    setShowTime(false);
    setType(initialType ?? "expense");
    // 解析上次使用的分类（快捷记账时优先使用预选分类）
    const src = presetCategoryId ? categoryById(categories, presetCategoryId) : categoryById(categories, lastUsedCategoryId);
    const last = src;
    let p: string | null = null;
    let c: string | null = null;
    if (last && !last.isHidden) {
      if (last.parentId) {
        p = last.parentId;
        c = last.id;
      } else {
        p = last.id;
      }
    }
    if (!p) {
      const fallback = categories.find((x) => !x.parentId && x.kind === "expense" && x.name === "餐饮") ?? categories.find((x) => !x.parentId && x.kind === "expense");
      p = fallback?.id ?? null;
    }
    setParentId(p);
    setChildId(c);
    setAccountId(lastUsedAccountId ?? activeAccounts[0]?.id ?? "");
    setToAccountId(activeAccounts[1]?.id ?? activeAccounts[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, presetCategoryId]);

  const kind = type === "income" ? "income" : "expense";
  const parents = useMemo(
    () => sortByUsage(categories.filter((c) => !c.parentId && c.kind === kind && !c.isHidden), categoryUsage),
    [categories, categoryUsage, kind],
  );
  const children = useMemo(() => (parentId ? childrenOf(categories, parentId) : []), [categories, parentId]);
  const parentCat = categoryById(categories, parentId);
  const noteTemplates = useMemo(
    () => [...(parentCat ? [parentCat] : []), ...children].filter((c) => c.noteTemplate),
    [parentCat, children],
  );

  // 切换收入/支出时，若当前分类种类不符则重置
  useEffect(() => {
    if (!open || editing) return;
    if (type === "transfer") return;
    const cur = categoryById(categories, parentId);
    if (cur && cur.kind !== kind) {
      const fallback = sortByUsage(categories.filter((c) => !c.parentId && c.kind === kind && !c.isHidden), categoryUsage)[0];
      setParentId(fallback?.id ?? null);
      setChildId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, open]);

  const cents = parseCents(value);
  const canSave = cents > 0 && (type === "transfer" ? Boolean(accountId && toAccountId && accountId !== toAccountId) : Boolean(accountId));

  const submit = () => {
    if (!canSave) return;
    if (type === "transfer") {
      const tx = {
        type: "transfer" as TxType,
        amount: cents,
        categoryId: null,
        parentCategoryId: null,
        accountId,
        toAccountId,
        occurredAt,
        note,
      };
      if (editing) {
        store.updateTransaction(editing.id, tx);
        onSaved({ ...editing, ...tx }, true);
      } else {
        const created = store.addTransaction(tx);
        onSaved(created, false);
      }
      return;
    }
    const useChild = childId && children.some((c) => c.id === childId) ? childId : null;
    const categoryId = useChild ?? parentId;
    const payload = {
      type,
      amount: cents,
      categoryId,
      parentCategoryId: parentId,
      accountId,
      toAccountId: null,
      occurredAt,
      note,
    };
    if (editing) {
      store.updateTransaction(editing.id, payload);
      onSaved({ ...editing, ...payload }, true);
    } else {
      const created = store.addTransaction(payload);
      onSaved(created, false);
    }
  };

  const timeLabel = () => {
    const rel = relativeDayLabel(occurredAt);
    const base = rel ?? formatDate(occurredAt);
    return `${base} ${formatTime(occurredAt)}`;
  };

  return (
    <Sheet open={open} onClose={onClose} maxHeight="94%">
      {/* 类型切换 */}
      <div style={{ margin: "2px 0 8px" }}>
        <Segmented
          tint
          value={type}
          onChange={(v) => setType(v)}
          options={[
            { value: "expense" as TxType, label: TX_TYPE_LABEL.expense },
            { value: "income" as TxType, label: TX_TYPE_LABEL.income },
            { value: "transfer" as TxType, label: TX_TYPE_LABEL.transfer },
          ]}
        />
      </div>

      {/* 金额 */}
      <div className={`amount-display ${value ? "" : "empty"}`}>
        <span className="cur">¥</span>
        <span className="val num">{value ? displayInput(value) : "0.00"}</span>
      </div>
      <div className={`amount-sub ${error ? "err" : ""}`}>{error || (type === "transfer" ? "转账不计入收支统计" : "支持 2 位小数")}</div>

      {/* 分类 */}
      {type !== "transfer" ? (
        <div style={{ marginBottom: 6 }}>
          <div className="cat-grid">
            {parents.map((p) => {
              const on = p.id === parentId;
              return (
                <button
                  key={p.id}
                  className={`cat-item ${on ? "on" : ""}`}
                  onClick={() => {
                    setParentId(p.id);
                    const kids = childrenOf(categories, p.id);
                    setChildId(kids.length ? null : p.id);
                  }}
                >
                  <span className="box">
                    <Icon name={p.icon} size={24} />
                  </span>
                  <span className="label">{p.name}</span>
                </button>
              );
            })}
          </div>
          {children.length > 0 ? (
            <div className="chips" style={{ marginTop: 4 }}>
              {children.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${childId === c.id ? "on" : ""}`}
                  onClick={() => setChildId(childId === c.id ? null : c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}
          {noteTemplates.length > 0 ? (
            <div className="chips" style={{ marginTop: 8 }}>
              {noteTemplates.map((c) => (
                <button key={c.id} className="chip" onClick={() => setNote(c.noteTemplate)}>
                  <Icon name="tag" size={13} />
                  {c.noteTemplate}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 账户 */}
      <div style={{ marginTop: 10 }}>
        <div className="xsmall muted-2" style={{ marginBottom: 6 }}>
          {type === "transfer" ? "从账户" : "账户"}
        </div>
        <div className="chips">
          {activeAccounts.map((a) => (
            <button key={a.id} className={`chip ${accountId === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}>
              <Icon name={a.type === "cash" ? "coin" : a.type === "debit" ? "bank" : a.type === "wallet" ? "wallet" : "card"} size={14} />
              {a.name}
            </button>
          ))}
        </div>
        {type === "transfer" ? (
          <>
            <div className="xsmall muted-2" style={{ margin: "10px 0 6px" }}>
              到账户
            </div>
            <div className="chips">
              {activeAccounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <button key={a.id} className={`chip ${toAccountId === a.id ? "on" : ""}`} onClick={() => setToAccountId(a.id)}>
                    <Icon name={a.type === "cash" ? "coin" : a.type === "debit" ? "bank" : a.type === "wallet" ? "wallet" : "card"} size={14} />
                    {a.name}
                  </button>
                ))}
            </div>
          </>
        ) : null}
      </div>

      {/* 时间 + 备注 */}
      <div className="row-flex" style={{ gap: 8, marginTop: 12 }}>
        <button className="chip" onClick={() => setShowTime((v) => !v)} style={{ flex: "0 0 auto" }}>
          <Icon name="clock" size={14} />
          {timeLabel()}
        </button>
        <input
          className="input"
          style={{ height: 40, borderRadius: "var(--r-pill)", flex: 1, minWidth: 0 }}
          placeholder="备注（可选）"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {showTime ? (
        <div style={{ marginTop: 8 }}>
          <input
            className="input"
            type="datetime-local"
            value={toLocalInput(occurredAt)}
            onChange={(e) => setOccurredAt(fromLocalInput(e.target.value))}
          />
          <button className="link-btn" style={{ marginTop: 4 }} onClick={() => setOccurredAt(Date.now())}>
            回到现在{isToday(occurredAt) ? "（当前）" : ""}
          </button>
        </div>
      ) : null}

      {/* 键盘 */}
      <div style={{ marginTop: 8 }}>
        <AmountKeypad
          value={value}
          onChange={(v) => {
            setValue(v);
            if (error) setError("");
          }}
          onSubmit={submit}
          onError={setError}
          submitLabel={editing ? "保存" : "完成"}
          disabled={!canSave}
        />
      </div>
    </Sheet>
  );
}