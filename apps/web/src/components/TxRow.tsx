/* 流水行（PRD §10.8：高 64，左图标 + 中间双行文字 + 右金额） */

import { Icon } from "../icons/Icon";
import { formatMoney } from "@daybook/shared";
import { formatTime } from "@daybook/shared";
import { categoryById, txSign } from "../lib/select";
import type { Transaction } from "@daybook/shared";
import type { Store } from "../store/store";

interface Props {
  tx: Transaction;
  store: Store;
  onTap?: (tx: Transaction) => void;
  selectable?: boolean;
  selected?: boolean;
}

export function TxRow({ tx, store, onTap, selectable, selected }: Props) {
  const cat = categoryById(store.categories, tx.categoryId);
  const parent = categoryById(store.categories, tx.parentCategoryId) ?? cat;
  const account = store.accounts.find((a) => a.id === tx.accountId);
  const toAccount = store.accounts.find((a) => a.id === tx.toAccountId);

  const iconColor = parent?.color ?? "var(--green-500)";
  const title =
    tx.type === "transfer"
      ? "转账"
      : tx.type === "adjustment"
        ? "余额调整"
        : cat && cat.id !== parent?.id
          ? cat.name
          : parent?.name ?? "未分类";

  const subParts = [parent && cat && cat.id !== parent.id ? parent.name : null, account?.name ?? "", formatTime(tx.occurredAt)].filter(Boolean);
  const sub = subParts.join(" · ") + (tx.note ? ` · ${tx.note}` : "");

  const amountClass = tx.type === "income" ? "income" : tx.type === "transfer" || tx.type === "adjustment" ? "transfer" : "expense";
  const sign = txSign(tx.type);
  const transferText = tx.type === "transfer" && toAccount ? `${account?.name} → ${toAccount.name}` : null;

  return (
    <button
      className="row"
      onClick={() => onTap?.(tx)}
      style={selected ? { background: "var(--green-50)" } : undefined}
    >
      {selectable ? (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: `2px solid ${selected ? "var(--green-500)" : "var(--border-strong)"}`,
            background: selected ? "var(--green-500)" : "transparent",
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            color: "#fff",
          }}
        >
          {selected ? <Icon name="check" size={14} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <span className="ic" style={{ background: "color-mix(in srgb, " + iconColor + " 16%, var(--bg-card))", color: iconColor }}>
        <Icon name={tx.type === "transfer" ? "swap" : tx.type === "adjustment" ? "wrench" : parent?.icon ?? "tag"} size={20} />
      </span>
      <span className="tx">
        <b>{title}</b>
        <span>{transferText ?? sub}</span>
      </span>
      <span className={`amt num ${amountClass}`}>
        <span className="sign">{sign}</span>
        {formatMoney(tx.amount)}
      </span>
    </button>
  );
}