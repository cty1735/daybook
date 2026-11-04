/* 二级 / 三级页面外壳：从右侧滑入，覆盖在 Tab 内容之上 */

import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

export function SubPage({
  title,
  subtitle,
  onBack,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 45,
        background: "var(--bg-page)",
        display: "flex",
        flexDirection: "column",
        animation: "page-slide var(--t-base) var(--ease-spring) both",
      }}
    >
      <div className="topbar" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <Icon name="back" size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-title" style={{ fontSize: 18 }}>
            {title}
          </div>
          {subtitle ? <div className="xsmall muted-2">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="scroll">
        <div className="page" style={{ paddingBottom: 40 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* 注入关键帧（一次性） */
if (typeof document !== "undefined" && !document.getElementById("daybook-slide-kf")) {
  const style = document.createElement("style");
  style.id = "daybook-slide-kf";
  style.textContent = `@keyframes page-slide{from{opacity:.4;transform:translateX(24px)}to{opacity:1;transform:none}}`;
  document.head.appendChild(style);
}