/* 反馈类组件：Toast / 确认对话框 / 开关 / 分段控件 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../icons/Icon";

/* ------------------------------- Toast ------------------------------- */
type Tone = "ok" | "err" | "info";

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: Tone;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastApi {
  show: (t: { message: ReactNode; tone?: Tone; action?: { label: string; onClick: () => void }; duration?: number }) => number;
  dismiss: (id: number) => void;
  undo: (message: ReactNode, onUndo: () => void) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((s) => s.filter((i) => i.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ message, tone = "ok", action, duration = 5000 }) => {
      const id = ++seq.current;
      setItems((s) => [...s, { id, message, tone, action, duration }]);
      const t = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, t);
      return id;
    },
    [dismiss],
  );

  const undo = useCallback(
    (message: ReactNode, onUndo: () => void) => {
      const id = show({
        message,
        tone: "ok",
        duration: 5000,
        action: {
          label: "撤销",
          onClick: () => {
            onUndo();
            dismiss(id);
          },
        },
      });
    },
    [show, dismiss],
  );

  const api = { show, dismiss, undo };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.tone === "ok" ? "" : i.tone}`}>
            <span>{i.message}</span>
            {i.action ? (
              <button className="undo" onClick={i.action.onClick}>
                {i.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

/* ------------------------------- Dialog ------------------------------- */
export interface DialogState {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "normal" | "danger";
  onConfirm?: () => void;
}

export function Dialog({ state, onClose }: { state: DialogState | null; onClose: () => void }) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{state.title}</h3>
        {state.description ? <p>{state.description}</p> : null}
        <div className="actions">
          <button className="btn btn-sub" onClick={onClose}>
            {state.cancelLabel ?? "取消"}
          </button>
          <button
            className={`btn ${state.tone === "danger" ? "btn-danger" : "btn-main"}`}
            onClick={() => {
              state.onConfirm?.();
              onClose();
            }}
          >
            {state.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useDialog() {
  const [state, setState] = useState<DialogState | null>(null);
  const confirm = useCallback((s: DialogState) => setState(s), []);
  const close = useCallback(() => setState(null), []);
  return { state, confirm, close };
}

/* ------------------------------- Switch ------------------------------- */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

/* --------------------------- SegmentedControl --------------------------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  tint,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  tint?: boolean;
}) {
  return (
    <div className={`segmented ${tint ? "tint" : ""}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Sheet 容器 ------------------------------ */
export function Sheet({
  open,
  onClose,
  children,
  title,
  maxHeight,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  maxHeight?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        style={maxHeight ? { maxHeight } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" />
        {title ? (
          <div className="between" style={{ padding: "4px 20px 8px" }}>
            <div className="sheet-title">{title}</div>
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              <Icon name="close" size={20} />
            </button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}