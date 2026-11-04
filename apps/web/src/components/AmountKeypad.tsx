/* 自定义数字键盘（PRD F1.2：0–9 / . / ⌫ / 完成；整数上限 9 位、小数 2 位） */

import { Icon } from "../icons/Icon";
import { backspace, pushDigit } from "@daybook/shared";

const KEYS: { k: string; kind: "num" | "op" }[] = [
  { k: "1", kind: "num" },
  { k: "2", kind: "num" },
  { k: "3", kind: "num" },
  { k: "del", kind: "op" },
  { k: "4", kind: "num" },
  { k: "5", kind: "num" },
  { k: "6", kind: "num" },
  { k: "7", kind: "num" },
  { k: "8", kind: "num" },
  { k: "9", kind: "num" },
  { k: "00", kind: "num" },
  { k: "0", kind: "num" },
  { k: ".", kind: "num" },
];

export function AmountKeypad({
  value,
  onChange,
  onSubmit,
  onError,
  submitLabel = "完成",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onError?: (msg: string) => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const press = (k: string) => {
    if (k === "del") {
      onChange(backspace(value));
      return;
    }
    if (k === "00") {
      let cur = value;
      for (let i = 0; i < 2; i++) {
        const r = pushDigit(cur, "0");
        if (r.error) {
          onError?.(r.error);
          break;
        }
        cur = r.next;
      }
      onChange(cur);
      return;
    }
    const r = pushDigit(value, k);
    if (r.error) onError?.(r.error);
    else onChange(r.next);
  };

  return (
    <div className="keypad">
      {KEYS.map((key) => (
        <button
          key={key.k}
          type="button"
          className={`key ${key.kind === "op" ? "op" : ""}`}
          onClick={() => press(key.k)}
          aria-label={key.k === "del" ? "删除" : key.k}
        >
          {key.k === "del" ? <Icon name="back" size={22} /> : key.k}
        </button>
      ))}
      <button
        type="button"
        className="key done"
        onClick={onSubmit}
        disabled={disabled}
      >
        {submitLabel}
      </button>
    </div>
  );
}