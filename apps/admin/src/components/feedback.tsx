/* 轻量反馈：Toast + 确认对话框（不引第三方库）
   confirm() 返回 { ok, reason }：取消时 ok=false；需要填写原因时 reason 为输入值 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ToastState {
  id: number;
  text: string;
  kind: "ok" | "error";
}

export interface ConfirmResult {
  ok: boolean;
  reason: string;
}

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** 需要填写原因时给出提示文字 */
  reason?: { label: string; placeholder?: string; required?: boolean };
}

interface FeedbackApi {
  toast: (text: string) => void;
  fail: (text: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<ConfirmResult>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [pending, setPending] = useState<{
    opts: ConfirmOpts;
    resolve: (v: ConfirmResult) => void;
  } | null>(null);
  const [reason, setReason] = useState("");

  const push = useCallback((text: string, kind: "ok" | "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({
      toast: (t) => push(t, "ok"),
      fail: (t) => push(t, "error"),
      confirm: (opts) =>
        new Promise<ConfirmResult>((resolve) => {
          setReason("");
          setPending({ opts, resolve });
        }),
    }),
    [push],
  );

  const close = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      pending.resolve({ ok, reason: ok ? reason.trim() : "" });
      setPending(null);
    },
    [pending, reason],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const needReason = pending?.opts.reason;
  const reasonInvalid = Boolean(needReason?.required && reason.trim().length === 0);

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          style={t.kind === "error" ? { background: "var(--danger)", color: "#fff" } : undefined}
        >
          {t.text}
        </div>
      ))}

      {pending && (
        <div className="confirm-mask" onClick={() => close(false)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">{pending.opts.title}</div>
            {pending.opts.body && <div className="confirm-body">{pending.opts.body}</div>}

            {needReason && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: "var(--t3)", marginBottom: 6 }}>
                  {needReason.label}
                  {needReason.required ? "（必填）" : "（选填）"}
                </div>
                <textarea
                  className="input"
                  value={reason}
                  placeholder={needReason.placeholder}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}

            <div className="confirm-actions">
              <button className="btn" onClick={() => close(false)}>
                取消
              </button>
              <button
                className={`btn ${pending.opts.danger ? "danger" : "primary"}`}
                disabled={reasonInvalid}
                onClick={() => close(true)}
              >
                {pending.opts.confirmText ?? "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}
