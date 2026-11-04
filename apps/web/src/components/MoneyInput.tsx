/* 金额输入：内部以「分」为整数，界面展示元 */

import { useEffect, useState } from "react";
import { formatAmount, parseCents } from "@daybook/shared";

export function MoneyInput({
  valueCents,
  onChange,
  placeholder = "0.00",
  prefix = "¥",
  autoFocus,
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  placeholder?: string;
  prefix?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(valueCents ? formatAmount(valueCents) : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(valueCents ? formatAmount(valueCents) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCents]);

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {prefix ? (
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--t3)", display: "grid" }}>
          {prefix}
        </span>
      ) : null}
      <input
        className="input num"
        inputMode="decimal"
        style={{ paddingLeft: prefix ? 32 : 16, textAlign: prefix ? "left" : "center" }}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          setText(v);
          onChange(parseCents(v));
        }}
        onBlur={() => {
          setFocused(false);
          setText(valueCents ? formatAmount(valueCents) : "");
        }}
      />
    </div>
  );
}