/* 记一笔 全局入口：任意页面可唤起抽屉，保存后统一出 Toast + 撤销（PRD F1.5） */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { RecordSheet } from "./components/RecordSheet";
import { useToast } from "./components/feedback";
import { useStore } from "./store/store";
import { formatMoney } from "@daybook/shared";
import type { Transaction, TxType } from "@daybook/shared";

interface OpenOpts {
  editing?: Transaction | null;
  type?: TxType;
  /** 预选分类（快捷记账用） */
  categoryId?: string;
}

interface RecordApi {
  open: (opts?: OpenOpts) => void;
}

const RecordContext = createContext<RecordApi | null>(null);

export function RecordProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; editing: Transaction | null; type?: TxType; categoryId?: string }>({
    open: false,
    editing: null,
  });
  const store = useStore();
  const toast = useToast();

  const open = useCallback(
    (opts: OpenOpts = {}) => setState({ open: true, editing: opts.editing ?? null, type: opts.type, categoryId: opts.categoryId }),
    [],
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  const onSaved = useCallback(
    (tx: Transaction, isEdit: boolean) => {
      close();
      const cat = store.categories.find((c) => c.id === (tx.categoryId ?? tx.parentCategoryId));
      const acc = store.accounts.find((a) => a.id === tx.accountId);
      const label =
        tx.type === "transfer"
          ? `已转账 ${formatMoney(tx.amount)}`
          : `${tx.type === "income" ? "已记收入" : "已记"} ${formatMoney(tx.amount)} · ${cat?.name ?? ""}`;
      if (isEdit) {
        toast.show({ message: `已更新 ${formatMoney(tx.amount)}`, tone: "ok", duration: 2500 });
        return;
      }
      toast.undo(`${label}`, () => {
        store.purgeTransaction(tx.id);
      });
      void acc;
    },
    [close, store, toast],
  );

  return (
    <RecordContext.Provider value={{ open }}>
      {children}
      <RecordSheet
        open={state.open}
        editing={state.editing}
        initialType={state.type}
        presetCategoryId={state.categoryId}
        onClose={close}
        onSaved={onSaved}
      />
    </RecordContext.Provider>
  );
}

export function useRecord(): RecordApi {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error("useRecord must be used within RecordProvider");
  return ctx;
}